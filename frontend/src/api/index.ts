import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { ref } from 'vue';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  withCredentials: true,
});

const refreshApi = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  withCredentials: true,
});

const accessToken = ref('');
let refreshPromise: Promise<string> | null = null;

type SessionExpiredHandler = () => void;
const sessionExpiredHandlers = new Set<SessionExpiredHandler>();

export function onSessionExpired(handler: SessionExpiredHandler): () => void {
  sessionExpiredHandlers.add(handler);
  return () => {
    sessionExpiredHandlers.delete(handler);
  };
}

function emitSessionExpired(): void {
  for (const handler of sessionExpiredHandlers) {
    try {
      handler();
    } catch (err) {
      console.error('Lỗi khi thực thi handler session expired:', err);
    }
  }
}

interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  _authRetry?: boolean;
}

export function getAccessToken(): string {
  return accessToken.value;
}

export function setAccessToken(token: string): void {
  accessToken.value = token;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('zalo-crm:access-token-changed', { detail: token }));
  }
}

export function clearAccessToken(): void {
  accessToken.value = '';
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('zalo-crm:access-token-changed', { detail: '' }));
  }
}

function getCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const encodedName = `${encodeURIComponent(name)}=`;
  return document.cookie.split('; ').find((cookie) => cookie.startsWith(encodedName))?.slice(encodedName.length) || '';
}

function isAuthenticationFailure(error: unknown): boolean {
  const status = (error as AxiosError | undefined)?.response?.status;
  return status === 401 || status === 403;
}

export function isSocketAuthenticationFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('authentication error')
    || normalized.includes('unauthorized')
    || normalized.includes('invalid token')
    || normalized.includes('expired')
    || normalized.includes('revoked')
    || normalized.includes('jwt');
}

function isTokenFresh(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
    const payload = JSON.parse(jsonPayload);
    if (typeof payload.exp !== 'number') return false;
    return payload.exp * 1000 > Date.now() + 10000;
  } catch {
    return false;
  }
}

async function executeRefreshCall(): Promise<string> {
  try {
    const response = await refreshApi.post('/auth/refresh', undefined, {
      headers: { 'X-CSRF-Token': getCookie('zalo_crm_csrf') },
    });
    const token = response.data.token;
    if (!token) throw new Error('Refresh response did not include an access token');
    setAccessToken(token);
    return token;
  } catch (error: unknown) {
    if (isAuthenticationFailure(error)) {
      const hadActiveToken = !!accessToken.value;
      clearAccessToken();
      if (hadActiveToken) {
        emitSessionExpired();
      }
    }
    throw error;
  }
}

async function performRefresh(): Promise<string> {
  if (isTokenFresh(accessToken.value)) {
    return accessToken.value;
  }
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('zalocrm_token_refresh', async () => {
      if (isTokenFresh(accessToken.value)) {
        return accessToken.value;
      }
      return executeRefreshCall();
    });
  }
  return executeRefreshCall();
}

/** Shares a refresh exchange so concurrent expired requests rotate the session once. */
export function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const csrfToken = getCookie('zalo_crm_csrf');
  if (csrfToken) config.headers['X-CSRF-Token'] = csrfToken;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableRequestConfig | undefined;
    if (error.response?.status !== 401 || !config || config._authRetry) return Promise.reject(error);

    config._authRetry = true;
    try {
      await refreshAccessToken();
      return api(config);
    } catch {
      // Network failures do not prove that a session is invalid.
      return Promise.reject(error);
    }
  },
);

export { api };
