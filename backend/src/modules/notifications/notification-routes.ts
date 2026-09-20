import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { getNotifications, markAsRead, markAllAsRead, deleteNotification } from './notification-service.js';

interface GetNotificationsQuery {
  page?: string | number;
  limit?: string | number;
  unreadOnly?: string | boolean;
  category?: string;
}

export async function notificationRoutes(app: FastifyInstance) {
  // Apply auth middleware to all routes in this module
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/notifications
  app.get<{ Querystring: GetNotificationsQuery }>('/api/v1/notifications', async (request, reply) => {
    const { user } = request;
    const query = request.query;

    const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(query.limit || '20'), 10) || 20));
    const unreadOnly = query.unreadOnly === 'true' || query.unreadOnly === true;
    const category = query.category;

    const result = await getNotifications(user!.orgId, user!.id, user!.role, {
      page,
      limit,
      unreadOnly,
      category,
    });

    return reply.send({
      notifications: result.notifications,
      total: result.total,
      unreadCount: result.unreadCount,
      page,
      limit,
    });
  });

  // PATCH /api/v1/notifications/:id/read
  app.patch<{ Params: { id: string } }>('/api/v1/notifications/:id/read', async (request, reply) => {
    const { user } = request;
    const { id } = request.params;

    const notification = await markAsRead(id, user!.orgId, user!.id, user!.role);
    
    if (!notification) {
      return reply.status(404).send({ error: 'Notification not found or access denied' });
    }

    return reply.send({ success: true, notification });
  });

  // POST /api/v1/notifications/mark-all-read
  app.post('/api/v1/notifications/mark-all-read', async (request, reply) => {
    const { user } = request;

    const result = await markAllAsRead(user!.orgId, user!.id);

    return reply.send({ success: true, count: result.count });
  });

  // DELETE /api/v1/notifications/:id
  app.delete<{ Params: { id: string } }>('/api/v1/notifications/:id', async (request, reply) => {
    const { user } = request;
    const { id } = request.params;

    const success = await deleteNotification(id, user!.orgId, user!.id, user!.role);
    
    if (!success) {
      return reply.status(404).send({ error: 'Notification not found or access denied' });
    }

    return reply.send({ success: true });
  });
}
