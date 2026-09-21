/**
 * attachment-processor.ts — asynchronous downloading and text extraction for message attachments.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { emitAccountEvent } from '../../shared/realtime/socket-event-delivery.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { downloadAttachment } from './attachment-downloader.js';
import { extractAttachmentContent } from './attachment-parser.js';

async function extractAttachmentSafely(params: Parameters<typeof extractAttachmentContent>[0]) {
  try {
    return await extractAttachmentContent(params);
  } catch (error) {
    logger.warn('[attachment-processor] Attachment parsing failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Recursively strips null bytes (\u0000) from strings, arrays, and plain objects.
 * Guarantees safe serialization into PostgreSQL JSONB columns without triggering 22P05.
 * Includes a maxDepth guard (20 levels) with iterative fallback and 1MB size warning.
 */
export function sanitizeJsonNullBytes(input: any, depth = 0, maxDepth = 20): any {
  if (input === null || input === undefined) {
    return input;
  }

  if (depth === 0) {
    try {
      const str = JSON.stringify(input);
      if (str && str.length > 1024 * 1024) {
        logger.warn(
          `[attachment-processor] Large attachment payload detected (${(str.length / 1024 / 1024).toFixed(2)} MB), sanitizing null bytes with care`,
        );
      }
    } catch {
      // ignore
    }
  }

  if (typeof input === 'string') {
    return input.replace(/\u0000/g, '');
  }

  if (typeof input !== 'object') {
    return input;
  }

  if (depth >= maxDepth) {
    return sanitizeJsonIterative(input);
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeJsonNullBytes(item, depth + 1, maxDepth));
  }

  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(input)) {
    const cleanKey = typeof key === 'string' ? key.replace(/\u0000/g, '') : key;
    result[cleanKey] = sanitizeJsonNullBytes(val, depth + 1, maxDepth);
  }
  return result;
}

function sanitizeJsonIterative(root: any): any {
  if (root === null || typeof root !== 'object') {
    return typeof root === 'string' ? root.replace(/\u0000/g, '') : root;
  }

  const rootCopy = Array.isArray(root) ? [...root] : { ...root };
  const stack: Array<{ parent: any; key: string | number; value: any }> = [];

  if (Array.isArray(rootCopy)) {
    for (let i = 0; i < rootCopy.length; i++) {
      stack.push({ parent: rootCopy, key: i, value: rootCopy[i] });
    }
  } else {
    for (const [k, v] of Object.entries(rootCopy)) {
      stack.push({ parent: rootCopy, key: k, value: v });
    }
  }

  while (stack.length > 0) {
    const item = stack.pop()!;
    const val = item.value;
    if (typeof val === 'string') {
      item.parent[item.key] = val.replace(/\u0000/g, '');
    } else if (val && typeof val === 'object') {
      const copy = Array.isArray(val) ? [...val] : { ...val };
      item.parent[item.key] = copy;
      if (Array.isArray(copy)) {
        for (let i = 0; i < copy.length; i++) {
          stack.push({ parent: copy, key: i, value: copy[i] });
        }
      } else {
        for (const [k, v] of Object.entries(copy)) {
          stack.push({ parent: copy, key: k, value: v });
        }
      }
    }
  }

  return rootCopy;
}

const RETRY_DELAYS_MS = [30_000, 120_000, 600_000]; // 30s, 2m, 10m

export async function processMessageAttachmentsAsync(
  messageId: string,
  attachments: any[],
  attempt = 0,
  orgId?: string,
): Promise<void> {
  if (!attachments || attachments.length === 0) return;

  let conversationId: string | undefined;
  let accountId: string | undefined;

  if (!orgId) {
    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        conversationId: true,
        conversation: { select: { orgId: true, zaloAccountId: true } },
      },
    });
    if (!orgId) orgId = msg?.conversation?.orgId;
    conversationId = msg?.conversationId;
    accountId = msg?.conversation?.zaloAccountId;
  } else {
    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        conversationId: true,
        conversation: { select: { zaloAccountId: true } },
      },
    });
    conversationId = msg?.conversationId;
    accountId = msg?.conversation?.zaloAccountId;
  }

  const updatedAttachments: any[] = [];
  let hasPendingDownloads = false;

  for (const att of attachments) {
    let localPath = att.localPath;
    let filename = att.filename;
    let url = att.url;
    let extractedText = att.extractedText;
    let isScanned = att.isScanned;
    let sheetNames = att.sheetNames;
    let retryCount = att.retryCount || 0;

    if (url && !localPath) {
      const downloadRes = await downloadAttachment(url, {
        originalFilename: att.title || att.name || att.filename,
        orgId,
      });
      if (downloadRes) {
        localPath = downloadRes.localPath;
        filename = downloadRes.filename;
        url = `/api/v1/attachments/${downloadRes.filename}`;

        const parseRes = await extractAttachmentSafely({
          filename: downloadRes.originalName,
          localPath: downloadRes.localPath,
          mimeType: downloadRes.mimeType,
        });

        if (parseRes) {
          extractedText = parseRes.text;
          isScanned = parseRes.isScanned;
          sheetNames = parseRes.sheetNames;
        }
      } else {
        retryCount += 1;
        if (retryCount < 3) {
          hasPendingDownloads = true;
        }
      }
    } else if (localPath && !extractedText) {
      const parseRes = await extractAttachmentSafely({
        filename: att.title || filename,
        localPath,
        mimeType: att.mimeType,
      });
      if (parseRes) {
        extractedText = parseRes.text;
        isScanned = parseRes.isScanned;
        sheetNames = parseRes.sheetNames;
      }
    }

    updatedAttachments.push({
      ...att,
      url,
      localPath,
      filename,
      extractedText,
      isScanned,
      sheetNames,
      retryCount,
    });
  }

  const safeAttachments = sanitizeJsonNullBytes(updatedAttachments);

  try {
    await prisma.message.update({
      where: { id: messageId },
      data: { attachments: safeAttachments },
    });

    if (accountId && conversationId) {
      const io = zaloPool.getIO();
      if (io) {
        await emitAccountEvent(io, accountId, 'chat:message:attachments-updated', {
          accountId,
          conversationId,
          messageId,
          attachments: safeAttachments,
        });
      }
    }
  } catch (err: any) {
    logger.error(
      `[attachment-processor] Failed to update message ${messageId} attachments in database: ${err?.message || err}`,
    );
  }

  if (hasPendingDownloads && attempt < RETRY_DELAYS_MS.length) {
    const delay = RETRY_DELAYS_MS[attempt];
    logger.info(`[attachment-processor] Scheduling retry ${attempt + 1} for message ${messageId} in ${delay}ms`);
    setTimeout(() => {
      processMessageAttachmentsAsync(messageId, updatedAttachments, attempt + 1, orgId).catch(() => {});
    }, delay).unref();
  }
}

export async function recoverPendingAttachmentDownloads(): Promise<void> {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
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
          createdAt: { gte: oneDayAgo },
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
        const hasPending = (msg.attachments as any[]).some(
          (att) =>
            att &&
            typeof att.url === 'string' &&
            (att.url.includes('zalo') || att.url.includes('zdn.vn') || att.url.includes('zadn.vn')) &&
            !att.url.startsWith('/api/v1/attachments/'),
        );
        if (hasPending) {
          recoveredCount++;
          processMessageAttachmentsAsync(msg.id, msg.attachments as any[], 0, msg.conversation?.orgId).catch(() => {});
        }
      }

      if (messages.length < batchSize) {
        hasMore = false;
      } else {
        cursor = messages[messages.length - 1].id;
      }
    }

    if (recoveredCount > 0) {
      logger.info(`[attachment-processor] Recovered ${recoveredCount} pending attachment downloads from startup sweep`);
    }
  } catch (err: any) {
    logger.warn(`[attachment-processor] Startup attachment recovery sweep failed: ${err?.message || err}`);
  }
}

