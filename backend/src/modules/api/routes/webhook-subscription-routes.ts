/**
 * webhook-subscription-routes.ts — Owner/Admin management routes for Webhook Subscriptions.
 * Handles SSRF checks, encrypted secrets, circuit breaker resets, and test dispatches.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { assertPublicHttpsUrl } from '../../../shared/security/outbound-url-policy.js';
import { encryptWebhookSecret } from '../services/webhook-signature-service.js';
import { dispatchTestWebhook } from '../services/webhook-test-dispatch-service.js';

async function requireAdminOrOwner(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const role = req.user?.role;
  if (role !== 'owner' && role !== 'admin') {
    await reply.status(403).send({ error: 'Chỉ Quản trị viên hoặc Chủ sở hữu mới có quyền cấu hình Webhook' });
  }
}

export async function webhookSubscriptionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/settings/webhooks — list subscriptions ────────────────────
  app.get('/api/v1/settings/webhooks', { preHandler: requireAdminOrOwner }, async (request: FastifyRequest) => {
    const user = request.user!;
    const [subs, pausedCounts] = await Promise.all([
      prisma.webhookSubscription.findMany({
        where: { orgId: user.orgId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, targetUrl: true, events: true, isActive: true,
          consecutiveFails: true, pauseReason: true, sendV1Signature: true,
          lastDispatchedAt: true, createdAt: true,
          _count: { select: { outboxItems: true } },
        },
      }),
      prisma.webhookOutbox.groupBy({
        by: ['subscriptionId'],
        where: { orgId: user.orgId, status: 'paused', subscriptionId: { not: null } },
        _count: { id: true },
      }),
    ]);

    const pausedMap = new Map(pausedCounts.map((p) => [p.subscriptionId, p._count.id]));
    const subscriptions = subs.map((s) => ({
      ...s,
      pausedEventCount: pausedMap.get(s.id) || 0,
      totalOutboxCount: s._count.outboxItems,
      secretMasked: '••••••••••••',
    }));
    return { subscriptions };
  });

  // ── POST /api/v1/settings/webhooks — create subscription ──────────────────
  app.post('/api/v1/settings/webhooks', { preHandler: requireAdminOrOwner }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const body = (request.body as Record<string, any>) || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const targetUrl = typeof body.targetUrl === 'string' ? body.targetUrl.trim() : '';
    if (!name || !targetUrl) return reply.status(400).send({ error: 'Tên và URL nhận tin là bắt buộc' });

    try {
      await assertPublicHttpsUrl(targetUrl);
    } catch (err: any) {
      return reply.status(400).send({ error: `URL không hợp lệ hoặc không an toàn: ${err.message}` });
    }

    const rawSecret = typeof body.secret === 'string' && body.secret.trim() ? body.secret.trim() : randomBytes(16).toString('hex');
    const created = await prisma.webhookSubscription.create({
      data: {
        orgId: user.orgId,
        name,
        targetUrl,
        secretEncrypted: encryptWebhookSecret(rawSecret) as any,
        events: Array.isArray(body.events) && body.events.length > 0 ? body.events : ['*'],
        sendV1Signature: typeof body.sendV1Signature === 'boolean' ? body.sendV1Signature : true,
        isActive: true,
      },
      select: { id: true, name: true, targetUrl: true, events: true, isActive: true, sendV1Signature: true, createdAt: true },
    });
    return reply.status(201).send({ ...created, secret: rawSecret, secretMasked: '••••••••••••' });
  });

  // ── PUT /api/v1/settings/webhooks/:id — update subscription ───────────────
  app.put('/api/v1/settings/webhooks/:id', { preHandler: requireAdminOrOwner }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const body = (request.body as Record<string, any>) || {};
    const existing = await prisma.webhookSubscription.findFirst({ where: { id, orgId: user.orgId, deletedAt: null } });
    if (!existing) return reply.status(404).send({ error: 'Không tìm thấy Webhook subscription' });

    const data: any = {};
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
    if (typeof body.targetUrl === 'string' && body.targetUrl.trim() && body.targetUrl !== existing.targetUrl) {
      try {
        await assertPublicHttpsUrl(body.targetUrl.trim());
        data.targetUrl = body.targetUrl.trim();
      } catch (err: any) {
        return reply.status(400).send({ error: `URL không hợp lệ: ${err.message}` });
      }
    }
    if (typeof body.secret === 'string' && body.secret.trim()) data.secretEncrypted = encryptWebhookSecret(body.secret.trim()) as any;
    if (Array.isArray(body.events)) data.events = body.events;
    if (typeof body.sendV1Signature === 'boolean') data.sendV1Signature = body.sendV1Signature;

    if (typeof body.isActive === 'boolean') {
      data.isActive = body.isActive;
      if (!body.isActive) {
        data.pauseReason = 'manual';
        await prisma.webhookOutbox.updateMany({ where: { subscriptionId: id, orgId: user.orgId, status: 'pending' }, data: { status: 'paused' } });
      } else {
        data.pauseReason = null;
        data.consecutiveFails = 0;
        await prisma.webhookOutbox.updateMany({ where: { subscriptionId: id, orgId: user.orgId, status: 'paused' }, data: { status: 'pending', attemptCount: 0, nextAttemptAt: new Date() } });
      }
    }

    const updated = await prisma.webhookSubscription.update({ where: { id: existing.id }, data });
    return { ...updated, secretMasked: '••••••••••••' };
  });

  // ── DELETE /api/v1/settings/webhooks/:id — soft delete ────────────────────
  app.delete('/api/v1/settings/webhooks/:id', { preHandler: requireAdminOrOwner }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const existing = await prisma.webhookSubscription.findFirst({ where: { id, orgId: user.orgId, deletedAt: null }, select: { id: true } });
    if (!existing) return reply.status(404).send({ error: 'Không tìm thấy Webhook subscription' });

    await prisma.$transaction(async (tx) => {
      await tx.webhookSubscription.update({ where: { id: existing.id }, data: { deletedAt: new Date(), isActive: false } });
      await tx.webhookOutbox.updateMany({ where: { subscriptionId: id, orgId: user.orgId, status: 'paused' }, data: { status: 'pending' } });
    });
    return { success: true };
  });

  // ── POST /api/v1/settings/webhooks/:id/test — test dispatch ───────────────
  app.post('/api/v1/settings/webhooks/:id/test', { preHandler: requireAdminOrOwner }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const sub = await prisma.webhookSubscription.findFirst({ where: { id, orgId: user.orgId, deletedAt: null } });
    if (!sub) return reply.status(404).send({ error: 'Không tìm thấy Webhook subscription' });
    return dispatchTestWebhook(sub, user.orgId);
  });
}
