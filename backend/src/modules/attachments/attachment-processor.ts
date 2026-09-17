/**
 * attachment-processor.ts — asynchronous downloading and text extraction for message attachments.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
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

const RETRY_DELAYS_MS = [30_000, 120_000, 600_000]; // 30s, 2m, 10m

export async function processMessageAttachmentsAsync(
  messageId: string,
  attachments: any[],
  attempt = 0,
): Promise<void> {
  if (!attachments || attachments.length === 0) return;

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

  await prisma.message.update({
    where: { id: messageId },
    data: { attachments: updatedAttachments },
  });

  if (hasPendingDownloads && attempt < RETRY_DELAYS_MS.length) {
    const delay = RETRY_DELAYS_MS[attempt];
    logger.info(`[attachment-processor] Scheduling retry ${attempt + 1} for message ${messageId} in ${delay}ms`);
    setTimeout(() => {
      processMessageAttachmentsAsync(messageId, updatedAttachments, attempt + 1).catch(() => {});
    }, delay).unref();
  }
}
