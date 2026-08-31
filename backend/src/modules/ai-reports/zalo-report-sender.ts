/**
 * zalo-report-sender.ts — Dispatches generated executive reports to personal Zalo or specified UIDs
 * with automatic message splitting and rate limiter pacing.
 */
import { zaloPool } from '../zalo/zalo-pool.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export interface SendZaloReportOptions {
  accountId?: string;
  orgId: string;
  destinationType: 'self' | 'cloud' | 'uid';
  targetUid?: string;
  markdownContent: string;
  reportTitle?: string;
}

export interface SendZaloReportResult {
  success: boolean;
  partsSent: number;
  totalParts: number;
  error?: string;
}

const MAX_ZALO_MESSAGE_LENGTH = 2500;
const PACING_DELAY_MS = 2000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Split long markdown content into chunks under max length, keeping section headers intact.
 */
export function splitReportForZalo(markdown: string, maxLen = MAX_ZALO_MESSAGE_LENGTH): string[] {
  if (markdown.length <= maxLen) {
    return [markdown];
  }

  // Split by markdown sections (## )
  const sections = markdown.split(/(?=\n##\s)/g);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const section of sections) {
    if (currentChunk.length + section.length <= maxLen) {
      currentChunk += section;
    } else {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
      }
      // If a single section is larger than maxLen, split by paragraph
      if (section.length > maxLen) {
        const paragraphs = section.split('\n\n');
        let subChunk = '';
        for (const p of paragraphs) {
          if (subChunk.length + p.length <= maxLen) {
            subChunk += (subChunk ? '\n\n' : '') + p;
          } else {
            if (subChunk.trim()) chunks.push(subChunk.trim());
            subChunk = p;
          }
        }
        if (subChunk.trim()) currentChunk = subChunk;
        else currentChunk = '';
      } else {
        currentChunk = section;
      }
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  // Prefix each chunk with part numbering
  const total = chunks.length;
  if (total > 1) {
    return chunks.map((chunk, idx) => `📋 [BÁO CÁO ĐIỀU HÀNH - PHẦN ${idx + 1}/${total}]\n\n${chunk}`);
  }

  return chunks;
}

/**
 * Send an AI report to Zalo destination with auto-splitting and pacing.
 */
export async function sendReportToZalo(options: SendZaloReportOptions): Promise<SendZaloReportResult> {
  const { orgId, destinationType, targetUid, markdownContent } = options;

  let accountId = options.accountId;

  // If accountId is not provided, pick first connected Zalo account in the org
  if (!accountId) {
    const connectedAccount = await prisma.zaloAccount.findFirst({
      where: { orgId, status: 'connected' },
      select: { id: true, zaloUid: true },
    });
    if (!connectedAccount) {
      logger.warn(`[zalo-report-sender] No connected Zalo account found for org ${orgId}`);
      return {
        success: false,
        partsSent: 0,
        totalParts: 0,
        error: 'Không tìm thấy tài khoản Zalo nào đang kết nối trong tổ chức.',
      };
    }
    accountId = connectedAccount.id;
  }

  const instance = zaloPool.getInstance(accountId);
  if (!instance?.api) {
    logger.warn(`[zalo-report-sender] Zalo instance not connected for account ${accountId}`);
    return {
      success: false,
      partsSent: 0,
      totalParts: 0,
      error: 'Tài khoản Zalo gửi tin bị ngắt kết nối.',
    };
  }

  // Resolve target UID
  let destinationUid = targetUid;
  if (destinationType === 'self' || destinationType === 'cloud') {
    const acc = await prisma.zaloAccount.findUnique({
      where: { id: accountId },
      select: { zaloUid: true },
    });
    destinationUid = acc?.zaloUid || undefined;
  }

  if (!destinationUid) {
    return {
      success: false,
      partsSent: 0,
      totalParts: 0,
      error: 'Không xác định được Zalo UID người nhận.',
    };
  }

  const parts = splitReportForZalo(markdownContent);
  let sentCount = 0;

  for (let i = 0; i < parts.length; i++) {
    const partContent = parts[i];

    // Check rate limit
    const limits = zaloRateLimiter.checkLimits(accountId);
    if (!limits.allowed) {
      logger.warn(`[zalo-report-sender] Rate limit hit for account ${accountId}: ${limits.reason}`);
      return {
        success: sentCount > 0,
        partsSent: sentCount,
        totalParts: parts.length,
        error: `Chạm giới hạn gửi tin Zalo: ${limits.reason}`,
      };
    }

    try {
      zaloRateLimiter.recordSend(accountId);
      // ThreadType: 0 = User
      await instance.api.sendMessage({ msg: partContent }, destinationUid, 0);
      sentCount++;
      logger.info(`[zalo-report-sender] Sent part ${i + 1}/${parts.length} to ${destinationUid}`);

      // Pacing delay between parts
      if (i < parts.length - 1) {
        await sleep(PACING_DELAY_MS);
      }
    } catch (err: any) {
      logger.error(`[zalo-report-sender] Error sending part ${i + 1} to ${destinationUid}:`, err?.message || err);
      return {
        success: sentCount > 0,
        partsSent: sentCount,
        totalParts: parts.length,
        error: err?.message || 'Lỗi khi gửi tin qua Zalo API',
      };
    }
  }

  return {
    success: true,
    partsSent: sentCount,
    totalParts: parts.length,
  };
}
