/**
 * attachment-downloader.ts — Downloads attachments (PDF, Excel, Images) from URLs
 * to local permanent storage with size limits and security headers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';

export interface DownloadResult {
  localPath: string;
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  buffer: Buffer;
}

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB limit

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
    if (!url || typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      logger.warn(`[attachment-downloader] Invalid URL provided: ${url}`);
      return null;
    }

    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname === '169.254.169.254' ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      logger.warn(`[attachment-downloader] Rejected internal/private IP URL: ${url}`);
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options?.timeoutMs || 30_000);

    const defaultHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...(options?.headers || {}),
    };

    const response = await fetch(url, {
      method: 'GET',
      headers: defaultHeaders,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn(`[attachment-downloader] Failed to download from ${url}: status ${response.status}`);
      return null;
    }

    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader && parseInt(contentLengthHeader, 10) > MAX_FILE_SIZE_BYTES) {
      logger.warn(`[attachment-downloader] File exceeds 25MB limit: ${contentLengthHeader} bytes`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      logger.warn(`[attachment-downloader] Downloaded buffer exceeds 25MB limit: ${buffer.length} bytes`);
      return null;
    }

    const mimeType = response.headers.get('content-type') || 'application/octet-stream';
    const rawFilename =
      options?.originalFilename ||
      url.split('?')[0].split('/').pop() ||
      `attachment-${Date.now()}`;
    const sanitizedFilename = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueFilename = `${randomUUID()}-${sanitizedFilename}`;

    const targetDir = getAttachmentsDirectory();
    const localPath = path.join(targetDir, uniqueFilename);

    await fs.promises.writeFile(localPath, buffer);
    logger.info(`[attachment-downloader] Saved attachment to ${localPath} (${buffer.length} bytes)`);

    return {
      localPath,
      filename: uniqueFilename,
      originalName: sanitizedFilename,
      size: buffer.length,
      mimeType,
      buffer,
    };
  } catch (err: any) {
    logger.error(`[attachment-downloader] Error downloading attachment from ${url}:`, err?.message || err);
    return null;
  }
}
