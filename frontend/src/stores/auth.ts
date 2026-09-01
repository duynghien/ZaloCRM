import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, clearAccessToken, getAccessToken, refreshAccessToken, setAccessToken } from '@/api/index';

interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  orgId: string;
  orgName: string;
}

interface SessionResponse {
  token: string;
  user: User | Partial<User>;
}

function toUser(data: any): User {
  return {
    id: data.id,
    email: data.email,
    fullName: data.fullName || data.full_name || '',
    role: data.role,
    orgId: data.orgId || data.org_id || '',
    orgName: data.org?.name || data.orgName || '',
  };
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const needsSetup = ref(false);
  const token = computed(() => getAccessToken());
  const isAuthenticated = computed(() => !!token.value && !!user.value);
  const isOwner = computed(() => user.value?.role === 'owner');
  const isAdmin = computed(() => ['owner', 'admin'].includes(user.value?.role || ''));
  let initialization: Promise<boolean> | null = null;

  function applySession(response: SessionResponse): void {
    if (response.token) setAccessToken(response.token);
    if (response.user) user.value = toUser(response.user);
  }

  async function checkSetup() {
    const res = await api.get('/setup/status');
    needsSetup.value = res.data.needsSetup;
    return res.data.needsSetup;
  }

  async function fetchProfile() {
    const res = await api.get('/profile');
    user.value = toUser(res.data);
    return user.value;
  }

  async function setup(data: { orgName: string; fullName: string; email: string; password: string }) {
    const res = await api.post('/setup', data);
    applySession(res.data);
    await fetchProfile();
  }

  async function login(email: string, password: string) {
    const res = await api.post('/auth/login', { email, password });
    applySession(res.data);
    await fetchProfile();
  }

  async function bootstrapSession() {
    try {
      const tokenValue = await refreshAccessToken();
      if (!tokenValue) {
        clearSession();
        return false;
      }
      await fetchProfile();
      return true;
    } catch {
      // A network failure does not prove that the cookie-backed session ended.
      return false;
    }
  }

  async function init() {
    if (isAuthenticated.value) return true;
    if (!initialization) {
      initialization = (async () => {
        if (getAccessToken()) {
          try {
            await fetchProfile();
            return true;
          } catch {
            // Refresh/profile network errors leave the in-memory session intact.
          }
        }
        return bootstrapSession();
      })().finally(() => {
        initialization = null;
      });
    }
    return initialization;
  }

  async function logout() {
    try {
      if (getAccessToken()) {
        await api.post('/auth/logout');
      }
    } catch {
      // Best effort only. Session state is still cleared locally.
    } finally {
      clearSession();
    }
  }

  function clearSession() {
    clearAccessToken();
    user.value = null;
  }

  return {
    user,
    token,
    needsSetup,
    isAuthenticated,
    isOwner,
    isAdmin,
    checkSetup,
    setup,
    login,
    fetchProfile,
    logout,
    init,
  };
});
