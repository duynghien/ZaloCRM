/**
 * notification-service.test.ts — Unit tests for NotificationService
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createNotification,
  getNotifications,
  markAsRead,
  markAllAsRead,
  resolveByEntity,
  deleteNotification,
  cleanupOldNotifications,
} from '../../src/modules/notifications/notification-service.js';
import { prisma } from '../../src/shared/database/prisma-client.js';

describe('NotificationService Unit Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('createNotification', () => {
    it('creates a new notification when no dedupKey is provided', async () => {
      const mockNotif = {
        id: 'notif-1',
        orgId: 'org-1',
        userId: 'user-1',
        title: 'Lịch hẹn mới',
        detail: 'Chi tiết lịch hẹn',
        type: 'info',
        category: 'appointment',
        isRead: false,
        createdAt: new Date(),
      };

      vi.spyOn(prisma.notification, 'create').mockResolvedValue(mockNotif as any);

      const result = await createNotification({
        orgId: 'org-1',
        userId: 'user-1',
        type: 'info',
        category: 'appointment',
        title: 'Lịch hẹn mới',
        detail: 'Chi tiết lịch hẹn',
      });

      expect(result.id).toBe('notif-1');
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orgId: 'org-1',
            userId: 'user-1',
            title: 'Lịch hẹn mới',
          }),
        }),
      );
    });

    it('uses upsert when dedupKey is provided to avoid duplicate alerts', async () => {
      const mockNotif = {
        id: 'notif-dedup',
        orgId: 'org-1',
        dedupKey: 'sla_conv_123',
        title: 'Tin nhắn chưa phản hồi',
        detail: 'Chi tiết SLA',
        type: 'warning',
        category: 'chat_sla',
        isRead: false,
        createdAt: new Date(),
      };

      vi.spyOn(prisma.notification, 'upsert').mockResolvedValue(mockNotif as any);

      const result = await createNotification({
        orgId: 'org-1',
        dedupKey: 'sla_conv_123',
        type: 'warning',
        category: 'chat_sla',
        title: 'Tin nhắn chưa phản hồi',
        detail: 'Chi tiết SLA',
      });

      expect(result.id).toBe('notif-dedup');
      expect(prisma.notification.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            orgId_dedupKey: {
              orgId: 'org-1',
              dedupKey: 'sla_conv_123',
            },
          },
          update: expect.objectContaining({
            isRead: false,
            readAt: null,
            createdAt: expect.any(Date),
          }),
        }),
      );
    });
  });

  describe('getNotifications', () => {
    it('isolates by organization and user, returning accurate unreadCount', async () => {
      const mockList = [
        { id: 'n-1', orgId: 'org-1', userId: 'user-1', title: 'Personal', isRead: false },
        { id: 'n-2', orgId: 'org-1', userId: null, title: 'Org-wide', isRead: false },
      ];

      vi.spyOn(prisma.notification, 'findMany').mockResolvedValue(mockList as any);
      vi.spyOn(prisma.notification, 'count')
        .mockResolvedValueOnce(2)  // total
        .mockResolvedValueOnce(2); // unreadCount

      const res = await getNotifications('org-1', 'user-1', 'member', { page: 1, limit: 20 });

      expect(res.notifications.length).toBe(2);
      expect(res.unreadCount).toBe(2);
      expect(res.total).toBe(2);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgId: 'org-1',
          }),
        }),
      );
    });

    it('filters role-scoped alerts: members cannot see manager-targeted notifications', async () => {
      vi.spyOn(prisma.notification, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.notification, 'count').mockResolvedValue(0);

      await getNotifications('org-1', 'user-1', 'member', {});

      const callArgs = (prisma.notification.findMany as any).mock.calls[0][0];
      const roleFilter = callArgs.where.AND[0].OR;

      // Member should only see targetRole: null
      expect(roleFilter).toEqual([{ targetRole: null }]);
    });

    it('allows owner to see manager and admin targeted notifications', async () => {
      vi.spyOn(prisma.notification, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.notification, 'count').mockResolvedValue(0);

      await getNotifications('org-1', 'user-owner', 'owner', {});

      const callArgs = (prisma.notification.findMany as any).mock.calls[0][0];
      const roleFilter = callArgs.where.AND[0].OR;

      expect(roleFilter).toEqual(
        expect.arrayContaining([
          { targetRole: null },
          { targetRole: 'manager' },
          { targetRole: 'admin' },
          { targetRole: 'owner' },
        ]),
      );
    });
  });

  describe('markAsRead', () => {
    it('marks a personal notification as read for its owner', async () => {
      const mockNotif = {
        id: 'n-1',
        orgId: 'org-1',
        userId: 'user-1',
        isRead: false,
      };

      vi.spyOn(prisma.notification, 'findUnique').mockResolvedValue(mockNotif as any);
      vi.spyOn(prisma.notification, 'update').mockResolvedValue({
        ...mockNotif,
        isRead: true,
        readAt: new Date(),
      } as any);

      const res = await markAsRead('n-1', 'org-1', 'user-1', 'member');
      expect(res).not.toBeNull();
      expect(res?.isRead).toBe(true);
    });

    it('allows marking org-wide notification (userId: null) as read (team-acknowledged model)', async () => {
      const mockNotif = {
        id: 'n-org',
        orgId: 'org-1',
        userId: null,
        isRead: false,
      };

      vi.spyOn(prisma.notification, 'findUnique').mockResolvedValue(mockNotif as any);
      vi.spyOn(prisma.notification, 'update').mockResolvedValue({
        ...mockNotif,
        isRead: true,
        readAt: new Date(),
      } as any);

      const res = await markAsRead('n-org', 'org-1', 'user-1', 'member');
      expect(res).not.toBeNull();
      expect(res?.isRead).toBe(true);
    });

    it('blocks a non-admin member from marking another user\'s personal notification as read', async () => {
      const mockNotif = {
        id: 'n-other',
        orgId: 'org-1',
        userId: 'user-2',
        isRead: false,
      };

      vi.spyOn(prisma.notification, 'findUnique').mockResolvedValue(mockNotif as any);

      const res = await markAsRead('n-other', 'org-1', 'user-1', 'member');
      expect(res).toBeNull();
    });
  });

  describe('markAllAsRead', () => {
    it('only marks personal notifications as read, preserving org-wide notifications', async () => {
      vi.spyOn(prisma.notification, 'updateMany').mockResolvedValue({ count: 3 });

      const res = await markAllAsRead('org-1', 'user-1');
      expect(res.count).toBe(3);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          orgId: 'org-1',
          userId: 'user-1',
          isRead: false,
        },
        data: {
          isRead: true,
          readAt: expect.any(Date),
        },
      });
    });
  });

  describe('resolveByEntity', () => {
    it('resolves all unread notifications matching entityType and entityId', async () => {
      vi.spyOn(prisma.notification, 'updateMany').mockResolvedValue({ count: 2 });

      const count = await resolveByEntity('org-1', 'conversation', 'conv-123');
      expect(count).toBe(2);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          orgId: 'org-1',
          entityType: 'conversation',
          entityId: 'conv-123',
          isRead: false,
        },
        data: {
          isRead: true,
          readAt: expect.any(Date),
        },
      });
    });
  });

  describe('deleteNotification', () => {
    it('allows deleting owned notification', async () => {
      vi.spyOn(prisma.notification, 'findUnique').mockResolvedValue({
        id: 'n-1',
        orgId: 'org-1',
        userId: 'user-1',
      } as any);
      vi.spyOn(prisma.notification, 'delete').mockResolvedValue({ id: 'n-1' } as any);

      const res = await deleteNotification('n-1', 'org-1', 'user-1', 'member');
      expect(res).toBe(true);
    });

    it('denies deleting another user\'s notification if caller is regular member', async () => {
      vi.spyOn(prisma.notification, 'findUnique').mockResolvedValue({
        id: 'n-other',
        orgId: 'org-1',
        userId: 'user-2',
      } as any);

      const res = await deleteNotification('n-other', 'org-1', 'user-1', 'member');
      expect(res).toBe(false);
    });
  });

  describe('cleanupOldNotifications', () => {
    it('deletes notifications older than specified days', async () => {
      vi.spyOn(prisma.notification, 'deleteMany').mockResolvedValue({ count: 15 });

      const count = await cleanupOldNotifications(30);
      expect(count).toBe(15);
      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: {
            lt: expect.any(Date),
          },
        },
      });
    });
  });
});
