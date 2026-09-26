/**
 * webhook-service.ts — Durable multi-target webhook dispatcher with Circuit Breaker and DLQ.
 * Preserves immutable destination snapshots and issues dual HMAC-SHA256 signatures.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { fetchPublicHttps, type PublicFetchResponse } from '../../shared/security/outbound-url-policy.js';
import {
  decryptSigningSecret,
  computeWebhookSignatures,
  matchesEventPattern,
} from './services/webhook-signature-service.js';

export { matchesEventPattern };

const workerId = `webhook-worker-${process.pid}-${randomUUID().slice(0, 8)}`;
let workerInterval: NodeJS.Timeout | null = null;
let isTicking = false;
let isStopping = false;

export async function enqueueWebhook(
  tx: any,
  orgId: string,
  event: string,
  data: any
): Promise<void> {
  const client = tx || prisma;
  if (!client?.webhookSubscription?.findMany || !client?.webhookOutbox?.create) {
    return;
  }

  let subscriptions: any[] = [];
  try {
    subscriptions = await client.webhookSubscription.findMany({
      where: {
        orgId,
        deletedAt: null,
        OR: [{ isActive: true }, { pauseReason: 'circuit_breaker' }],
      },
    });
  } catch (err) {
    logger.warn('[webhook] Failed to query subscriptions for event:', event, err);
    return;
  }

  if (!subscriptions || subscriptions.length === 0) return;

  const matchingSubs = subscriptions.filter((sub: any) => {
    const events: string[] = Array.isArray(sub.events) ? sub.events : ['*'];
    return events.some((pattern) => matchesEventPattern(pattern, event));
  });

  if (matchingSubs.length === 0) return;

  const occurredAt = new Date().toISOString();
  for (const sub of matchingSubs) {
    const isCircuitPaused = sub.pauseReason === 'circuit_breaker';
    await client.webhookOutbox.create({
      data: {
        id: randomUUID(),
        orgId,
        subscriptionId: sub.id,
        destinationUrl: sub.targetUrl,
        signingSecretEncrypted: sub.secretEncrypted,
        sendV1SignatureSnapshot: sub.sendV1Signature,
        eventType: event,
        payload: { ...data, _occurredAt: occurredAt },
        status: isCircuitPaused ? 'paused' : 'pending',
        nextAttemptAt: new Date(Date.now() - 1000),
      },
    });
  }

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
    logger.warn(`[webhook] Failed to emit webhook for ${event}:`, err);
  }
}

export async function deliverWebhook(
  orgId: string,
  event: string,
  data: any,
  webhookId?: string,
  destinationOverride?: { targetUrl: string; secret?: string | null; sendV1?: boolean }
): Promise<PublicFetchResponse | null> {
  let targetUrl = destinationOverride?.targetUrl;
  let secret = destinationOverride?.secret ?? null;
  let sendV1 = destinationOverride?.sendV1 ?? true;

  if (!targetUrl) {
    const sub = await prisma.webhookSubscription.findFirst({
      where: { orgId, deletedAt: null, isActive: true },
    });
    if (!sub) return null;
    targetUrl = sub.targetUrl;
    secret = decryptSigningSecret(sub.secretEncrypted);
    sendV1 = sub.sendV1Signature;
  }

  const id = webhookId || randomUUID();
  const dispatchTimestamp = Math.floor(Date.now() / 1000).toString();
  const occurredAt = data?._occurredAt || new Date().toISOString();
  const cleanData = data && typeof data === 'object' && '_occurredAt' in data
    ? { ...data, _occurredAt: undefined }
    : data;

  const payloadObject = {
    event,
    timestamp: new Date().toISOString(), // Legacy V1 field
    data: cleanData,
    id,
    occurredAt,
    orgId,
  };
  const payloadString = JSON.stringify(payloadObject);

  const { signatureV1, signatureV2 } = computeWebhookSignatures(payloadString, secret, dispatchTimestamp);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Webhook-Id': id,
    'X-Webhook-Event': event,
    'X-Webhook-Timestamp': dispatchTimestamp,
    'X-Webhook-Signature-V2': signatureV2,
  };
  if (sendV1 && signatureV1) {
    headers['X-Webhook-Signature'] = signatureV1;
  }

  return fetchPublicHttps(targetUrl, {
    method: 'POST',
    headers,
    body: payloadString,
    timeoutMs: 10_000,
    maxResponseBytes: 1024 * 1024,
    maxRedirects: 0,
  });
}

interface WebhookOutboxRow {
  id: string;
  org_id: string;
  subscription_id?: string | null;
  destination_url?: string | null;
  signing_secret_encrypted?: Buffer | null;
  send_v1_signature_snapshot?: boolean | null;
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
      RETURNING "id", "org_id", "subscription_id", "destination_url", "signing_secret_encrypted",
                "send_v1_signature_snapshot", "event_type", "payload", "attempt_count", "lease_owner"
    `;

    if (!claimedRows || claimedRows.length === 0) return;

    for (const row of claimedRows) {
      const rowOwner = row.lease_owner || workerId;
      try {
        const secret = decryptSigningSecret(row.signing_secret_encrypted);
        const destination = row.destination_url
          ? { targetUrl: row.destination_url, secret, sendV1: row.send_v1_signature_snapshot ?? true }
          : undefined;

        const response = await deliverWebhook(row.org_id, row.event_type, row.payload, row.id, destination);

        if (response && response.ok) {
          await prisma.$executeRaw`
            UPDATE "webhook_outbox"
            SET "status" = 'delivered', "delivered_at" = NOW(), "response_status" = ${response.status},
                "lease_owner" = NULL, "lease_expires_at" = NULL, "updated_at" = NOW()
            WHERE "id" = ${row.id} AND "lease_owner" = ${rowOwner} AND "status" = 'dispatching'
          `;

          if (row.subscription_id) {
            await prisma.$executeRaw`
              UPDATE "webhook_subscriptions"
              SET "consecutive_fails" = 0, "last_dispatched_at" = NOW()
              WHERE "id" = ${row.subscription_id} AND "deleted_at" IS NULL
            `;
          }
        } else {
          await handleWebhookFailure(row, rowOwner, response ? response.status : null, response ? `HTTP ${response.status}` : 'Empty response');
        }
      } catch (err: any) {
        await handleWebhookFailure(row, rowOwner, null, err?.message || String(err));
      }
    }
  } catch (err: any) {
    logger.error('[webhook] Error in tickWebhookQueue:', err?.message || err);
  } finally {
    isTicking = false;
  }
}

async function handleWebhookFailure(row: WebhookOutboxRow, rowOwner: string, status: number | null, errorMsg: string): Promise<void> {
  const nextAttempt = Number(row.attempt_count) + 1;
  const isDlq = nextAttempt >= 10;
  const backoffMinutes = Math.pow(2, nextAttempt);

  await prisma.$executeRaw`
    UPDATE "webhook_outbox"
    SET "status" = ${isDlq ? 'failed' : 'pending'},
        "attempt_count" = ${nextAttempt},
        "next_attempt_at" = NOW() + (${backoffMinutes} * INTERVAL '1 minute'),
        "response_status" = ${status},
        "last_error" = ${errorMsg},
        "lease_owner" = NULL,
        "lease_expires_at" = NULL,
        "updated_at" = NOW()
    WHERE "id" = ${row.id} AND "lease_owner" = ${rowOwner} AND "status" = 'dispatching'
  `;

  // Circuit breaker: atomic increment & trip at 50 consecutive fails
  if (row.subscription_id) {
    const updatedSub = await prisma.$queryRaw<Array<{ consecutive_fails: number }>>`
      UPDATE "webhook_subscriptions"
      SET "consecutive_fails" = "consecutive_fails" + 1
      WHERE "id" = ${row.subscription_id} AND "deleted_at" IS NULL
      RETURNING "consecutive_fails"
    `;

    const fails = updatedSub[0]?.consecutive_fails ?? 0;
    if (fails >= 50) {
      logger.warn(`[webhook] Circuit breaker tripped for subscription ${row.subscription_id} after ${fails} consecutive fails`);
      await prisma.$executeRaw`
        UPDATE "webhook_subscriptions"
        SET "is_active" = false, "pause_reason" = 'circuit_breaker'
        WHERE "id" = ${row.subscription_id} AND "deleted_at" IS NULL
      `;
      // Pause pending items for this subscription
      await prisma.$executeRaw`
        UPDATE "webhook_outbox"
        SET "status" = 'paused'
        WHERE "subscription_id" = ${row.subscription_id} AND "status" = 'pending'
      `;
    }
  }
}

export function startWebhookWorker(): void {
  if (workerInterval) return;
  logger.info('[webhook] Starting durable webhook worker daemon');
  isStopping = false;
  workerInterval = setInterval(() => {
    tickWebhookQueue().catch((err) => logger.error('[webhook] Worker tick error:', err));
  }, 5000);
  workerInterval.unref();
  setImmediate(() => {
    tickWebhookQueue().catch((err) => logger.error('[webhook] Initial worker tick error:', err));
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
