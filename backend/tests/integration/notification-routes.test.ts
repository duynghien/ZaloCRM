/**
 * notification-routes.test.ts — Integration tests for notification REST API endpoints.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';

let currentUser = { id: 'u-1', orgId: 'org-1', role: 'owner', email: 'test@example.com' };

vi.mock('../../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: vi.fn(async (req: any) => {
    req.user = currentUser;
  }),
}));

import { notificationRoutes } from '../../src/modules/notifications/notification-routes.js';
import * as notificationService from '../../src/modules/notifications/notification-service.js';

describe('notificationRoutes API', () => {
  let app: any;

  beforeEach(async () => {
    vi.restoreAllMocks();
    currentUser = { id: 'u-1', orgId: 'org-1', role: 'owner', email: 'test@example.com' };
    app = Fastify({ logger: false });
    await app.register(fastifyCookie);
    await app.register(fastifyJwt, { secret: 'test_jwt_secret_32_characters_long_12345' });

    app.addHook('onRequest', async (req: any) => {
      req.user = currentUser;
    });

    await app.register(notificationRoutes);
    await app.ready();
  });

  describe('GET /api/v1/notifications', () => {
    it('returns paginated notifications and unreadCount', async () => {
      vi.spyOn(notificationService, 'getNotifications').mockResolvedValue({
        notifications: [
          {
            id: 'n-1',
            orgId: 'org-1',
            userId: 'u-1',
            type: 'info',
            category: 'appointment',
            title: 'Lịch hẹn mới',
            detail: 'Chi tiết',
            isRead: false,
            createdAt: new Date(),
          } as any,
        ],
        total: 1,
        unreadCount: 1,
        page: 1,
        limit: 20,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications?page=1&limit=20',
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.notifications.length).toBe(1);
      expect(data.unreadCount).toBe(1);
      expect(data.total).toBe(1);
      expect(notificationService.getNotifications).toHaveBeenCalledWith(
        'org-1',
        'u-1',
        'owner',
        expect.objectContaining({ page: 1, limit: 20 }),
      );
    });

    it('clamps limit to maximum 100 and minimum 1', async () => {
      vi.spyOn(notificationService, 'getNotifications').mockResolvedValue({
        notifications: [],
        total: 0,
        unreadCount: 0,
        page: 1,
        limit: 100,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications?limit=500',
      });

      expect(res.statusCode).toBe(200);
      expect(notificationService.getNotifications).toHaveBeenCalledWith(
        'org-1',
        'u-1',
        'owner',
        expect.objectContaining({ limit: 100 }),
      );
    });
  });

  describe('PATCH /api/v1/notifications/:id/read', () => {
    it('marks notification as read successfully', async () => {
      vi.spyOn(notificationService, 'markAsRead').mockResolvedValue({
        id: 'n-1',
        orgId: 'org-1',
        userId: 'u-1',
        isRead: true,
        readAt: new Date(),
      } as any);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/notifications/n-1/read',
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(data.notification.isRead).toBe(true);
    });

    it('returns 404 when notification not found or access denied', async () => {
      vi.spyOn(notificationService, 'markAsRead').mockResolvedValue(null);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/notifications/n-nonexistent/read',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('Notification not found or access denied');
    });
  });

  describe('POST /api/v1/notifications/mark-all-read', () => {
    it('marks all personal notifications as read', async () => {
      vi.spyOn(notificationService, 'markAllAsRead').mockResolvedValue({ count: 5 });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/notifications/mark-all-read',
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(data.count).toBe(5);
      expect(notificationService.markAllAsRead).toHaveBeenCalledWith('org-1', 'u-1');
    });
  });

  describe('DELETE /api/v1/notifications/:id', () => {
    it('deletes notification when authorized', async () => {
      vi.spyOn(notificationService, 'deleteNotification').mockResolvedValue(true);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/notifications/n-1',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it('returns 404 when deletion fails or unauthorized', async () => {
      vi.spyOn(notificationService, 'deleteNotification').mockResolvedValue(false);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/notifications/n-forbidden',
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
