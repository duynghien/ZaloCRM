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

export async function processMessageAttachmentsAsync(
  messageId: string,
  attachments: any[],
): Promise<void> {
  if (!attachments || attachments.length === 0) return;

  const updatedAttachments: any[] = [];

  for (const att of attachments) {
    let localPath = att.localPath;
    let filename = att.filename;
    let extractedText = att.extractedText;
    let isScanned = att.isScanned;
    let sheetNames = att.sheetNames;

    if (att.url && !localPath) {
      const downloadRes = await downloadAttachment(att.url, {
        originalFilename: att.title || att.name,
      });
      if (downloadRes) {
        localPath = downloadRes.localPath;
        filename = downloadRes.filename;

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
      localPath,
      filename,
      extractedText,
      isScanned,
      sheetNames,
    });
  }

  await prisma.message.update({
    where: { id: messageId },
    data: { attachments: updatedAttachments },
  });
}
