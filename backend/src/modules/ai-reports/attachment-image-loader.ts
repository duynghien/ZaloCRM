/**
 * attachment-image-loader.ts — Safely loads image attachments from disk for multimodal AI analysis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';
import type { ContentPart } from './providers/ai-provider-interface.js';

const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per single image
const MAX_TOTAL_IMAGE_PAYLOAD_BYTES = 12 * 1024 * 1024; // 12 MB max payload across all images

/**
 * Asynchronously reads local image attachments from messages and converts them to ContentPart[] for AI processing.
 * Enforces per-image size cap (5MB), total payload cap (12MB), and parametric maximum images count.
 */
export async function extractImagePartsFromMessages(
  rawMessages: any[],
  maxImages: number = 5,
): Promise<ContentPart[]> {
  const imageParts: ContentPart[] = [];
  const uploadDir = config.uploadDir || path.resolve(process.cwd(), 'uploads');
  const attachmentsDir = path.resolve(uploadDir, 'attachments');
  let totalBytes = 0;

  for (const msg of rawMessages) {
    if (!msg.attachments) continue;
    const atts = Array.isArray(msg.attachments) ? msg.attachments : [msg.attachments];

    for (const att of atts) {
      if (!att) continue;
      const mime = att.mimeType || att.mimetype || '';
      if (!mime.startsWith('image/')) continue;

      let candidatePath = att.localPath;
      if (!candidatePath && att.filename) {
        candidatePath = path.resolve(attachmentsDir, att.filename);
      }
      if (!candidatePath && att.filePath) {
        candidatePath = att.filePath;
      }

      if (candidatePath) {
        const resolved = path.resolve(candidatePath);
        if (!resolved.startsWith(uploadDir)) {
          logger.warn(`[attachment-image-loader] Path traversal or out-of-bounds file path rejected: ${candidatePath}`);
          continue;
        }

        try {
          const stats = await fs.promises.stat(resolved);
          if (stats.size > 0 && stats.size <= MAX_IMAGE_FILE_SIZE) {
            if (totalBytes + stats.size > MAX_TOTAL_IMAGE_PAYLOAD_BYTES) {
              logger.warn(`[attachment-image-loader] Total image payload cap 12MB reached, stopping image loading`);
              return imageParts;
            }

            const buffer = await fs.promises.readFile(resolved);
            const data = buffer.toString('base64');
            imageParts.push({
              inlineData: {
                mimeType: mime,
                data,
              },
            });
            totalBytes += stats.size;

            if (imageParts.length >= maxImages) {
              return imageParts;
            }
          }
        } catch (err: any) {
          if (err?.code !== 'ENOENT') {
            logger.warn(`[attachment-image-loader] Failed to read image ${resolved}: ${err?.message}`);
          }
        }
      }
    }
  }

  return imageParts;
}
