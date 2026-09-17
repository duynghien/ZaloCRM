/**
 * attachment-image-loader.ts — Safely loads image attachments from disk and Zalo CDN for multimodal AI analysis.
 * Features concurrent resilient downloads, anti-collision caching, tenant isolation, and interleaved context mapping.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';
import { downloadPublicHttpsToFile } from '../../shared/security/outbound-url-policy.js';
import type { ContentPart } from './providers/ai-provider-interface.js';
import {
  extractAndDeduplicateCandidates,
  groupCandidatesIntoBursts,
  samplePhotoBursts,
  type ImageCandidate,
} from './attachment-burst-sampler.js';

export const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per single image
export const MAX_TOTAL_IMAGE_PAYLOAD_BYTES = 12 * 1024 * 1024; // 12 MB max payload across all images
export const DOWNLOAD_TIMEOUT_MS = 5_000; // 5 seconds max per image download
const CONCURRENCY_LIMIT = 4; // 4 concurrent download workers

export interface ExtractImageOptions {
  orgId?: string;
  uploadDir?: string;
  executionGuard?: () => Promise<void>;
  signal?: AbortSignal;
}

interface LoadedPhoto {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Verify that a given URL belongs to an approved Zalo CDN domain (Anti-Blind SSRF).
 */
export function isWhitelistedZaloCdnUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (/^photo-stal-[a-z0-9-]+\.zdn\.vn$/.test(host)) return true;
    if (host === 'zaloapp.com' || host.endsWith('.zaloapp.com')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Sniff image MIME type by inspecting buffer magic bytes.
 */
export function sniffImageMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (
    buffer.length >= 6 &&
    (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')
  ) {
    return 'image/gif';
  }
  return null;
}

function isPathInside(baseDir: string, targetPath: string): boolean {
  const rel = path.relative(baseDir, targetPath);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Loads a single image candidate from local storage or cached/downloaded Zalo CDN.
 * Guaranteed isolated failure: returns null on error without throwing.
 */
async function loadSingleCandidate(
  candidate: ImageCandidate,
  uploadDir: string,
  tenantTargetDir: string,
  options: ExtractImageOptions,
): Promise<LoadedPhoto | null> {
  if (options.signal?.aborted) return null;

  try {
    if (options.executionGuard) {
      await options.executionGuard();
    }

    let buffer: Buffer | null = null;
    let detectedMime = candidate.mimeType || 'image/jpeg';

    // Path A: Local file
    if (candidate.localPath) {
      const resolved = path.resolve(candidate.localPath);
      if (!isPathInside(uploadDir, resolved)) {
        logger.warn(`[attachment-image-loader] Path traversal rejected: ${candidate.localPath}`);
        return null;
      }

      const stats = await fs.promises.stat(resolved).catch(() => null);
      if (stats && stats.size > 0 && stats.size <= MAX_IMAGE_FILE_SIZE) {
        buffer = await fs.promises.readFile(resolved).catch(() => null);
      }
    }

    // Path B: Remote URL (Zalo CDN whitelist check + anti-collision deterministic cache)
    if (!buffer && candidate.url) {
      if (!isWhitelistedZaloCdnUrl(candidate.url)) {
        logger.warn(`[attachment-image-loader] Non-whitelisted URL rejected: ${candidate.url}`);
        return null;
      }

      const urlHash = crypto.createHash('sha256').update(candidate.url).digest('hex').slice(0, 32);
      const rawExt = candidate.url.split('?')[0].split('.').pop() || 'jpg';
      const sanitizedExt = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4) || 'jpg';
      const cachedPath = path.join(tenantTargetDir, `${urlHash}.${sanitizedExt}`);

      if (!isPathInside(tenantTargetDir, cachedPath)) {
        logger.warn(`[attachment-image-loader] Invalid cache path: ${cachedPath}`);
        return null;
      }

      if (fs.existsSync(cachedPath)) {
        buffer = await fs.promises.readFile(cachedPath).catch(() => null);
      } else {
        const randomHex = crypto.randomBytes(4).toString('hex');
        const partialPath = `${cachedPath}.part-${Date.now()}-${randomHex}`;
        try {
          const dlResult = await downloadPublicHttpsToFile(candidate.url, partialPath, {
            timeoutMs: DOWNLOAD_TIMEOUT_MS,
            maxResponseBytes: MAX_IMAGE_FILE_SIZE,
          });
          if (dlResult.ok && fs.existsSync(partialPath)) {
            await fs.promises.rename(partialPath, cachedPath);
            buffer = await fs.promises.readFile(cachedPath).catch(() => null);
          } else {
            await fs.promises.unlink(partialPath).catch(() => undefined);
          }
        } catch (dlErr: any) {
          await fs.promises.unlink(partialPath).catch(() => undefined);
          logger.warn(`[attachment-image-loader] Download failed for ${candidate.url}: ${dlErr?.message}`);
          return null;
        }
      }
    }

    if (!buffer || buffer.length === 0 || buffer.length > MAX_IMAGE_FILE_SIZE) {
      return null;
    }

    const sniffedMime = sniffImageMimeType(buffer);
    if (sniffedMime) {
      detectedMime = sniffedMime;
    } else if (detectedMime.startsWith('image/')) {
      // Retain declared image MIME
    } else {
      // Non-image buffer (e.g. PDF/XLSX binary), do not coerce to JPEG
      return null;
    }

    return { buffer, mimeType: detectedMime };
  } catch (err: any) {
    logger.warn(`[attachment-image-loader] Failed to load candidate ${candidate.url || candidate.localPath}: ${err?.message}`);
    return null;
  }
}

/**
 * Executes async tasks concurrently with a worker pool limit.
 */
async function runConcurrent<T, R>(
  items: T[],
  limit: number,
  taskFn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await taskFn(items[idx], idx);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Asynchronously loads image attachments from disk or Zalo CDN and converts them to ContentPart[] for AI processing.
 * Implements Smart Burst Sampling, deduplication, contextual banners, and 4-worker concurrent loading.
 */
export async function extractImagePartsFromMessages(
  rawMessages: any[],
  maxImages: number = 15,
  options: ExtractImageOptions = {},
): Promise<ContentPart[]> {
  let uploadDir = options.uploadDir || config.uploadDir || path.resolve(process.cwd(), 'uploads');
  let attachmentsDir = path.resolve(uploadDir, 'attachments');
  const tenantDirName = options.orgId ? options.orgId.replace(/[^a-zA-Z0-9_-]/g, '') : 'common';
  let tenantTargetDir = path.resolve(attachmentsDir, tenantDirName);

  try {
    if (!fs.existsSync(tenantTargetDir)) {
      fs.mkdirSync(tenantTargetDir, { recursive: true });
    }
  } catch {
    // If system directory (e.g. /var/lib/zalo-crm/files) is non-writable in development/tests, fallback to local uploads
    uploadDir = path.resolve(process.cwd(), 'uploads');
    attachmentsDir = path.resolve(uploadDir, 'attachments');
    tenantTargetDir = path.resolve(attachmentsDir, tenantDirName);
    if (!fs.existsSync(tenantTargetDir)) {
      fs.mkdirSync(tenantTargetDir, { recursive: true });
    }
  }

  // 1. Extract candidates and deduplicate via normalized Base URL / localPath
  const uniqueCandidates = extractAndDeduplicateCandidates(rawMessages, attachmentsDir);
  if (uniqueCandidates.length === 0) {
    return [];
  }

  // 2. Group into bursts and apply Smart Burst Sampling
  const bursts = groupCandidatesIntoBursts(uniqueCandidates);
  const sampledBursts = samplePhotoBursts(bursts, maxImages);
  const totalSampled = sampledBursts.reduce((sum, b) => sum + b.sampledCandidates.length, 0);

  logger.info(
    `[multimodal] Found ${bursts.length} photo bursts (${uniqueCandidates.length} unique photos). Sampled ${totalSampled} representative photos.`,
  );

  // 3. Load photos concurrently using worker pool (concurrency: 4)
  // Flatten candidates with reference to their burst
  interface FlatCandidateTask {
    burstIndex: number;
    candidate: ImageCandidate;
  }

  const tasks: FlatCandidateTask[] = [];
  sampledBursts.forEach((sb, burstIndex) => {
    sb.sampledCandidates.forEach((candidate) => {
      tasks.push({ burstIndex, candidate });
    });
  });

  const loadedResults = await runConcurrent(tasks, CONCURRENCY_LIMIT, async (task) => {
    return loadSingleCandidate(task.candidate, uploadDir, tenantTargetDir, options);
  });

  // 4. Map loaded photos back to bursts
  const burstPhotosMap = new Map<number, LoadedPhoto[]>();
  tasks.forEach((task, idx) => {
    const photo = loadedResults[idx];
    if (photo) {
      if (!burstPhotosMap.has(task.burstIndex)) {
        burstPhotosMap.set(task.burstIndex, []);
      }
      burstPhotosMap.get(task.burstIndex)!.push(photo);
    }
  });

  // 5. Interleave context banners and image parts within payload limits
  const imageParts: ContentPart[] = [];
  let totalBytes = 0;
  let loadedImageCount = 0;

  for (let i = 0; i < sampledBursts.length; i++) {
    if (options.signal?.aborted) break;
    const photos = burstPhotosMap.get(i);
    if (!photos || photos.length === 0) continue;

    const burst = sampledBursts[i].burst;
    const bannerText = burst.contextText
      ? `\n--- [HÌNH ẢNH MINH CHỨNG CHO: "${burst.contextText}"] ---`
      : `\n--- [HÌNH ẢNH MINH CHỨNG HOẠT ĐỘNG] ---`;

    const burstParts: ContentPart[] = [{ text: bannerText }];
    let burstBytes = 0;
    let burstAddedCount = 0;

    for (const photo of photos) {
      if (totalBytes + burstBytes + photo.buffer.length > MAX_TOTAL_IMAGE_PAYLOAD_BYTES) {
        logger.warn(`[attachment-image-loader] Total image payload cap 12MB reached, stopping further image additions`);
        break;
      }
      burstParts.push({
        inlineData: {
          mimeType: photo.mimeType,
          data: photo.buffer.toString('base64'),
        },
      });
      burstBytes += photo.buffer.length;
      burstAddedCount++;
    }

    if (burstAddedCount > 0) {
      imageParts.push(...burstParts);
      totalBytes += burstBytes;
      loadedImageCount += burstAddedCount;
    }
  }

  logger.info(
    `[multimodal] Loaded ${loadedImageCount} images (${(totalBytes / 1024 / 1024).toFixed(2)} MB) for multimodal cross-verification.`,
  );

  return imageParts;
}
