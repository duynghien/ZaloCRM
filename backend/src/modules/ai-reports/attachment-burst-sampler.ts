/**
 * attachment-burst-sampler.ts — Intelligent candidate extraction, deduplication,
 * prompt-injection-safe context mapping, and smart burst sampling for multimodal AI reports.
 */
import path from 'node:path';
import { logger } from '../../shared/utils/logger.js';
import { isWhitelistedZaloCdnUrl } from './attachment-image-loader.js';

export const BUSINESS_KEYWORDS = [
  'báo cáo',
  'checklist',
  'huỷ',
  'hủy',
  'hỏng',
  'lỗi',
  'thành phẩm',
  'khay hoa quả',
  'sự cố',
  'bàn giao',
  'tồn kho',
  'máy móc',
  'phiếu',
];

export interface ImageCandidate {
  localPath?: string;
  url?: string;
  normalizedKey: string;
  filename?: string;
  mimeType?: string;
  priority: number;
  sentAtMs: number;
  senderId: string;
  senderName?: string;
  contextText: string;
}

export interface PhotoBurst {
  id: string;
  contextText: string;
  senderId: string;
  startTime: number;
  endTime: number;
  candidates: ImageCandidate[];
  priority: number;
}

/**
 * Sanitizes preceding context text to prevent Prompt Injection:
 * - Strips carriage returns, newlines, and tabs.
 * - Strips brackets [ and ] to prevent prompt formatting breakout.
 * - Collapses consecutive spaces.
 * - Truncates to max 80 characters.
 */
export function sanitizeContextualPrecedingText(text: string | null | undefined): string {
  if (!text || typeof text !== 'string') return '';
  // Strip control chars, newlines, and tabs
  let cleaned = text.replace(/[\r\n\t]+/g, ' ');
  // Strip brackets to prevent prompt breakout
  cleaned = cleaned.replace(/[\[\]]/g, '');
  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  // Cut max 80 characters
  if (cleaned.length > 80) {
    cleaned = cleaned.slice(0, 77) + '...';
  }
  return cleaned;
}

/**
 * Calculates business priority score based on keywords.
 */
export function calculatePriority(text: string): number {
  const lower = text.toLowerCase();
  for (const kw of BUSINESS_KEYWORDS) {
    if (lower.includes(kw)) return 2;
  }
  return 1;
}

/**
 * Normalizes URL or file path for deduplication.
 * Strips query parameters from URLs (e.g. tracking params) and trims whitespace.
 */
export function normalizeCandidateKey(url?: string, localPath?: string): string {
  if (url) {
    const baseUrl = url.split('?')[0].trim().toLowerCase();
    return `url:${baseUrl}`;
  }
  if (localPath) {
    return `path:${path.resolve(localPath).trim().toLowerCase()}`;
  }
  return '';
}

/**
 * Extracts and deduplicates image candidates from raw messages.
 * Maps preceding contextual text from text messages occurring within 60s.
 */
export function extractAndDeduplicateCandidates(
  rawMessages: any[],
  attachmentsDir: string,
): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  const seenKeys = new Set<string>();

  // Ensure chronological order
  const sortedMessages = [...rawMessages].sort((a, b) => {
    const timeA = a.sentAt ? new Date(a.sentAt).getTime() : 0;
    const timeB = b.sentAt ? new Date(b.sentAt).getTime() : 0;
    return timeA - timeB;
  });

  let currentContextText = '';
  let lastTextTime = 0;
  let lastTextSender = '';

  interface TextEvent {
    sentAtMs: number;
    senderId: string;
    content: string;
  }
  const textEvents: TextEvent[] = [];

  for (const msg of sortedMessages) {
    const msgTime = msg.sentAt ? new Date(msg.sentAt).getTime() : 0;
    const senderId = msg.senderUid || msg.senderName || msg.senderType || 'unknown';
    const senderName = msg.senderName || senderId;
    const msgText = (msg.content || '') + ' ' + (msg.senderName || '');
    const basePriority = calculatePriority(msgText);

    // If message is a plain text message, update current preceding context
    const isJsonContent = typeof msg.content === 'string' && (msg.content.startsWith('{') || msg.content.startsWith('['));
    const isTextMessage = (msg.contentType === 'text' || !msg.contentType) && !isJsonContent && typeof msg.content === 'string';

    if (isTextMessage && msg.content.trim().length > 0) {
      currentContextText = sanitizeContextualPrecedingText(msg.content);
      lastTextTime = msgTime;
      lastTextSender = senderId;
      textEvents.push({
        sentAtMs: msgTime,
        senderId,
        content: currentContextText,
      });
    }

    // Determine relevant context for any photos in this message
    const isContextRecent = msgTime - lastTextTime <= 60_000 && lastTextSender === senderId;
    const activeContextText = isContextRecent ? currentContextText : '';

    // 1. Process attachments array
    if (msg.attachments) {
      const atts = Array.isArray(msg.attachments) ? msg.attachments : [msg.attachments];
      for (const att of atts) {
        if (!att) continue;
        let candidatePath = att.localPath;
        if (!candidatePath && att.filename) {
          candidatePath = path.resolve(attachmentsDir, att.filename);
        }
        if (!candidatePath && att.filePath) {
          candidatePath = att.filePath;
        }

        const mime = att.mimeType || att.mimetype || '';
        const isImageMime = mime.startsWith('image/');
        const fileExt = (att.extension || att.filename?.split('.').pop() || candidatePath?.split('.').pop() || '').toLowerCase().replace(/^\./, '');
        const isImageExt = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].includes(fileExt);
        const isPhotoType = att.msgType === 'chat.photo' || isImageExt;
        const isImageCandidate = isImageMime || isPhotoType;
        if (!isImageCandidate) continue;

        const candidateUrl = att.url || att.href;
        if (candidatePath || (candidateUrl && isWhitelistedZaloCdnUrl(candidateUrl))) {
          const normKey = normalizeCandidateKey(candidateUrl, candidatePath);
          if (normKey && seenKeys.has(normKey)) {
            continue; // Deduplicate
          }
          if (normKey) seenKeys.add(normKey);

          const attTitle = sanitizeContextualPrecedingText(att.title || att.name);
          const finalContext = attTitle || activeContextText;

          candidates.push({
            localPath: candidatePath,
            url: candidateUrl,
            normalizedKey: normKey,
            filename: att.filename,
            mimeType: mime,
            priority: Math.max(basePriority, calculatePriority(att.title || att.name || '')),
            sentAtMs: msgTime,
            senderId,
            senderName,
            contextText: finalContext,
          });
        }
      }
    }

    // 2. Process photo messages with JSON in content
    if (msg.contentType === 'image' || msg.msgType === 'chat.photo') {
      const content = msg.content;
      if (content && typeof content === 'string' && (content.startsWith('{') || content.startsWith('['))) {
        try {
          const parsed = JSON.parse(content);
          const photoUrl = parsed.href || parsed.url || parsed.photoUrl;
          if (photoUrl && isWhitelistedZaloCdnUrl(photoUrl)) {
            const normKey = normalizeCandidateKey(photoUrl);
            if (!normKey || !seenKeys.has(normKey)) {
              if (normKey) seenKeys.add(normKey);
              const photoCaption = sanitizeContextualPrecedingText(parsed.description || parsed.title);
              const finalContext = photoCaption || activeContextText;

              candidates.push({
                url: photoUrl,
                normalizedKey: normKey,
                mimeType: 'image/jpeg',
                priority: Math.max(basePriority, calculatePriority(parsed.title || parsed.description || '')),
                sentAtMs: msgTime,
                senderId,
                senderName,
                contextText: finalContext,
              });
            }
          }
        } catch {
          // Ignore JSON parse errors
        }
      }
    }
  }

  // Pass 2: Bidirectional lookahead context mapping ([0s, +60s]) with Anti-Interleaving
  // For each following text message, find candidates sent by the same sender within 60s before it.
  // Rule: ONLY associate with the closest preceding photo immediately before the text message;
  // NEVER bridge to earlier photos.
  for (const textEvent of textEvents) {
    if (!textEvent.content) continue;
    let closestCandidate: ImageCandidate | null = null;
    let minDiff = Infinity;

    for (const cand of candidates) {
      if (cand.senderId !== textEvent.senderId) continue;
      const diff = textEvent.sentAtMs - cand.sentAtMs;
      if (diff >= 0 && diff <= 60_000) {
        if (diff < minDiff) {
          minDiff = diff;
          closestCandidate = cand;
        }
      }
    }

    if (closestCandidate && !closestCandidate.contextText) {
      closestCandidate.contextText = textEvent.content;
      closestCandidate.priority = Math.max(
        closestCandidate.priority,
        calculatePriority(textEvent.content),
      );
    }
  }

  return candidates;
}

/**
 * Groups candidates into bursts based on sender, proximity in time, or shared context text.
 */
export function groupCandidatesIntoBursts(candidates: ImageCandidate[]): PhotoBurst[] {
  if (candidates.length === 0) return [];

  // Sort chronologically
  const sorted = [...candidates].sort((a, b) => a.sentAtMs - b.sentAtMs);
  const bursts: PhotoBurst[] = [];
  let currentBurst: PhotoBurst | null = null;

  for (const candidate of sorted) {
    if (!currentBurst) {
      currentBurst = {
        id: `burst-${bursts.length + 1}`,
        contextText: candidate.contextText,
        senderId: candidate.senderId,
        startTime: candidate.sentAtMs,
        endTime: candidate.sentAtMs,
        candidates: [candidate],
        priority: candidate.priority,
      };
      bursts.push(currentBurst);
      continue;
    }

    const isSameSender = candidate.senderId === currentBurst.senderId;
    const timeSinceEnd = candidate.sentAtMs - currentBurst.endTime;
    const isRapidBurst = timeSinceEnd >= 0 && timeSinceEnd <= 60_000;
    const hasSameContext = Boolean(
      candidate.contextText &&
      candidate.contextText === currentBurst.contextText &&
      timeSinceEnd <= 300_000,
    );

    if (isSameSender && (isRapidBurst || hasSameContext)) {
      currentBurst.candidates.push(candidate);
      currentBurst.endTime = Math.max(currentBurst.endTime, candidate.sentAtMs);
      currentBurst.priority = Math.max(currentBurst.priority, candidate.priority);
      if (!currentBurst.contextText && candidate.contextText) {
        currentBurst.contextText = candidate.contextText;
      }
    } else {
      currentBurst = {
        id: `burst-${bursts.length + 1}`,
        contextText: candidate.contextText,
        senderId: candidate.senderId,
        startTime: candidate.sentAtMs,
        endTime: candidate.sentAtMs,
        candidates: [candidate],
        priority: candidate.priority,
      };
      bursts.push(currentBurst);
    }
  }

  return bursts;
}

export interface SampledBurstResult {
  burst: PhotoBurst;
  sampledCandidates: ImageCandidate[];
}

/**
 * Applies Smart Burst Sampling:
 * - For bursts <= 3 photos: retains 100% of photos.
 * - For bursts > 3 photos: picks 3 representative photos: [first (0), middle (floor(len/2)), last (len-1)].
 * - Ensures total sampled photos across all bursts <= maxImages (default 15).
 */
export function samplePhotoBursts(
  bursts: PhotoBurst[],
  maxImages: number = 15,
): SampledBurstResult[] {
  const initialSampled: SampledBurstResult[] = [];

  for (const burst of bursts) {
    const len = burst.candidates.length;
    let sampled: ImageCandidate[];

    if (len <= 3) {
      sampled = [...burst.candidates];
    } else {
      const firstIdx = 0;
      const midIdx = Math.floor(len / 2);
      const lastIdx = len - 1;
      sampled = [
        burst.candidates[firstIdx],
        burst.candidates[midIdx],
        burst.candidates[lastIdx],
      ];
    }

    initialSampled.push({
      burst,
      sampledCandidates: sampled,
    });
  }

  // Count total sampled photos
  const totalSampledCount = initialSampled.reduce((sum, item) => sum + item.sampledCandidates.length, 0);

  if (totalSampledCount <= maxImages) {
    return initialSampled;
  }

  // If total exceeds maxImages, prioritize high priority bursts and fair distribution
  // Sort bursts by priority descending, then chronologically
  const sorted = [...initialSampled].sort((a, b) => {
    if (b.burst.priority !== a.burst.priority) {
      return b.burst.priority - a.burst.priority;
    }
    return a.burst.startTime - b.burst.startTime;
  });

  const finalResults: SampledBurstResult[] = initialSampled.map((item) => ({
    burst: item.burst,
    sampledCandidates: [],
  }));

  const resultMap = new Map<string, SampledBurstResult>();
  for (const res of finalResults) {
    resultMap.set(res.burst.id, res);
  }

  let count = 0;

  // Round 1: Give at least 1 photo to each burst in priority order
  for (const item of sorted) {
    if (count >= maxImages) break;
    const target = resultMap.get(item.burst.id)!;
    if (item.sampledCandidates.length > 0) {
      target.sampledCandidates.push(item.sampledCandidates[0]);
      count++;
    }
  }

  // Round 2: Give remaining photos up to maxImages
  for (const item of sorted) {
    if (count >= maxImages) break;
    const target = resultMap.get(item.burst.id)!;
    for (let i = 1; i < item.sampledCandidates.length; i++) {
      if (count >= maxImages) break;
      target.sampledCandidates.push(item.sampledCandidates[i]);
      count++;
    }
  }

  // Maintain original chronological burst order
  return finalResults.filter((r) => r.sampledCandidates.length > 0);
}
