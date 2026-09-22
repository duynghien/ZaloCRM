/**
 * attachment-download-worker.ts — Durable background worker for attachment downloads.
 * Uses atomic leases, concurrency limiter (concurrency 5), and PostgreSQL jsonb_set.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { emitAccountEvent } from '../../shared/realtime/socket-event-delivery.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { downloadAttachmentDetailed } from './attachment-downloader.js';
import { extractAttachmentContent } from './attachment-parser.js';
import { sanitizeJsonNullBytes } from './attachment-json-sanitizer.js';

const MAX_CONCURRENT_DOWNLOADS = 5;
const workerId = `attachment-worker-${process.pid}-${randomUUID().slice(0, 8)}`;

let workerInterval: NodeJS.Timeout | null = null;
let isTicking = false;
let isStopping = false;

export function pLimit(concurrency: number) {
  const queue: Array<() => void> = [];
  let active = 0;

  const next = () => {
    active--;
    if (queue.length > 0) {
      const run = queue.shift()!;
      run();
    }
  };

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

const limiter = pLimit(MAX_CONCURRENT_DOWNLOADS);

async function extractAttachmentSafely(params: Parameters<typeof extractAttachmentContent>[0]) {
  try {
    return await extractAttachmentContent(params);
  } catch (error) {
    logger.warn('[attachment-worker] Attachment parsing failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

interface RawJobRow {
  id: string;
  org_id: string;
  message_id: string;
  attachment_index: number;
  remote_url: string;
  attempt_count: number;
}

export async function processSingleAttachmentJob(job: RawJobRow): Promise<void> {
  try {
    const message = await prisma.message.findUnique({
      where: { id: job.message_id },
      select: {
        id: true,
        attachments: true,
        conversationId: true,
        conversation: { select: { orgId: true, zaloAccountId: true } },
      },
    });

    if (!message) {
      await prisma.$executeRaw`
        UPDATE "attachment_download_jobs"
        SET "status" = 'failed', "last_error" = 'Message not found', "updated_at" = NOW()
        WHERE "id" = ${job.id}
      `;
      return;
    }

    const attachments = Array.isArray(message.attachments) ? (message.attachments as any[]) : [];
    const attIndex = Number(job.attachment_index);
    const att = attachments[attIndex] || {};
    const effectiveUrl = job.remote_url || att.url;

    const downloadRes = await downloadAttachmentDetailed(effectiveUrl, {
      originalFilename: att.title || att.name || att.filename,
      orgId: job.org_id || message.conversation?.orgId,
    });

    if (downloadRes.success) {
      const result = downloadRes.result;
      let extractedText = att.extractedText;
      let isScanned = att.isScanned;
      let sheetNames = att.sheetNames;

      const parseRes = await extractAttachmentSafely({
        filename: result.originalName,
        localPath: result.localPath,
        mimeType: result.mimeType,
      });
      if (parseRes) {
        extractedText = parseRes.text;
        isScanned = parseRes.isScanned;
        sheetNames = parseRes.sheetNames;
      }

      const updatedAttachment = sanitizeJsonNullBytes({
        ...att,
        url: `/api/v1/attachments/${result.filename}`,
        localPath: result.localPath,
        filename: result.filename,
        extractedText,
        isScanned,
        sheetNames,
        retryCount: job.attempt_count,
      });

      const updatedRows = await prisma.$queryRaw<Array<{ attachments: any }>>`
        UPDATE "messages"
        SET "attachments" = jsonb_set(
          COALESCE("attachments", '[]'::jsonb),
          ARRAY[${attIndex}::text],
          ${JSON.stringify(updatedAttachment)}::jsonb,
          true
        )
        WHERE "id" = ${job.message_id}
        RETURNING "attachments"
      `;

      await prisma.$executeRaw`
        UPDATE "attachment_download_jobs"
        SET "status" = 'completed', "lease_owner" = NULL, "lease_expires_at" = NULL, "updated_at" = NOW()
        WHERE "id" = ${job.id}
      `;

      const accountId = message.conversation?.zaloAccountId;
      const conversationId = message.conversationId;
      if (accountId && conversationId) {
        const io = zaloPool.getIO();
        if (io) {
          await emitAccountEvent(io, accountId, 'chat:message:attachments-updated', {
            accountId,
            conversationId,
            messageId: job.message_id,
            attachments: updatedRows?.[0]?.attachments || attachments,
          });
        }
      }
    } else {
      const status = downloadRes.status;
      const isPermanent = status === 404 || status === 410 || status === 403;
      if (isPermanent) {
        const errorMsg = `Permanent CDN failure (HTTP ${status})`;
        logger.warn(`[attachment-worker] Permanent failure for job ${job.id}: ${errorMsg}`);
        await prisma.$executeRaw`
          UPDATE "attachment_download_jobs"
          SET "status" = 'failed',
              "last_error" = ${errorMsg},
              "lease_owner" = NULL,
              "lease_expires_at" = NULL,
              "updated_at" = NOW()
          WHERE "id" = ${job.id}
        `;
      } else {
        const nextAttempt = Number(job.attempt_count) + 1;
        const errorMsg = downloadRes.error || `Download failed (HTTP ${status || 'unknown'})`;
        if (nextAttempt >= 5) {
          logger.warn(`[attachment-worker] Job ${job.id} exceeded max retries (5): ${errorMsg}`);
          await prisma.$executeRaw`
            UPDATE "attachment_download_jobs"
            SET "status" = 'failed',
                "attempt_count" = ${nextAttempt},
                "last_error" = ${errorMsg},
                "lease_owner" = NULL,
                "lease_expires_at" = NULL,
                "updated_at" = NOW()
            WHERE "id" = ${job.id}
          `;
        } else {
          const backoffMinutes = Math.pow(2, nextAttempt);
          logger.info(`[attachment-worker] Scheduling retry ${nextAttempt} for job ${job.id} in ${backoffMinutes}m`);
          await prisma.$executeRaw`
            UPDATE "attachment_download_jobs"
            SET "status" = 'pending',
                "attempt_count" = ${nextAttempt},
                "next_attempt_at" = NOW() + (${backoffMinutes} * INTERVAL '1 minute'),
                "last_error" = ${errorMsg},
                "lease_owner" = NULL,
                "lease_expires_at" = NULL,
                "updated_at" = NOW()
            WHERE "id" = ${job.id}
          `;
        }
      }
    }
  } catch (err: any) {
    logger.error(`[attachment-worker] Error processing job ${job.id}:`, err?.message || err);
  }
}

export async function tickAttachmentQueue(): Promise<void> {
  if (isTicking || isStopping) return;
  isTicking = true;
  try {
    const claimedRows = await prisma.$queryRaw<RawJobRow[]>`
      UPDATE "attachment_download_jobs"
      SET "status" = 'downloading',
          "lease_owner" = ${workerId},
          "lease_expires_at" = NOW() + INTERVAL '2 minutes',
          "updated_at" = NOW()
      WHERE "id" IN (
        SELECT "id" FROM "attachment_download_jobs"
        WHERE ("status" = 'pending' OR ("status" = 'downloading' AND "lease_expires_at" < NOW()))
          AND "attempt_count" < 5
          AND "next_attempt_at" <= NOW()
        ORDER BY "next_attempt_at" ASC
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "org_id", "message_id", "attachment_index", "remote_url", "attempt_count"
    `;

    if (!claimedRows || claimedRows.length === 0) {
      return;
    }

    await Promise.all(
      claimedRows.map((job) => limiter(() => processSingleAttachmentJob(job)))
    );
  } catch (err: any) {
    logger.error('[attachment-worker] Error claiming attachment jobs:', err?.message || err);
  } finally {
    isTicking = false;
  }
}

export function startAttachmentWorker(): void {
  if (workerInterval) return;
  logger.info('[attachment-worker] Starting durable attachment download worker');
  isStopping = false;
  workerInterval = setInterval(() => {
    tickAttachmentQueue().catch((err) => {
      logger.error('[attachment-worker] Error in worker tick:', err);
    });
  }, 5000);
  workerInterval.unref();

  setImmediate(() => {
    tickAttachmentQueue().catch((err) => {
      logger.error('[attachment-worker] Error in initial worker tick:', err);
    });
  });
}

export async function stopAttachmentWorker(): Promise<void> {
  isStopping = true;
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    logger.info('[attachment-worker] Stopped attachment download worker');
  }
}
