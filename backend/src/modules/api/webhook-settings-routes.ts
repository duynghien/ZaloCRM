/**
 * webhook-settings-routes.ts — Compatibility adapter for legacy webhook & API key settings routes.
 * Delegates to ApiKey and WebhookSubscription models without modifying app_settings.
 */
import { randomBytes, createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { deliverWebhook } from './webhook-service.js';
import { assertPublicHttpsUrl, OutboundUrlPolicyError } from '../../shared/security/outbound-url-policy.js';
import { encryptWebhookSecret, decryptWebhookSecret } from './services/webhook-signature-service.js';

function applyNoStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
}

export async function webhookSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request, reply) => {
    await authMiddleware(request, reply);
    if (reply.sent) return;
    if (!request.user || !['owner', 'admin'].includes(request.user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
  });

  // GET /api/v1/settings/webhook — retrieve default webhook config
  app.get('/api/v1/settings/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      applyNoStore(reply);
      const sub = await prisma.webhookSubscription.findFirst({
        where: { orgId, deletedAt: null },
        orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      });
      if (!sub) return { url: null, secret: null };

      let secretMasked: string | null = null;
      if (sub.secretEncrypted) {
        try {
          const dec = decryptWebhookSecret(sub.secretEncrypted);
          secretMasked = `${'*'.repeat(Math.max(0, dec.length - 4))}${dec.slice(-4)}`;
        } catch {
          secretMasked = '••••••••••••';
        }
      }
      return { url: sub.targetUrl ?? null, secret: secretMasked };
    } catch (err) {
      logger.error('[webhook-settings] GET error:', err);
      return reply.status(500).send({ error: 'Failed to fetch webhook settings' });
    }
  });

  // PUT /api/v1/settings/webhook — save default webhook URL and secret
  app.put('/api/v1/settings/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const body = request.body as { url?: string; secret?: string; webhookUrl?: string; webhookSecret?: string };
      const rawUrl = (body.url ?? body.webhookUrl ?? '').trim();
      const rawSecret = (body.secret ?? body.webhookSecret ?? '').trim();
      if (rawUrl) await assertPublicHttpsUrl(rawUrl);

      const existingSub = await prisma.webhookSubscription.findFirst({
        where: { orgId, deletedAt: null },
        orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      });

      if (existingSub) {
        const updateData: any = {};
        if (rawUrl) updateData.targetUrl = rawUrl;
        if (rawSecret) updateData.secretEncrypted = encryptWebhookSecret(rawSecret) as any;
        await prisma.webhookSubscription.update({ where: { id: existingSub.id }, data: updateData });
      } else if (rawUrl) {
        const secret = rawSecret || randomBytes(16).toString('hex');
        await prisma.webhookSubscription.create({
          data: {
            orgId,
            name: 'Default Webhook',
            targetUrl: rawUrl,
            secretEncrypted: encryptWebhookSecret(secret) as any,
            events: ['*'],
            isActive: true,
          },
        });
      }
      return { success: true, webhookUrl: rawUrl };
    } catch (err: any) {
      logger.error('[webhook-settings] PUT error:', err);
      if (err instanceof OutboundUrlPolicyError) return reply.status(400).send({ error: err.message });
      return reply.status(500).send({ error: 'Failed to save webhook settings' });
    }
  });

  // POST /api/v1/settings/webhook/test — deliver a test event
  app.post('/api/v1/settings/webhook/test', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const sub = await prisma.webhookSubscription.findFirst({
        where: { orgId, deletedAt: null, isActive: true },
        orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      });
      if (!sub?.targetUrl) return reply.status(400).send({ error: 'No webhook URL configured' });

      const result = await deliverWebhook(orgId, 'webhook.test', { message: 'Test event from Zalo CRM', orgId });
      if (!result?.ok) return reply.status(502).send({ error: 'Webhook endpoint rejected the test event' });
      return { success: true, sentTo: sub.targetUrl };
    } catch (err: any) {
      logger.error('[webhook-settings] Test error:', err);
      if (err instanceof OutboundUrlPolicyError) return reply.status(400).send({ error: err.message });
      return reply.status(502).send({ error: 'Failed to deliver test webhook' });
    }
  });

  // POST /api/v1/settings/api-key/generate — generate new public API key
  app.post('/api/v1/settings/api-key/generate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      applyNoStore(reply);
      const newKey = `zcrm_${randomBytes(24).toString('hex')}`;
      const keyHash = createHash('sha256').update(newKey).digest('hex');
      const keyPrefix = newKey.slice(0, 10);

      await prisma.apiKey.updateMany({
        where: { orgId, isActive: true, name: 'Default API Key' },
        data: { isActive: false, revokedAt: new Date() },
      });
      await prisma.apiKey.create({
        data: {
          orgId,
          name: 'Default API Key',
          keyPrefix,
          keyHash,
          scopes: ['*'],
          rateLimit: 60,
          createdById: request.user!.id,
          isActive: true,
        },
      });
      await prisma.activityLog.create({ data: { orgId, userId: request.user!.id, action: 'api_key.rotated', entityType: 'api_key', details: {} } });
      return { key: newKey, apiKey: newKey, prefix: keyPrefix };
    } catch (err) {
      logger.error('[webhook-settings] Generate API key error:', err);
      return reply.status(500).send({ error: 'Failed to generate API key' });
    }
  });

  // GET /api/v1/settings/api-key — retrieve masked API key
  app.get('/api/v1/settings/api-key', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      applyNoStore(reply);
      const activeKey = await prisma.apiKey.findFirst({ where: { orgId, isActive: true }, orderBy: { createdAt: 'desc' } });
      if (!activeKey) return { key: null, apiKey: null, maskedKey: null };

      const prefix = activeKey.keyPrefix || 'zcrm_';
      const masked = `${prefix}••••••••••••••••••••••••••••••••••••••••`;
      await prisma.activityLog.create({ data: { orgId, userId: request.user!.id, action: 'api_key.viewed', entityType: 'api_key', details: {} } });
      return { key: masked, apiKey: masked, maskedKey: masked, prefix };
    } catch (err) {
      logger.error('[webhook-settings] GET API key error:', err);
      return reply.status(500).send({ error: 'Failed to fetch API key' });
    }
  });
}
