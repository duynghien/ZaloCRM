/**
 * attachment-processor.ts — Orchestration and durable job enrollment for message attachments.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { sanitizeJsonNullBytes } from './attachment-json-sanitizer.js';
import {
  tickAttachmentQueue,
  startAttachmentWorker,
  stopAttachmentWorker,
} from './attachment-download-worker.js';
import { extractAttachmentContent } from './attachment-parser.js';

export { sanitizeJsonNullBytes } from './attachment-json-sanitizer.js';
export { startAttachmentWorker, stopAttachmentWorker, tickAttachmentQueue } from './attachment-download-worker.js';

async function extractAttachmentSafely(params: Parameters<typeof extractAttachmentContent>[0]) {
  try {
    return await extractAttachmentContent(params);
  } catch (error) {
    logger.warn('[attachment-processor] Attachment parsing failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

export async function processMessageAttachmentsAsync(
  messageId: string,
  attachments: any[],
  _attempt = 0,
  orgId?: string,
): Promise<void> {
  if (!attachments || attachments.length === 0) return;

  let resolvedOrgId = orgId;
  if (!resolvedOrgId) {
    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      select: { conversation: { select: { orgId: true } } },
    });
    resolvedOrgId = msg?.conversation?.orgId;
  }

  if (!resolvedOrgId) {
    logger.warn(`[attachment-processor] Cannot process attachments for message ${messageId}: orgId missing`);
    return;
  }

  let hasNewDownloadJobs = false;

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    const isRemote =
      att?.url &&
      !att.localPath &&
      typeof att.url === 'string' &&
      !att.url.startsWith('/api/v1/attachments/');

    if (isRemote) {
      await prisma.$executeRaw`
        INSERT INTO "attachment_download_jobs" (
          "id", "org_id", "message_id", "attachment_index", "remote_url",
          "status", "attempt_count", "next_attempt_at", "created_at", "updated_at"
        )
        VALUES (gen_random_uuid(), ${resolvedOrgId}, ${messageId}, ${i}, ${att.url}, 'pending', 0, NOW(), NOW(), NOW())
        ON CONFLICT ("message_id", "attachment_index") DO NOTHING
      `;
      hasNewDownloadJobs = true;
    } else if (att?.localPath && !att?.extractedText) {
      const parseRes = await extractAttachmentSafely({
        filename: att.title || att.filename,
        localPath: att.localPath,
        mimeType: att.mimeType,
      });
      if (parseRes) {
        const updated = sanitizeJsonNullBytes({
          ...att,
          extractedText: parseRes.text,
          isScanned: parseRes.isScanned,
          sheetNames: parseRes.sheetNames,
        });
        await prisma.$executeRaw`
          UPDATE "messages"
          SET "attachments" = jsonb_set(
            COALESCE("attachments", '[]'::jsonb),
            ARRAY[${i}::text],
            ${JSON.stringify(updated)}::jsonb,
            true
          )
          WHERE "id" = ${messageId}
        `;
      }
    }
  }

  if (hasNewDownloadJobs) {
    setImmediate(() => {
      tickAttachmentQueue().catch((err) => {
        logger.error('[attachment-processor] Error triggering queue tick:', err);
      });
    });
  }
}

export async function recoverPendingAttachmentDownloads(): Promise<void> {
  try {
    // 1. Reclaim stalled downloading jobs whose leases expired
    await prisma.$executeRaw`
      UPDATE "attachment_download_jobs"
      SET "status" = 'pending', "lease_owner" = NULL, "lease_expires_at" = NULL, "updated_at" = NOW()
      WHERE "status" = 'downloading' AND "lease_expires_at" < NOW()
    `;

    // 2. Scan for legacy or missed messages with remote attachments
    const batchSize = 100;
    let cursor: string | undefined = undefined;
    let recoveredCount = 0;
    let hasMore = true;

    while (hasMore) {
      const messages: Array<{
        id: string;
        attachments: any;
        conversation: { orgId: string } | null;
      }> = await prisma.message.findMany({
        where: {
          attachments: { not: Prisma.JsonNull },
        },
        select: {
          id: true,
          attachments: true,
          conversation: { select: { orgId: true } },
        },
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      });

      if (messages.length === 0) {
        break;
      }

      for (const msg of messages) {
        if (!Array.isArray(msg.attachments) || msg.attachments.length === 0) continue;
        const orgId = msg.conversation?.orgId;
        if (!orgId) continue;

        for (let i = 0; i < msg.attachments.length; i++) {
          const att = msg.attachments[i];
          const hasPending =
            att &&
            typeof att.url === 'string' &&
            !att.localPath &&
            (att.url.includes('zalo') || att.url.includes('zdn.vn') || att.url.includes('zadn.vn')) &&
            !att.url.startsWith('/api/v1/attachments/');

          if (hasPending) {
            recoveredCount++;
            await prisma.$executeRaw`
              INSERT INTO "attachment_download_jobs" (
                "id", "org_id", "message_id", "attachment_index", "remote_url",
                "status", "attempt_count", "next_attempt_at", "created_at", "updated_at"
              )
              VALUES (gen_random_uuid(), ${orgId}, ${msg.id}, ${i}, ${att.url}, 'pending', 0, NOW(), NOW(), NOW())
              ON CONFLICT ("message_id", "attachment_index") DO NOTHING
            `;
          }
        }
      }

      if (messages.length < batchSize) {
        hasMore = false;
      } else {
        cursor = messages[messages.length - 1].id;
      }
    }

    if (recoveredCount > 0) {
      logger.info(`[attachment-processor] Enrolled ${recoveredCount} pending attachment downloads from recovery sweep`);
    }

    // Trigger queue processing
    void tickAttachmentQueue();
  } catch (err: any) {
    logger.warn(`[attachment-processor] Startup attachment recovery sweep failed: ${err?.message || err}`);
  }
}
