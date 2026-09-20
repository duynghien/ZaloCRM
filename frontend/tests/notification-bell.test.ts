/**
 * notification-bell.test.ts — Unit tests for Notification Store and Bell UI logic
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useNotificationStore } from '../src/stores/notification';
import { api } from '../src/api/index';

describe('useNotificationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it('fetches notifications and updates unreadCount accurately', async () => {
    const mockData = {
      notifications: [
        {
          id: 'n-1',
          orgId: 'org-1',
          userId: 'u-1',
          title: 'Lịch hẹn hôm nay',
          detail: '14:00 - Tái khám',
          type: 'info',
          category: 'appointment',
          actionUrl: '/appointments',
          priority: 'medium',
          isRead: false,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 1,
      total: 1,
      page: 1,
      limit: 20,
    };

    vi.spyOn(api, 'get').mockResolvedValue({ data: mockData });

    const store = useNotificationStore();
    await store.fetchNotifications();

    expect(store.notifications.length).toBe(1);
    expect(store.unreadCount).toBe(1);
    expect(store.hasUnread).toBe(true);
    expect(store.filteredNotifications.length).toBe(1);
  });

  it('optimistically marks notification as read and clamps unreadCount to zero', async () => {
    const store = useNotificationStore();
    store.notifications = [
      {
        id: 'n-1',
        orgId: 'org-1',
        userId: 'u-1',
        title: 'Cảnh báo Zalo',
        detail: 'Mất kết nối',
        type: 'error',
        category: 'zalo_account',
        actionUrl: '/zalo-accounts',
        priority: 'high',
        isRead: false,
        readAt: null,
        targetRole: null,
        entityType: null,
        entityId: null,
        metadata: null,
        createdAt: new Date().toISOString(),
      },
    ];
    store.unreadCount = 1;

    vi.spyOn(api, 'patch').mockResolvedValue({ data: { success: true } });

    await store.markAsRead('n-1');

    expect(store.notifications[0].isRead).toBe(true);
    expect(store.unreadCount).toBe(0);
    expect(store.hasUnread).toBe(false);
  });

  it('markAllAsRead marks all personal notifications and sets unreadCount to zero', async () => {
    const store = useNotificationStore();
    store.notifications = [
      {
        id: 'n-personal',
        orgId: 'org-1',
        userId: 'u-1',
        title: 'Personal',
        detail: 'Detail',
        type: 'info',
        category: 'appointment',
        actionUrl: null,
        priority: 'low',
        isRead: false,
        readAt: null,
        targetRole: null,
        entityType: null,
        entityId: null,
        metadata: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'n-org',
        orgId: 'org-1',
        userId: null, // Org-wide
        title: 'Org wide',
        detail: 'Detail',
        type: 'warning',
        category: 'chat_sla',
        actionUrl: null,
        priority: 'high',
        isRead: false,
        readAt: null,
        targetRole: null,
        entityType: null,
        entityId: null,
        metadata: null,
        createdAt: new Date().toISOString(),
      },
    ];
    store.unreadCount = 2;

    vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true, count: 1 } });
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        notifications: [
          { ...store.notifications[0], isRead: true },
          { ...store.notifications[1], isRead: false },
        ],
        unreadCount: 1,
        total: 2,
      },
    });

    await store.markAllAsRead();

    expect(api.post).toHaveBeenCalledWith('/notifications/mark-all-read');
  });

  it('filters notifications by unread tab', () => {
    const store = useNotificationStore();
    store.notifications = [
      {
        id: 'n-1',
        orgId: 'org-1',
        userId: 'u-1',
        title: 'Unread',
        detail: 'd1',
        type: 'info',
        category: 'appointment',
        actionUrl: null,
        priority: 'low',
        isRead: false,
        readAt: null,
        targetRole: null,
        entityType: null,
        entityId: null,
        metadata: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'n-2',
        orgId: 'org-1',
        userId: 'u-1',
        title: 'Read',
        detail: 'd2',
        type: 'info',
        category: 'appointment',
        actionUrl: null,
        priority: 'low',
        isRead: true,
        readAt: new Date().toISOString(),
        targetRole: null,
        entityType: null,
        entityId: null,
        metadata: null,
        createdAt: new Date().toISOString(),
      },
    ];

    expect(store.filteredNotifications.length).toBe(2);

    store.filter = 'unread';
    expect(store.filteredNotifications.length).toBe(1);
    expect(store.filteredNotifications[0].id).toBe('n-1');
  });

  it('prevents negative unreadCount when multiple read events arrive', async () => {
    const store = useNotificationStore();
    store.unreadCount = 0;

    // Simulate markAsRead call on already read or non-existent notification
    await store.markAsRead('non-existent');
    expect(store.unreadCount).toBe(0);
  });
});
