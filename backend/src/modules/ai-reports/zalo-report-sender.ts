/** Dispatch reports using one explicit sender, with a live guard at every external call. */
import { zaloPool } from '../zalo/zalo-pool.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { generateExecutiveBrief } from './report-brief-service.js';
import { generateReportPdfFile } from './report-pdf-service.js';
import { formatMarkdownForZalo, splitReportBySections } from './zalo-text-formatter.js';

export type ReportPrefixType = 'digest' | 'audit' | 'none';

export interface SendZaloReportOptions {
  accountId: string;
  orgId: string;
  destinationType: 'self' | 'cloud' | 'uid' | 'group';
  targetUid?: string;
  targetThreadId?: string;
  markdownContent: string;
  reportTitle?: string;
  periodText?: string;
  customPrefixType?: ReportPrefixType;
  deliveryMode?: 'dual_pdf' | 'full_text';
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
const BURST_PACING_MS = 30000;
const PHONE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const VIETNAMESE_PHONE_REGEX = /^(0|84)[35789]\d{8}$/;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface PhoneUidCacheEntry {
  uid: string;
  expiresAt: number;
}
const phoneToUidCache = new Map<string, PhoneUidCacheEntry>();

export function _clearPhoneToUidCache(): void {
  phoneToUidCache.clear();
}

const formatPrefix = (prefixType: ReportPrefixType, part: number, total: number) => {
  if (prefixType === 'audit') {
    return `📋 [ĐÁNH GIÁ TUÂN THỦ - PHẦN ${part}/${total}]\n\n`;
  }
  if (prefixType === 'none') {
    return '';
  }
  return `📋 [BÁO CÁO ĐIỀU HÀNH - PHẦN ${part}/${total}]\n\n`;
};

/** Reserve numbering space before splitting, including unbroken paragraphs. */
export function splitReportForZalo(
  markdown: string,
  maxLen = MAX_ZALO_MESSAGE_LENGTH,
  prefixType: ReportPrefixType = 'digest',
): string[] {
  if (!Number.isSafeInteger(maxLen) || maxLen <= 0) throw new Error('invalid_message_length');
  if (markdown.length <= maxLen) return [markdown];
  let total = 2;
  let chunks: string[];
  for (;;) {
    const pfx = formatPrefix(prefixType, total, total);
    const capacity = maxLen - pfx.length;
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
    if (formatPrefix(prefixType, chunks.length, chunks.length).length <= formatPrefix(prefixType, total, total).length) break;
    total = chunks.length;
  }
  return chunks.map((chunk, index) => formatPrefix(prefixType, index + 1, chunks.length) + chunk);
}

export async function sendReportToZalo(options: SendZaloReportOptions): Promise<SendZaloReportResult> {
  const {
    accountId,
    orgId,
    destinationType,
    targetUid,
    targetThreadId,
    markdownContent,
    reportTitle,
    periodText,
    customPrefixType = 'digest',
    deliveryMode,
  } = options;

  let parts: string[] = [];
  let attachmentPath: string | undefined;
  let pdfCleanup: (() => Promise<void>) | null = null;
  let partsSent = 0;
  let deliveryUncertain = false;

  const isDualPdf = deliveryMode === 'dual_pdf' || (deliveryMode !== 'full_text' && customPrefixType === 'digest' && (markdownContent.includes('## 1.') || markdownContent.includes('## 🎯')));

  try {
    if (isDualPdf) {
      try {
        const brief = generateExecutiveBrief(markdownContent);
        const title = reportTitle || 'Báo Cáo Điều Hành';
        const pdfFile = await generateReportPdfFile(title, markdownContent, { periodText });
        attachmentPath = pdfFile.filePath;
        pdfCleanup = pdfFile.cleanup;
        parts = [brief];
      } catch (pdfErr) {
        logger.warn({ error: pdfErr }, '[zalo-report-sender] Failed to generate PDF, falling back to full text');
        const cleanText = formatMarkdownForZalo(markdownContent);
        parts = splitReportBySections(cleanText, MAX_ZALO_MESSAGE_LENGTH, (p, t) => formatPrefix(customPrefixType, p, t));
      }
    } else if (deliveryMode === 'full_text' || markdownContent.includes('##')) {
      const cleanText = formatMarkdownForZalo(markdownContent);
      parts = splitReportBySections(cleanText, MAX_ZALO_MESSAGE_LENGTH, (p, t) => formatPrefix(customPrefixType, p, t));
    } else {
      parts = splitReportForZalo(markdownContent, MAX_ZALO_MESSAGE_LENGTH, customPrefixType);
    }
    if (!accountId) throw new Error('report_sender_required');
    if (typeof options.executionGuard !== 'function') throw new Error('report_execution_guard_required');

    const account = await prisma.zaloAccount.findFirst({
      where: { id: accountId, orgId, status: 'connected' },
      select: { zaloUid: true },
    });
    if (!account) throw new Error('report_sender_unavailable');

    await options.executionGuard();
    const api = zaloPool.getApi(accountId);
    if (!api) throw new Error('report_sender_unavailable');

    // Resolve destId and threadType ONCE before chunk pacing loop
    let destId: string;
    let threadType: number; // 0 = User/Cloud, 1 = Group

    if (destinationType === 'group') {
      if (!targetThreadId) throw new Error('report_destination_required');
      destId = targetThreadId;
      threadType = 1;
    } else if (destinationType === 'self' || destinationType === 'cloud') {
      const send2meId = zaloPool.getSend2MeId(accountId) || api.getContext?.()?.loginInfo?.send2me_id;
      if (!send2meId) {
        throw new Error('Không thể xác định Cloud của tôi (send2me_id). Vui lòng kết nối lại tài khoản Zalo để làm mới phiên làm việc.');
      }
      destId = send2meId;
      threadType = 0;
    } else if (destinationType === 'uid') {
      if (!targetUid) throw new Error('report_destination_required');
      threadType = 0;
      const cleaned = targetUid.replace(/\D/g, '');

      if (VIETNAMESE_PHONE_REGEX.test(cleaned)) {
        let phone0 = cleaned;
        let phone84 = cleaned;
        if (cleaned.startsWith('84')) {
          phone0 = '0' + cleaned.slice(2);
        } else if (cleaned.startsWith('0')) {
          phone84 = '84' + cleaned.slice(1);
        }

        // 1. In-memory TTL cache lookup
        const cached = phoneToUidCache.get(phone0);
        if (cached && cached.expiresAt > Date.now()) {
          destId = cached.uid;
        } else {
          // 2. CRM contact lookup
          const contact = await prisma.contact.findFirst({
            where: {
              orgId,
              phone: { in: [targetUid, cleaned, phone0, phone84] },
              zaloUid: { not: null },
            },
            select: { id: true, zaloUid: true },
          });

          if (contact?.zaloUid) {
            destId = contact.zaloUid;
            phoneToUidCache.set(phone0, { uid: destId, expiresAt: Date.now() + PHONE_CACHE_TTL_MS });
          } else {
            // 3. Zalo API findUser lookup
            let user: any = null;
            try {
              user = await api.findUser(cleaned);
              if (!user?.uid && cleaned !== phone0) {
                user = await api.findUser(phone0);
              }
            } catch (findErr) {
              logger.warn({ accountId, targetUid, cleaned, error: findErr }, '[zalo-report-sender] api.findUser error');
            }

            if (user?.uid) {
              destId = String(user.uid);
              phoneToUidCache.set(phone0, { uid: destId, expiresAt: Date.now() + PHONE_CACHE_TTL_MS });

              // Update existing contact if phone exists without zaloUid; do not create new contact
              try {
                const existingWithoutUid = await prisma.contact.findFirst({
                  where: {
                    orgId,
                    phone: { in: [targetUid, cleaned, phone0, phone84] },
                    zaloUid: null,
                  },
                  select: { id: true },
                });
                if (existingWithoutUid) {
                  await prisma.contact.update({
                    where: { id: existingWithoutUid.id },
                    data: { zaloUid: destId },
                  });
                }
              } catch (updateErr) {
                logger.warn({ error: updateErr }, '[zalo-report-sender] Failed to update contact zaloUid');
              }
            } else {
              throw new Error(`Không tìm thấy tài khoản Zalo liên kết với số điện thoại "${targetUid}". Vui lòng kiểm tra quyền riêng tư Zalo của số này hoặc nhập trực tiếp Zalo UID.`);
            }
          }
        }
      } else {
        destId = targetUid;
      }
    } else {
      throw new Error('report_destination_required');
    }

    // Chunk delivery loop with pacing and rate limiting
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        await sleep(PACING_DELAY_MS);
        // Dynamic burst pacing: after every 3 messages, wait for the 30-second burst window
        if (i % 3 === 0) {
          await sleep(BURST_PACING_MS);
        }
      }

      await options.executionGuard();
      const currentApi = zaloPool.getApi(accountId);
      if (!currentApi) throw new Error('report_sender_unavailable');

      let limits = zaloRateLimiter.checkLimits(accountId);
      if (!limits.allowed && limits.reason?.includes('30s')) {
        await sleep(BURST_PACING_MS);
        limits = zaloRateLimiter.checkLimits(accountId);
      }
      if (!limits.allowed) throw new Error(`Chạm giới hạn gửi tin Zalo: ${limits.reason}`);

      zaloRateLimiter.recordSend(accountId);
      deliveryUncertain = true;
      if (attachmentPath && i === parts.length - 1) {
        await currentApi.sendMessage({ msg: parts[i], attachments: [attachmentPath] }, destId, threadType);
      } else {
        await currentApi.sendMessage({ msg: parts[i] }, destId, threadType);
      }
      partsSent++;
      await options.onPartSent?.(partsSent, parts.length);
      deliveryUncertain = false;
    }
    return { success: true, partsSent, totalParts: parts.length, deliveryUncertain: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi khi gửi tin qua Zalo API';
    logger.warn({ accountId, partsSent, totalParts: parts.length, deliveryUncertain }, '[zalo-report-sender] Dispatch stopped');
    return { success: false, partsSent, totalParts: parts.length, deliveryUncertain, error: message };
  } finally {
    if (pdfCleanup) {
      await pdfCleanup();
    }
  }
}

/**
 * Format executive report action items into a clean, professional, plain-text Zalo broadcast message.
 * Strictly plain text with emojis; no CRM URLs to avoid spam detection and internal host issues.
 */
export function formatTasksForZaloMessage(
  reportTitle: string,
  groupName: string,
  tasks: Array<{
    task: string;
    assignee?: string;
    deadline?: string;
    priority?: 'high' | 'medium' | 'low';
    done?: boolean;
  }>,
  customNote?: string,
): string {
  const highTasks = tasks.filter((t) => t.priority === 'high');
  const mediumTasks = tasks.filter((t) => t.priority === 'medium' || !t.priority);
  const lowTasks = tasks.filter((t) => t.priority === 'low');

  const lines: string[] = [
    '📢 [BÀN GIAO CA & NHIỆM VỤ CẦN XỬ LÝ]',
    `Từ báo cáo điều hành: ${reportTitle}`,
    `Nhóm: ${groupName}`,
  ];

  if (customNote && customNote.trim()) {
    lines.push(`\n💬 Ghi chú: ${customNote.trim()}`);
  }

  lines.push('');

  let counter = 1;
  if (highTasks.length > 0) {
    lines.push('🔴 Ưu tiên cao:');
    for (const t of highTasks) {
      const status = t.done ? ' [Đã xong]' : '';
      lines.push(`${counter++}. ${t.task}${status}`);
      lines.push(`   👉 Phụ trách: ${t.assignee || 'Chưa phân công'} | Hạn: ${t.deadline || 'Trong ca'}`);
    }
    lines.push('');
  }

  if (mediumTasks.length > 0) {
    lines.push('🟡 Ưu tiên trung bình:');
    for (const t of mediumTasks) {
      const status = t.done ? ' [Đã xong]' : '';
      lines.push(`${counter++}. ${t.task}${status}`);
      lines.push(`   👉 Phụ trách: ${t.assignee || 'Chưa phân công'} | Hạn: ${t.deadline || 'Trong ca'}`);
    }
    lines.push('');
  }

  if (lowTasks.length > 0) {
    lines.push('🟢 Ưu tiên thấp:');
    for (const t of lowTasks) {
      const status = t.done ? ' [Đã xong]' : '';
      lines.push(`${counter++}. ${t.task}${status}`);
      lines.push(`   👉 Phụ trách: ${t.assignee || 'Chưa phân công'} | Hạn: ${t.deadline || 'Trong ca'}`);
    }
    lines.push('');
  }

  if (tasks.length === 0) {
    lines.push('Hiện không có nhiệm vụ nào cần bàn giao.');
    lines.push('');
  }

  lines.push('⚡ Đề nghị các nhân sự nhận việc kiểm tra và báo cáo tiến độ xử lý vào nhóm!');

  return lines.join('\n');
}

