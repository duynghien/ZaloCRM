import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Socket } from 'socket.io-client';
import { api } from '@/api/index';
import { getSharedSocket } from '../services/socket-service';
import { useAuthStore } from './auth';

export interface NotificationItem {
  id: string;
  orgId: string;
  userId: string | null;
  targetRole: string | null;
  entityType: string | null;
  entityId: string | null;
  type: string;
  category: string;
  title: string;
  detail: string;
  actionUrl: string | null;
  priority: string;
  isRead: boolean;
  readAt: string | null;
  metadata: any;
  createdAt: string;
}

export const useNotificationStore = defineStore('notification', () => {
  // State
  const notifications = ref<NotificationItem[]>([]);
  const unreadCount = ref(0);
  const total = ref(0);
  const filter = ref<'all' | 'unread'>('all');
  const loading = ref(false);
  const page = ref(1);
  const limit = ref(20);
  let socket: Socket | null = null;

  // Computed
  const filteredNotifications = computed(() => {
    if (filter.value === 'unread') {
      return notifications.value.filter(n => !n.isRead);
    }
    return notifications.value;
  });

  const hasUnread = computed(() => unreadCount.value > 0);

  // Actions
  async function fetchNotifications() {
    loading.value = true;
    try {
      const params: Record<string, any> = { page: page.value, limit: limit.value };
      if (filter.value === 'unread') params.unreadOnly = true;
      const res = await api.get('/notifications', { params });
      notifications.value = res.data.notifications;
      unreadCount.value = Math.max(0, res.data.unreadCount ?? 0);
      total.value = res.data.total ?? 0;
    } catch {
      // silently ignore fetch errors
    } finally {
      loading.value = false;
    }
  }

  async function markAsRead(id: string) {
    // Optimistic update
    const notif = notifications.value.find(n => n.id === id);
    if (notif && !notif.isRead) {
      notif.isRead = true;
      notif.readAt = new Date().toISOString();
      unreadCount.value = Math.max(0, unreadCount.value - 1);
    }
    try {
      await api.patch(`/notifications/${id}/read`);
    } catch {
      // Revert on failure
      if (notif) {
        notif.isRead = false;
        notif.readAt = null;
        unreadCount.value += 1;
      }
    }
  }

  async function markAllAsRead() {
    const previousNotifs = notifications.value.map(n => ({ ...n }));
    const previousCount = unreadCount.value;
    // Optimistic: mark all personal as read
    for (const n of notifications.value) {
      if (!n.isRead && n.userId !== null) {
        n.isRead = true;
        n.readAt = new Date().toISOString();
      }
    }
    unreadCount.value = 0;
    try {
      await api.post('/notifications/mark-all-read');
      // Re-fetch to get accurate server state
      await fetchNotifications();
    } catch {
      // Revert on failure
      notifications.value = previousNotifs as any;
      unreadCount.value = previousCount;
    }
  }

  async function deleteNotification(id: string) {
    const idx = notifications.value.findIndex(n => n.id === id);
    if (idx === -1) return;
    const removed = notifications.value.splice(idx, 1)[0];
    if (!removed.isRead) unreadCount.value = Math.max(0, unreadCount.value - 1);
    try {
      await api.delete(`/notifications/${id}`);
    } catch {
      // Revert on failure
      notifications.value.splice(idx, 0, removed);
      if (!removed.isRead) unreadCount.value += 1;
    }
  }

  function setFilter(newFilter: 'all' | 'unread') {
    filter.value = newFilter;
    page.value = 1;
    void fetchNotifications();
  }

  // Socket handlers
  function handleNewNotification(notif: NotificationItem) {
    const authStore = useAuthStore();
    if (notif.userId && authStore.user?.id && notif.userId !== authStore.user.id) {
      return; // Ignore personal notification targeted to another user
    }
    // Prevent duplicate item if already in list
    if (notifications.value.some(n => n.id === notif.id)) {
      return;
    }
    // Prepend to list
    notifications.value.unshift(notif);
    if (!notif.isRead) {
      unreadCount.value = Math.max(0, unreadCount.value + 1);
    }
    total.value += 1;
  }

  function handleReadNotification(data: { id: string; isOrgWide?: boolean }) {
    const notif = notifications.value.find(n => n.id === data.id);
    if (notif && !notif.isRead) {
      notif.isRead = true;
      notif.readAt = new Date().toISOString();
      unreadCount.value = Math.max(0, unreadCount.value - 1);
    }
  }

  function handleReadAll() {
    for (const n of notifications.value) {
      if (!n.isRead && n.userId !== null) {
        n.isRead = true;
        n.readAt = new Date().toISOString();
      }
    }
    // Re-fetch for accurate count
    void fetchNotifications();
  }

  function handleCountUpdate(data: { unreadCount: number }) {
    unreadCount.value = Math.max(0, data.unreadCount);
  }

  // Socket lifecycle
  function initSocket() {
    socket = getSharedSocket();
    if (!socket) return;

    socket.off('notification:new', handleNewNotification);
    socket.off('notification:read', handleReadNotification);
    socket.off('notification:read-all', handleReadAll);
    socket.off('notification:count', handleCountUpdate);

    socket.on('notification:new', handleNewNotification);
    socket.on('notification:read', handleReadNotification);
    socket.on('notification:read-all', handleReadAll);
    socket.on('notification:count', handleCountUpdate);

    if (socket.connected) {
      void fetchNotifications();
    }
    socket.on('connect', () => {
      void fetchNotifications();
    });

    // Visibility change: re-fetch when user returns to tab
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && socket?.connected) {
        void fetchNotifications();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    (socket as any)._notifCleanup = () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }

  function disconnectSocket() {
    if (!socket) return;
    (socket as any)._notifCleanup?.();
    socket.off('notification:new', handleNewNotification);
    socket.off('notification:read', handleReadNotification);
    socket.off('notification:read-all', handleReadAll);
    socket.off('notification:count', handleCountUpdate);
    socket = null;
  }

  function $reset() {
    disconnectSocket();
    notifications.value = [];
    unreadCount.value = 0;
    total.value = 0;
    filter.value = 'all';
    loading.value = false;
    page.value = 1;
  }

  return {
    // State
    notifications,
    unreadCount,
    total,
    filter,
    loading,
    page,
    limit,
    // Computed
    filteredNotifications,
    hasUnread,
    // Actions
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    setFilter,
    // Socket
    initSocket,
    disconnectSocket,
    $reset,
  };
});
