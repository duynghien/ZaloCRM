/**
 * webhook-log-routes.ts — Owner/Admin management routes for Webhook Outbox Delivery Logs & DLQ.
 * Provides real-time log monitoring, filtering, and manual DLQ retry capabilities.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { boundedPositiveInt } from '../../../shared/http/request-bounds.js';
import {
  getWebhookLogs,
  retryWebhookOutboxItem,
  getWebhookStats,
} from '../services/webhook-log-service.js';

async function requireAdminOrOwner(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const role = req.user?.role;
  if (role !== 'owner' && role !== 'admin') {
    await reply.status(403).send({ error: 'Chỉ Quản trị viên hoặc Chủ sở hữu mới có quyền xem nhật ký Webhook' });
  }
}

export async function webhookLogRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/settings/webhooks/logs — list outbox deliveries ────────────
  app.get('/api/v1/settings/webhooks/logs', { preHandler: requireAdminOrOwner }, async (request: FastifyRequest) => {
    const user = request.user!;
    const query = (request.query as Record<string, string>) || {};

    const page = boundedPositiveInt(query.page, 1, 10_000);
    const limit = boundedPositiveInt(query.limit, 20, 100);
    const status = query.status || undefined;
    const subscriptionId = query.subscriptionId || undefined;

    const [logResult, stats] = await Promise.all([
      getWebhookLogs(user.orgId, { status, subscriptionId }, { page, limit }),
      getWebhookStats(user.orgId),
    ]);

    return {
      ...logResult,
      stats,
    };
  });

  // ── POST /api/v1/settings/webhooks/logs/:id/retry — manual retry from DLQ ─
  app.post('/api/v1/settings/webhooks/logs/:id/retry', { preHandler: requireAdminOrOwner }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    try {
      const retried = await retryWebhookOutboxItem(user.orgId, id);
      if (!retried) {
        return reply.status(404).send({ error: 'Không tìm thấy bản ghi webhook outbox hoặc không thuộc tổ chức' });
      }
      return { success: true, item: retried };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });
}
