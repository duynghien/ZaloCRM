import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Router } from 'vue-router';
import { api, clearAccessToken, getAccessToken, refreshAccessToken, setAccessToken } from '@/api/index';

export type AuthStatus = 'unknown' | 'checking' | 'authenticated' | 'anonymous' | 'unavailable';

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
  const status = ref<AuthStatus>('unknown');
  const errorMessage = ref<string | null>(null);
  const needsSetup = ref(false);
  let setupChecked = false;

  const token = computed(() => getAccessToken());
  // Resilient authentication: token + user present and status is not explicitly anonymous
  const isAuthenticated = computed(() => !!token.value && !!user.value && status.value !== 'anonymous');
  const isOwner = computed(() => user.value?.role === 'owner');
  const isAdmin = computed(() => ['owner', 'admin'].includes(user.value?.role || ''));
  let initialization: Promise<boolean> | null = null;

  function applySession(response: SessionResponse): void {
    if (response.token) setAccessToken(response.token);
    if (response.user) user.value = toUser(response.user);
  }

  async function checkSetup() {
    try {
      if (setupChecked) return needsSetup.value;
      const res = await api.get('/setup/status');
      needsSetup.value = res.data.needsSetup;
      setupChecked = true;
      return res.data.needsSetup;
    } catch {
      // In case of network error/502, don't throw, treat as unresolved
      return false;
    }
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
    status.value = 'authenticated';
    errorMessage.value = null;
  }

  async function login(email: string, password: string) {
    const res = await api.post('/auth/login', { email, password });
    applySession(res.data);
    await fetchProfile();
    status.value = 'authenticated';
    errorMessage.value = null;
  }

  function clearSession() {
    clearAccessToken();
    user.value = null;
    status.value = 'anonymous';
    errorMessage.value = null;
  }

  async function bootstrapSession() {
    status.value = 'checking';
    try {
      const tokenValue = await refreshAccessToken();
      if (!tokenValue) {
        clearSession();
        return false;
      }
      setAccessToken(tokenValue);
      await fetchProfile();
      status.value = 'authenticated';
      errorMessage.value = null;
      return true;
    } catch (err: any) {
      const httpStatus = err.response?.status;
      if (httpStatus === 401 || httpStatus === 403) {
        clearSession();
        return false;
      }
      // Network failure or 500/502/503/504
      status.value = 'unavailable';
      errorMessage.value = 'Không thể kết nối đến máy chủ hoặc máy chủ đang bảo trì. Vui lòng thử lại sau.';
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
            status.value = 'authenticated';
            errorMessage.value = null;
            return true;
          } catch (err: any) {
            const httpStatus = err.response?.status;
            if (httpStatus === 401 || httpStatus === 403) {
              clearSession();
              return false;
            }
            status.value = 'unavailable';
            errorMessage.value = 'Không thể kết nối đến máy chủ hoặc máy chủ đang bảo trì. Vui lòng thử lại sau.';
            return false;
          }
        }
        return bootstrapSession();
      })().finally(() => {
        initialization = null;
      });
    }
    return initialization;
  }

  async function retryBootstrap(routerInstance: Router) {
    const success = await bootstrapSession();
    if (!success && status.value === 'anonymous') {
      if (routerInstance.currentRoute.value.meta.requiresAuth) {
        routerInstance.push({
          name: 'Login',
          query: { redirect: routerInstance.currentRoute.value.fullPath },
        });
      }
    }
    return success;
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

  return {
    user,
    token,
    status,
    errorMessage,
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
    retryBootstrap,
    clearSession,
  };
});
