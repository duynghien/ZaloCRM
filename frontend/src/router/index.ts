import { createRouter, createWebHistory, createMemoryHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/LoginView.vue'),
    meta: { layout: 'auth', guestOnly: true },
  },
  {
    path: '/setup',
    name: 'Setup',
    component: () => import('@/views/SetupView.vue'),
    meta: { layout: 'auth', setupOnly: true },
  },
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/chat',
    name: 'Chat',
    component: () => import('@/views/ChatView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/contacts',
    name: 'Contacts',
    component: () => import('@/views/ContactsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/zalo-accounts',
    name: 'ZaloAccounts',
    component: () => import('@/views/ZaloAccountsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/appointments',
    name: 'Appointments',
    component: () => import('@/views/AppointmentsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/orders',
    name: 'Orders',
    component: () => import('@/views/OrdersView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/reports',
    name: 'Reports',
    component: () => import('@/views/ReportsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/ai-reports',
    name: 'AiReports',
    component: () => import('@/views/AiReportsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/api-settings',
    name: 'ApiSettings',
    component: () => import('@/views/ApiSettingsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { requiresAuth: true },
  },
];

export const router = createRouter({
  history: typeof window !== 'undefined' ? createWebHistory() : createMemoryHistory(),
  routes,
});

// Modern return-style auth & route protection guard
router.beforeEach(async (to) => {
  const authStore = useAuthStore();

  // 1. Chờ hoàn tất khởi tạo session trước khi quyết định navigation
  if (authStore.status === 'unknown') {
    await authStore.init();
  }

  // 2. Bảo vệ route yêu cầu đăng nhập
  if (to.meta.requiresAuth) {
    if (authStore.isAuthenticated) return true;
    if (authStore.status === 'unavailable') {
      // Cho phép navigation hoàn tất để app.mount() chạy và render NetworkErrorBanner fullscreen (layout === null)
      // App.vue chặn hoàn toàn việc mount DefaultLayout và view con
      return true;
    }
    return {
      name: 'Login',
      query: { redirect: to.fullPath },
    };
  }

  // 3. Bảo vệ guest-only route (/login) & Tự động điều hướng setup lần đầu
  if (to.meta.guestOnly) {
    if (authStore.isAuthenticated) return '/';
    // Kiểm tra nếu hệ thống mới tinh chưa có tài khoản admin nào (Finding 6)
    const needsSetup = await authStore.checkSetup();
    if (needsSetup) return { name: 'Setup' };
    return true;
  }

  // 4. Bảo vệ setup-only route (/setup)
  if (to.meta.setupOnly) {
    if (authStore.isAuthenticated) return '/';
    const needsSetup = await authStore.checkSetup();
    if (!needsSetup) return { name: 'Login' };
    return true;
  }

  return true;
});
