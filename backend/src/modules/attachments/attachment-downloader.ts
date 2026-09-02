/**
 * attachment-downloader.ts — Downloads attachments (PDF, Excel, Images) from URLs
 * to local permanent storage with size limits and security headers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';
import { downloadPublicHttpsToFile } from '../../shared/security/outbound-url-policy.js';

export interface DownloadResult {
  localPath: string;
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Get or create the local attachments storage directory
 */
export function getAttachmentsDirectory(): string {
  const baseDir = config.uploadDir || path.resolve(process.cwd(), 'uploads');
  const targetDir = path.resolve(baseDir, 'attachments');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  return targetDir;
}

/**
 * Download an attachment file from a URL (e.g. Zalo CDN) safely.
 */
export async function downloadAttachment(
  url: string,
  options?: {
    originalFilename?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<DownloadResult | null> {
  try {
    if (!url || typeof url !== 'string') {
      logger.warn(`[attachment-downloader] Invalid URL provided: ${url}`);
      return null;
    }

    const defaultHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...(options?.headers || {}),
    };

    const rawFilename = options?.originalFilename || url.split('?')[0].split('/').pop() || `attachment-${Date.now()}`;
    const sanitizedFilename = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160);
    const uniqueFilename = `${randomUUID()}-${sanitizedFilename}`;
    const targetDir = getAttachmentsDirectory();
    const localPath = path.join(targetDir, uniqueFilename);
    const partialPath = `${localPath}.part`;
    let response;
    try {
      response = await downloadPublicHttpsToFile(url, partialPath, {
        method: 'GET',
        headers: defaultHeaders,
        timeoutMs: options?.timeoutMs || 30_000,
        maxResponseBytes: MAX_FILE_SIZE_BYTES,
      });
    } catch (error) {
      await fs.promises.unlink(partialPath).catch(() => undefined);
      throw error;
    }

    if (!response.ok) {
      await fs.promises.unlink(partialPath).catch(() => undefined);
      logger.warn(`[attachment-downloader] Failed to download from ${url}: status ${response.status}`);
      return null;
    }

    try {
      await fs.promises.rename(partialPath, localPath);
    } catch (error) {
      await fs.promises.unlink(partialPath).catch(() => undefined);
      throw error;
    }

    const mimeType = response.headers.get('content-type') || 'application/octet-stream';
    logger.info(`[attachment-downloader] Saved attachment to ${localPath} (${response.bytes} bytes)`);

    return {
      localPath,
      filename: uniqueFilename,
      originalName: sanitizedFilename,
      size: response.bytes,
      mimeType,
    };
  } catch (err: any) {
    logger.error(`[attachment-downloader] Error downloading attachment from ${url}:`, err?.message || err);
    return null;
  }
}
