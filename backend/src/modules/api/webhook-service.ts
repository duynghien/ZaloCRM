/**
 * webhook-service.ts — fire-and-forget webhook delivery for org-configured endpoints.
 * Signs payloads with HMAC-SHA256 if webhook_secret is configured.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import crypto from 'node:crypto';
import { fetchPublicHttps, type PublicFetchResponse } from '../../shared/security/outbound-url-policy.js';

export async function emitWebhook(orgId: string, event: string, data: any): Promise<void> {
  void deliverWebhook(orgId, event, data).catch((err) => logger.warn(`[webhook] Failed to deliver ${event}:`, err));
}

export async function deliverWebhook(orgId: string, event: string, data: any): Promise<PublicFetchResponse | null> {
  const config = await prisma.appSetting.findFirst({
    where: { orgId, settingKey: 'webhook_url' },
  });
  if (!config?.valuePlain) return null;

  const secretSetting = await prisma.appSetting.findFirst({
    where: { orgId, settingKey: 'webhook_secret' },
  });

  const payload = JSON.stringify({ event, timestamp: new Date().toISOString(), data });
  const signature = secretSetting?.valuePlain
    ? crypto.createHmac('sha256', secretSetting.valuePlain).update(payload).digest('hex')
    : '';

  return fetchPublicHttps(config.valuePlain, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature,
      'X-Webhook-Event': event,
    },
    body: payload,
    timeoutMs: 10_000,
    maxResponseBytes: 1024 * 1024,
  });
}
