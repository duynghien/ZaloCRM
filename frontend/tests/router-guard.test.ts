/**
 * router-guard.test.ts — Unit tests for Vue Router beforeEach navigation guard
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { router } from '../src/router/index';
import { useAuthStore } from '../src/stores/auth';

describe('Router Navigation Guard', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it('initializes authStore when status is unknown on protected route', async () => {
    const authStore = useAuthStore();
    const initSpy = vi.spyOn(authStore, 'init').mockImplementation(async () => {
      authStore.status = 'anonymous';
      return false;
    });

    await router.push('/chat');

    expect(initSpy).toHaveBeenCalled();
    // Since anonymous, redirected to Login
    expect(router.currentRoute.value.name).toBe('Login');
    expect(router.currentRoute.value.query.redirect).toBe('/chat');
  });

  it('allows access to protected route when authenticated', async () => {
    const authStore = useAuthStore();
    authStore.status = 'authenticated';
    authStore.user = {
      id: 'u-1',
      email: 'user@example.com',
      fullName: 'User',
      role: 'admin',
      orgId: 'org-1',
      orgName: 'Org',
    };
    // Mock token getter
    vi.spyOn(authStore, 'isAuthenticated', 'get').mockReturnValue(true);

    await router.push('/chat');

    expect(router.currentRoute.value.name).toBe('Chat');
  });

  it('redirects to login with query param when unauthenticated user visits protected route', async () => {
    const authStore = useAuthStore();
    authStore.status = 'anonymous';
    vi.spyOn(authStore, 'isAuthenticated', 'get').mockReturnValue(false);

    await router.push('/orders');

    expect(router.currentRoute.value.name).toBe('Login');
    expect(router.currentRoute.value.query.redirect).toBe('/orders');
  });

  it('allows navigation to protected route when status is unavailable so App.vue renders fullscreen error banner', async () => {
    const authStore = useAuthStore();
    authStore.status = 'unavailable';
    vi.spyOn(authStore, 'isAuthenticated', 'get').mockReturnValue(false);

    await router.push('/appointments');

    // Route resolves to appointments, but App.vue layout computed will return null
    expect(router.currentRoute.value.name).toBe('Appointments');
  });

  it('redirects authenticated user away from guest-only /login to dashboard', async () => {
    const authStore = useAuthStore();
    authStore.status = 'authenticated';
    vi.spyOn(authStore, 'isAuthenticated', 'get').mockReturnValue(true);

    await router.push('/login');

    expect(router.currentRoute.value.name).toBe('Dashboard');
  });

  it('redirects to setup when visiting /login on a fresh installation that needs setup', async () => {
    const authStore = useAuthStore();
    authStore.status = 'anonymous';
    vi.spyOn(authStore, 'isAuthenticated', 'get').mockReturnValue(false);
    vi.spyOn(authStore, 'checkSetup').mockResolvedValue(true);

    await router.push('/login');

    expect(router.currentRoute.value.name).toBe('Setup');
  });

  it('allows unauthenticated user to visit /login when system is already set up', async () => {
    const authStore = useAuthStore();
    authStore.status = 'anonymous';
    vi.spyOn(authStore, 'isAuthenticated', 'get').mockReturnValue(false);
    vi.spyOn(authStore, 'checkSetup').mockResolvedValue(false);

    await router.push('/login');

    expect(router.currentRoute.value.name).toBe('Login');
  });

  it('redirects unauthenticated user from /setup to /login if setup is already complete', async () => {
    const authStore = useAuthStore();
    authStore.status = 'anonymous';
    vi.spyOn(authStore, 'isAuthenticated', 'get').mockReturnValue(false);
    vi.spyOn(authStore, 'checkSetup').mockResolvedValue(false);

    await router.push('/setup');

    expect(router.currentRoute.value.name).toBe('Login');
  });

  it('protects NotFound (404) route by redirecting unauthenticated visitors to login with redirect query', async () => {
    const authStore = useAuthStore();
    authStore.status = 'anonymous';
    vi.spyOn(authStore, 'isAuthenticated', 'get').mockReturnValue(false);

    await router.push('/completely-unknown-path');

    expect(router.currentRoute.value.name).toBe('Login');
    expect(router.currentRoute.value.query.redirect).toBe('/completely-unknown-path');
  });
});
