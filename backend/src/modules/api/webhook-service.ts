/**
 * webhook-service.ts — Durable webhook outbox delivery for organization endpoints.
 * Signs payloads with HMAC-SHA256 and includes X-Webhook-Id for receiver deduplication.
 */
import crypto, { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { fetchPublicHttps, type PublicFetchResponse } from '../../shared/security/outbound-url-policy.js';
import { decodeSecureSetting } from '../../shared/settings/secure-setting-codec.js';

const workerId = `webhook-worker-${process.pid}-${randomUUID().slice(0, 8)}`;
let workerInterval: NodeJS.Timeout | null = null;
let isTicking = false;
let isStopping = false;

export async function enqueueWebhook(
  tx: any,
  orgId: string,
  event: string,
  data: any,
): Promise<void> {
  const config = await tx?.appSetting?.findFirst?.({
    where: { orgId, settingKey: 'webhook_url' },
  });
  if (!config?.valuePlain) {
    // Organization has no webhook configured — avoid accumulating orphan outbox records
    return;
  }

  await tx.webhookOutbox.create({
    data: {
      id: randomUUID(),
      orgId,
      eventType: event,
      payload: data,
      status: 'pending',
      nextAttemptAt: new Date(Date.now() - 1000),
    },
  });

  const timer = setTimeout(() => {
    tickWebhookQueue().catch((err) => {
      logger.warn('[webhook] Outbox trigger error:', err);
    });
  }, 20);
  timer.unref?.();
}

export async function emitWebhook(orgId: string, event: string, data: any): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await enqueueWebhook(tx, orgId, event, data);
    });
  } catch (err) {
    logger.warn(`[webhook] Failed to enqueue webhook for ${event}:`, err);
  }
}

export async function deliverWebhook(
  orgId: string,
  event: string,
  data: any,
  webhookId?: string,
): Promise<PublicFetchResponse | null> {
  const config = await prisma.appSetting.findFirst({
    where: { orgId, settingKey: 'webhook_url' },
  });
  if (!config?.valuePlain) return null;

  const secretSetting = await prisma.appSetting.findFirst({
    where: { orgId, settingKey: 'webhook_secret' },
  });

  const payload = JSON.stringify({ event, timestamp: new Date().toISOString(), data });
  const secret = decodeSecureSetting(secretSetting);
  const signature = secret
    ? crypto.createHmac('sha256', secret).update(payload).digest('hex')
    : '';

  const id = webhookId || randomUUID();

  return fetchPublicHttps(config.valuePlain, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature,
      'X-Webhook-Event': event,
      'X-Webhook-Id': id,
    },
    body: payload,
    timeoutMs: 10_000,
    maxResponseBytes: 1024 * 1024,
  });
}

interface WebhookOutboxRow {
  id: string;
  org_id: string;
  event_type: string;
  payload: any;
  attempt_count: number;
  lease_owner?: string;
}

export async function tickWebhookQueue(): Promise<void> {
  if (isTicking || isStopping) return;
  isTicking = true;

  try {
    const claimedRows = await prisma.$queryRaw<WebhookOutboxRow[]>`
      UPDATE "webhook_outbox"
      SET "status" = 'dispatching',
          "lease_owner" = ${workerId},
          "lease_expires_at" = NOW() + INTERVAL '2 minutes',
          "updated_at" = NOW()
      WHERE "id" IN (
        SELECT "id" FROM "webhook_outbox"
        WHERE ("status" = 'pending' OR ("status" = 'dispatching' AND "lease_expires_at" < NOW()))
          AND "attempt_count" < 10
          AND "next_attempt_at" <= NOW()
        ORDER BY "next_attempt_at" ASC
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "org_id", "event_type", "payload", "attempt_count", "lease_owner"
    `;

    if (!claimedRows || claimedRows.length === 0) return;

    for (const row of claimedRows) {
      const rowOwner = row.lease_owner || workerId;
      try {
        const response = await deliverWebhook(row.org_id, row.event_type, row.payload, row.id);

        if (response && response.ok) {
          const updateCount = await prisma.$executeRaw`
            UPDATE "webhook_outbox"
            SET "status" = 'delivered',
                "delivered_at" = NOW(),
                "response_status" = ${response.status},
                "lease_owner" = NULL,
                "lease_expires_at" = NULL,
                "updated_at" = NOW()
            WHERE "id" = ${row.id} AND "lease_owner" = ${rowOwner} AND "status" = 'dispatching'
          `;
          if (updateCount !== 1) {
            logger.warn(`[webhook] Lost lease fence completing delivered webhook ${row.id}`);
          }
        } else {
          const nextAttempt = Number(row.attempt_count) + 1;
          const status = response ? response.status : null;
          const errorMsg = response ? `HTTP ${response.status}` : 'Delivery returned empty response';

          if (nextAttempt >= 10) {
            logger.warn(`[webhook] Outbox message ${row.id} reached DLQ max retries (10): ${errorMsg}`);
            const updateCount = await prisma.$executeRaw`
              UPDATE "webhook_outbox"
              SET "status" = 'failed',
                  "attempt_count" = ${nextAttempt},
                  "response_status" = ${status},
                  "last_error" = ${errorMsg},
                  "lease_owner" = NULL,
                  "lease_expires_at" = NULL,
                  "updated_at" = NOW()
              WHERE "id" = ${row.id} AND "lease_owner" = ${rowOwner} AND "status" = 'dispatching'
            `;
            if (updateCount !== 1) {
              logger.warn(`[webhook] Lost lease fence marking failed webhook ${row.id}`);
            }
          } else {
            const backoffMinutes = Math.pow(2, nextAttempt);
            const updateCount = await prisma.$executeRaw`
              UPDATE "webhook_outbox"
              SET "status" = 'pending',
                  "attempt_count" = ${nextAttempt},
                  "next_attempt_at" = NOW() + (${backoffMinutes} * INTERVAL '1 minute'),
                  "response_status" = ${status},
                  "last_error" = ${errorMsg},
                  "lease_owner" = NULL,
                  "lease_expires_at" = NULL,
                  "updated_at" = NOW()
              WHERE "id" = ${row.id} AND "lease_owner" = ${rowOwner} AND "status" = 'dispatching'
            `;
            if (updateCount !== 1) {
              logger.warn(`[webhook] Lost lease fence scheduling retry for webhook ${row.id}`);
            }
          }
        }
      } catch (err: any) {
        const nextAttempt = Number(row.attempt_count) + 1;
        const errorMsg = err?.message || String(err);
        if (nextAttempt >= 10) {
          const updateCount = await prisma.$executeRaw`
            UPDATE "webhook_outbox"
            SET "status" = 'failed',
                "attempt_count" = ${nextAttempt},
                "last_error" = ${errorMsg},
                "lease_owner" = NULL,
                "lease_expires_at" = NULL,
                "updated_at" = NOW()
            WHERE "id" = ${row.id} AND "lease_owner" = ${rowOwner} AND "status" = 'dispatching'
          `;
          if (updateCount !== 1) {
            logger.warn(`[webhook] Lost lease fence marking failed webhook ${row.id}`);
          }
        } else {
          const backoffMinutes = Math.pow(2, nextAttempt);
          const updateCount = await prisma.$executeRaw`
            UPDATE "webhook_outbox"
            SET "status" = 'pending',
                "attempt_count" = ${nextAttempt},
                "next_attempt_at" = NOW() + (${backoffMinutes} * INTERVAL '1 minute'),
                "last_error" = ${errorMsg},
                "lease_owner" = NULL,
                "lease_expires_at" = NULL,
                "updated_at" = NOW()
            WHERE "id" = ${row.id} AND "lease_owner" = ${rowOwner} AND "status" = 'dispatching'
          `;
          if (updateCount !== 1) {
            logger.warn(`[webhook] Lost lease fence scheduling retry for webhook ${row.id}`);
          }
        }
      }
    }
  } catch (err: any) {
    logger.error('[webhook] Error in tickWebhookQueue:', err?.message || err);
  } finally {
    isTicking = false;
  }
}

export function startWebhookWorker(): void {
  if (workerInterval) return;
  logger.info('[webhook] Starting durable webhook worker daemon');
  isStopping = false;
  workerInterval = setInterval(() => {
    tickWebhookQueue().catch((err) => {
      logger.error('[webhook] Worker tick error:', err);
    });
  }, 5000);
  workerInterval.unref();

  setImmediate(() => {
    tickWebhookQueue().catch((err) => {
      logger.error('[webhook] Initial worker tick error:', err);
    });
  });
}

export async function stopWebhookWorker(): Promise<void> {
  isStopping = true;
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    logger.info('[webhook] Stopped webhook worker daemon');
  }
}
