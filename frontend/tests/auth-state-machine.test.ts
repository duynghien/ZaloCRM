/**
 * auth-state-machine.test.ts — Unit tests for Auth State Machine (5 states)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from '../src/stores/auth';
import * as apiModule from '../src/api/index';

describe('Auth State Machine', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiModule.clearAccessToken();
    vi.restoreAllMocks();
  });

  it('starts in unknown state with isAuthenticated = false', () => {
    const store = useAuthStore();
    expect(store.status).toBe('unknown');
    expect(store.isAuthenticated).toBe(false);
    expect(store.errorMessage).toBeNull();
  });

  it('transitions to authenticated when refresh and profile succeed', async () => {
    vi.spyOn(apiModule, 'refreshAccessToken').mockResolvedValue('jwt-token-123');
    vi.spyOn(apiModule.api, 'get').mockResolvedValue({
      data: {
        id: 'u-1',
        email: 'test@example.com',
        fullName: 'Test User',
        role: 'admin',
        orgId: 'org-1',
        orgName: 'My Org',
      },
    });

    const store = useAuthStore();
    const result = await store.init();

    expect(result).toBe(true);
    expect(store.status).toBe('authenticated');
    expect(store.isAuthenticated).toBe(true);
    expect(store.user?.email).toBe('test@example.com');
    expect(store.errorMessage).toBeNull();
  });

  it('transitions to anonymous when refresh fails with 401 Unauthorized', async () => {
    vi.spyOn(apiModule, 'refreshAccessToken').mockRejectedValue({
      response: { status: 401, data: { error: 'Unauthorized' } },
    });

    const store = useAuthStore();
    const result = await store.init();

    expect(result).toBe(false);
    expect(store.status).toBe('anonymous');
    expect(store.isAuthenticated).toBe(false);
    expect(store.user).toBeNull();
    expect(store.token).toBe('');
  });

  it('transitions to unavailable when refresh encounters a network or 502 error', async () => {
    vi.spyOn(apiModule, 'refreshAccessToken').mockRejectedValue({
      response: { status: 502, data: 'Bad Gateway' },
    });

    const store = useAuthStore();
    const result = await store.init();

    expect(result).toBe(false);
    expect(store.status).toBe('unavailable');
    expect(store.isAuthenticated).toBe(false);
    expect(store.errorMessage).toContain('Không thể kết nối đến máy chủ');
  });

  it('preserves existing authenticated session when transient network error occurs at runtime (resilient)', async () => {
    const store = useAuthStore();
    apiModule.setAccessToken('valid-in-memory-token');
    store.user = {
      id: 'u-1',
      email: 'active@example.com',
      fullName: 'Active User',
      role: 'admin',
      orgId: 'org-1',
      orgName: 'My Org',
    };
    store.status = 'authenticated';
    expect(store.isAuthenticated).toBe(true);

    // Network drops: status transitions to unavailable
    store.status = 'unavailable';

    // isAuthenticated MUST remain true so DefaultLayout is not unmounted and forms are not lost
    expect(store.isAuthenticated).toBe(true);
  });

  it('updates status to authenticated on login', async () => {
    vi.spyOn(apiModule.api, 'post').mockResolvedValue({
      data: {
        token: 'new-jwt-token',
        user: { id: 'u-1', email: 'login@example.com', role: 'admin' },
      },
    });
    vi.spyOn(apiModule.api, 'get').mockResolvedValue({
      data: { id: 'u-1', email: 'login@example.com', role: 'admin' },
    });

    const store = useAuthStore();
    await store.login('login@example.com', 'secret');

    expect(store.status).toBe('authenticated');
    expect(store.isAuthenticated).toBe(true);
    expect(store.errorMessage).toBeNull();
  });

  it('updates status to authenticated on setup', async () => {
    vi.spyOn(apiModule.api, 'post').mockResolvedValue({
      data: {
        token: 'setup-jwt-token',
        user: { id: 'u-admin', email: 'admin@example.com', role: 'owner' },
      },
    });
    vi.spyOn(apiModule.api, 'get').mockResolvedValue({
      data: { id: 'u-admin', email: 'admin@example.com', role: 'owner' },
    });

    const store = useAuthStore();
    await store.setup({
      orgName: 'My Company',
      fullName: 'Admin User',
      email: 'admin@example.com',
      password: 'password123',
    });

    expect(store.status).toBe('authenticated');
    expect(store.isAuthenticated).toBe(true);
  });

  it('clears session and transitions to anonymous on logout', async () => {
    apiModule.setAccessToken('token-to-clear');
    vi.spyOn(apiModule.api, 'post').mockResolvedValue({ data: { success: true } });

    const store = useAuthStore();
    store.user = { id: 'u-1', email: 'a@b.com', fullName: 'U', role: 'admin', orgId: 'o', orgName: 'O' };
    store.status = 'authenticated';

    await store.logout();

    expect(store.status).toBe('anonymous');
    expect(store.isAuthenticated).toBe(false);
    expect(store.user).toBeNull();
    expect(apiModule.getAccessToken()).toBe('');
  });

  it('retryBootstrap redirects to login when server recovers with 401 on protected route', async () => {
    const store = useAuthStore();
    vi.spyOn(apiModule, 'refreshAccessToken').mockRejectedValue({
      response: { status: 401, data: { error: 'Unauthorized' } },
    });

    const mockRouter: any = {
      currentRoute: {
        value: {
          fullPath: '/chat',
          meta: { requiresAuth: true },
        },
      },
      push: vi.fn(),
    };

    const success = await store.retryBootstrap(mockRouter);

    expect(success).toBe(false);
    expect(store.status).toBe('anonymous');
    expect(mockRouter.push).toHaveBeenCalledWith({
      name: 'Login',
      query: { redirect: '/chat' },
    });
  });

  it('retryBootstrap recovers to authenticated when server recovers with 200', async () => {
    const store = useAuthStore();
    vi.spyOn(apiModule, 'refreshAccessToken').mockResolvedValue('fresh-token');
    vi.spyOn(apiModule.api, 'get').mockResolvedValue({
      data: { id: 'u-1', email: 'recovered@example.com', role: 'admin' },
    });

    const mockRouter: any = {
      currentRoute: {
        value: { fullPath: '/chat', meta: { requiresAuth: true } },
      },
      push: vi.fn(),
    };

    const success = await store.retryBootstrap(mockRouter);

    expect(success).toBe(true);
    expect(store.status).toBe('authenticated');
    expect(store.isAuthenticated).toBe(true);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});
