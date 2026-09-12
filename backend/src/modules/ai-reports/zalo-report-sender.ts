/** Dispatch reports using one explicit sender, with a live guard at every external call. */
import { zaloPool } from '../zalo/zalo-pool.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export interface SendZaloReportOptions {
  accountId: string;
  orgId: string;
  destinationType: 'self' | 'cloud' | 'uid';
  targetUid?: string;
  markdownContent: string;
  reportTitle?: string;
  executionGuard: () => Promise<void>;
  onPartSent?: (partsSent: number, totalParts: number) => Promise<void>;
}

export interface SendZaloReportResult {
  success: boolean;
  partsSent: number;
  totalParts: number;
  deliveryUncertain: boolean;
  error?: string;
}

const MAX_ZALO_MESSAGE_LENGTH = 2500;
const PACING_DELAY_MS = 2000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const prefix = (part: number, total: number) => `📋 [BÁO CÁO ĐIỀU HÀNH - PHẦN ${part}/${total}]\n\n`;

/** Reserve numbering space before splitting, including unbroken paragraphs. */
export function splitReportForZalo(markdown: string, maxLen = MAX_ZALO_MESSAGE_LENGTH): string[] {
  if (!Number.isSafeInteger(maxLen) || maxLen <= 0) throw new Error('invalid_message_length');
  if (markdown.length <= maxLen) return [markdown];
  let total = 2;
  let chunks: string[];
  for (;;) {
    const capacity = maxLen - prefix(total, total).length;
    if (capacity < 2) throw new Error('message_length_too_small');
    chunks = [];
    for (let offset = 0; offset < markdown.length;) {
      let end = Math.min(offset + capacity, markdown.length);
      if (end < markdown.length) {
        const newline = markdown.lastIndexOf('\n', end - 1);
        if (newline > offset + capacity / 2) end = newline + 1;
        // Do not bisect a UTF-16 surrogate pair.
        const last = markdown.charCodeAt(end - 1);
        if (last >= 0xd800 && last <= 0xdbff) end--;
      }
      chunks.push(markdown.slice(offset, end));
      offset = end;
    }
    if (prefix(chunks.length, chunks.length).length <= prefix(total, total).length) break;
    total = chunks.length;
  }
  return chunks.map((chunk, index) => prefix(index + 1, chunks.length) + chunk);
}

export async function sendReportToZalo(options: SendZaloReportOptions): Promise<SendZaloReportResult> {
  const { accountId, orgId, destinationType, targetUid, markdownContent } = options;
  const parts = splitReportForZalo(markdownContent);
  let partsSent = 0;
  let deliveryUncertain = false;
  try {
    if (!accountId) throw new Error('report_sender_required');
    if (typeof options.executionGuard !== 'function') throw new Error('report_execution_guard_required');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) await sleep(PACING_DELAY_MS);
      const account = await prisma.zaloAccount.findFirst({
        where: { id: accountId, orgId, status: 'connected' },
        select: { zaloUid: true },
      });
      if (!account) throw new Error('report_sender_unavailable');
      const destinationUid = destinationType === 'uid' ? targetUid : account.zaloUid;
      if (!destinationUid) throw new Error('report_destination_required');
      await options.executionGuard();
      // Resolve the current connection after the async guard; no cached SDK survives pacing.
      const api = zaloPool.getApi(accountId);
      if (!api) throw new Error('report_sender_unavailable');
      const limits = zaloRateLimiter.checkLimits(accountId);
      if (!limits.allowed) throw new Error(`Chạm giới hạn gửi tin Zalo: ${limits.reason}`);
      zaloRateLimiter.recordSend(accountId);
      deliveryUncertain = true;
      await api.sendMessage({ msg: parts[i] }, destinationUid, 0);
      partsSent++;
      await options.onPartSent?.(partsSent, parts.length);
      deliveryUncertain = false;
    }
    return { success: true, partsSent, totalParts: parts.length, deliveryUncertain: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi khi gửi tin qua Zalo API';
    logger.warn({ accountId, partsSent, totalParts: parts.length, deliveryUncertain }, '[zalo-report-sender] Dispatch stopped');
    return { success: false, partsSent, totalParts: parts.length, deliveryUncertain, error: message };
  }
}
