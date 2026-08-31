/**
 * summarizer-service.ts — Core AI engine implementing Hierarchical Map-Reduce
 * with message chunking, empty activity guard, and executive 5-part synthesis.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { generateContent } from './ai-client.js';
import { filterAndFormatMessages, formatTranscriptForPrompt, type CleanedMessage } from './noise-filter.js';

export interface GenerateReportParams {
  orgId: string;
  userId?: string;
  reportType?: 'daily' | 'weekly' | 'on_demand';
  periodFrom: Date;
  periodTo: Date;
  groupThreadIds?: string[];
  title?: string;
  sendZalo?: boolean;
  sendEmail?: boolean;
  zaloDestinationType?: 'self' | 'uid';
  zaloTargetUid?: string;
}

export interface GroupDigestItem {
  groupThreadId: string;
  groupName: string;
  messageCount: number;
  filteredCount: number;
  summary: string;
}

const CHUNK_SIZE = 150;

/**
 * Summarize a chunk of messages for a single group (Tier 1 Map phase)
 */
async function summarizeGroupMessages(
  groupName: string,
  messages: CleanedMessage[],
  customPrompt?: string | null,
  focusKeywords?: string[],
): Promise<string> {
  if (messages.length === 0) {
    return `Nhóm ${groupName}: Không có hoạt động hoặc tin nhắn mới trong khoảng thời gian này.`;
  }

  // If group messages are within 1 chunk
  if (messages.length <= CHUNK_SIZE) {
    const transcript = formatTranscriptForPrompt(messages);
    const keywordsHint =
      focusKeywords && focusKeywords.length > 0
        ? `\nĐặc biệt chú ý và làm nổi bật các từ khóa: ${focusKeywords.join(', ')}.`
        : '';
    const customHint = customPrompt ? `\nYêu cầu trọng tâm bổ sung: ${customPrompt}` : '';

    const prompt = `Bạn là trợ lý AI chuyên nghiệp phân tích dữ liệu nhóm làm việc Zalo.
Hãy đọc nội dung trao đổi sau đây của nhóm "${groupName}" và trích xuất tóm tắt ngắn gọn, mạch lạc:

NỘI DUNG TRAO ĐỔI:
${transcript}
${keywordsHint}${customHint}

YÊU CẦU:
1. Nêu rõ các công việc đã giải quyết xong, ai phụ trách (nếu có).
2. Nêu các vấn đề phát sinh, sự cố, tồn đọng chưa xong.
3. Trích xuất các số liệu cụ thể (doanh số, tiến độ, số lượng, thời hạn, báo cáo đính kèm).
4. Các kế hoạch hoặc đầu việc tiếp theo.
5. Viết bằng tiếng Việt súc tích, gạch đầu dòng rõ ràng.`;

    try {
      return await generateContent(prompt, {
        systemInstruction: 'Bạn là chuyên gia phân tích dữ liệu vận hành và điều hành doanh nghiệp.',
        temperature: 0.2,
      });
    } catch (err: any) {
      logger.error(`[summarizer-service] Tier 1 summary failed for group ${groupName}:`, err?.message || err);
      return `Nhóm ${groupName}: Ghi nhận ${messages.length} tin nhắn trao đổi (không thể hoàn tất tóm tắt do lỗi kết nối AI).`;
    }
  }

  // If messages > CHUNK_SIZE: split into chunks and map-reduce
  const chunks: CleanedMessage[][] = [];
  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    chunks.push(messages.slice(i, i + CHUNK_SIZE));
  }

  logger.info(`[summarizer-service] Group ${groupName} has ${messages.length} messages, chunking into ${chunks.length} parts`);

  const chunkSummaries = await Promise.all(
    chunks.map(async (chunk, idx) => {
      const transcript = formatTranscriptForPrompt(chunk);
      const prompt = `Tóm tắt nhanh các điểm chính trong phần ${idx + 1}/${chunks.length} của nhóm "${groupName}":\n${transcript}`;
      try {
        return await generateContent(prompt, { temperature: 0.2 });
      } catch (err) {
        return `Phần ${idx + 1}: ${chunk.length} tin nhắn trao đổi.`;
      }
    }),
  );

  // Reduce chunk summaries
  const reducePrompt = `Dưới đây là các tóm tắt từng phần của nhóm "${groupName}":
${chunkSummaries.join('\n\n')}

Hãy tổng hợp lại thành một bản tóm tắt nhất quán, loại bỏ thông tin trùng lặp, nêu bật công việc hoàn thành, sự cố và số liệu chính.`;

  try {
    return await generateContent(reducePrompt, { temperature: 0.2 });
  } catch (err: any) {
    return chunkSummaries.join('\n\n');
  }
}

/**
 * Synthesize all group digests into the 5-part Master Executive Summary (Tier 2 Reduce phase)
 */
async function synthesizeExecutiveReport(
  groupDigests: GroupDigestItem[],
  reportType: string,
  periodFrom: Date,
  periodTo: Date,
): Promise<string> {
  const fromStr = periodFrom.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const toStr = periodTo.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const activeGroups = groupDigests.filter((g) => g.filteredCount > 0);
  const inactiveGroups = groupDigests.filter((g) => g.filteredCount === 0);

  const digestContext = groupDigests
    .map(
      (g) =>
        `### [Nhóm: ${g.groupName}] (${g.filteredCount} tin nhắn có ý nghĩa / ${g.messageCount} tổng tin nhắn)\n${g.summary}`,
    )
    .join('\n\n');

  const prompt = `Bạn là Giám đốc Vận hành (COO) / Cố vấn điều hành cấp cao.
Nhiệm vụ của bạn là đọc các bản tóm tắt hoạt động từ các nhóm Zalo dưới đây và lập một BẢN BÁO CÁO ĐIỀU HÀNH TỔNG HỢP (Executive Summary) chất lượng cao, chuẩn xác, định hướng hành động.

THỜI GIAN THEO DÕI: Từ ${fromStr} đến ${toStr}
LOẠI BÁO CÁO: ${reportType === 'daily' ? 'Báo Cáo Ngày' : reportType === 'weekly' ? 'Báo Cáo Tuần' : 'Báo Cáo Theo Yêu Cầu (On-Demand)'}

DỮ LIỆU CÁC NHÓM CÔNG VIỆC:
${digestContext}

HÃY SOẠN BÁO CÁO THEO ĐÚNG CẤU TRÚC MARKDOWN 5 PHẦN SAU ĐÂY:

# 📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP — ${reportType === 'daily' ? 'NGÀY' : reportType === 'weekly' ? 'TUẦN' : 'TỨC THÌ'}
*Thời gian: ${fromStr} — ${toStr} | Số nhóm theo dõi: ${groupDigests.length} (${activeGroups.length} nhóm có hoạt động)*

---

## 🎯 1. TÓM TẮT 3 ĐIỂM CỐT LÕI (Core Highlights)
- [Nêu 3 vấn đề / thành quả quan trọng nhất toàn bộ hệ thống đạt được hoặc cần lưu ý nhất]

## ✅ 2. CÔNG VIỆC ĐÃ HOÀN THÀNH (Completed Actions)
- [Ghi rõ công việc hoàn tất theo từng nhóm, người xử lý, kết quả cụ thể]

## ⚠️ 3. TỒN ĐỌNG, SỰ CỐ & RỦI RO PHÁT SINH (Blockers & Risks)
- [Các sự cố kỹ thuật, khiếu nại khách hàng, đơn hàng trễ hạn, rủi ro cần xử lý gấp]

## 📊 4. SỐ LIỆU, CHỈ SỐ & KPI CHÍNH (Key Metrics)
- [Tổng hợp các con số cụ thể: doanh số, đơn hàng, khách hàng mới, chi phí, tiến độ % nếu có]

## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO (Next Steps & Assignments)
- [Các đầu việc trọng tâm tiếp theo, phân công ai làm và thời hạn cần đạt]

---
*(Trạng thái nhóm không có hoạt động mới: ${inactiveGroups.map((g) => g.groupName).join(', ') || 'Không có'})*
`;

  try {
    return await generateContent(prompt, {
      systemInstruction: 'Bạn là chuyên gia quản trị và điều hành doanh nghiệp, viết báo cáo sắc sảo, trung thực, chính xác.',
      temperature: 0.2,
      maxOutputTokens: 8192,
    });
  } catch (err: any) {
    logger.error('[summarizer-service] Tier 2 synthesis failed:', err?.message || err);
    // Fallback: concatenate group summaries
    return `# Báo Cáo Tổng Hợp (${fromStr} - ${toStr})\n\n${digestContext}`;
  }
}

/**
 * Main entry point to run full AI digest pipeline
 */
export async function generateDigestReport(params: GenerateReportParams) {
  const {
    orgId,
    userId,
    reportType = 'on_demand',
    periodFrom,
    periodTo,
    groupThreadIds,
    title,
  } = params;

  logger.info(
    `[summarizer-service] Generating ${reportType} digest report for org ${orgId} from ${periodFrom.toISOString()} to ${periodTo.toISOString()}`,
  );

  // 1. Resolve which groups to include
  let targetGroupThreadIds: string[] = [];
  const groupConfigsMap = new Map<string, { groupName?: string | null; customPrompt?: string | null; focusKeywords?: string[] }>();

  if (groupThreadIds && groupThreadIds.length > 0) {
    targetGroupThreadIds = groupThreadIds;
    const configs = await prisma.groupReportConfig.findMany({
      where: { orgId, groupThreadId: { in: targetGroupThreadIds } },
    });
    for (const c of configs) {
      groupConfigsMap.set(c.groupThreadId, {
        groupName: c.groupName,
        customPrompt: c.customPrompt,
        focusKeywords: Array.isArray(c.focusKeywords) ? (c.focusKeywords as string[]) : [],
      });
    }
  } else {
    // Get enabled configs
    const enabledConfigs = await prisma.groupReportConfig.findMany({
      where: { orgId, isEnabled: true },
    });

    if (enabledConfigs.length > 0) {
      for (const c of enabledConfigs) {
        targetGroupThreadIds.push(c.groupThreadId);
        groupConfigsMap.set(c.groupThreadId, {
          groupName: c.groupName,
          customPrompt: c.customPrompt,
          focusKeywords: Array.isArray(c.focusKeywords) ? (c.focusKeywords as string[]) : [],
        });
      }
    } else {
      // Fallback: all group conversations in the org
      const groupConvs = await prisma.conversation.findMany({
        where: { orgId, threadType: 'group', externalThreadId: { not: null } },
        include: { contact: { select: { fullName: true } } },
        take: 20,
      });
      for (const conv of groupConvs) {
        if (conv.externalThreadId) {
          targetGroupThreadIds.push(conv.externalThreadId);
          groupConfigsMap.set(conv.externalThreadId, {
            groupName: conv.contact?.fullName || 'Nhóm',
          });
        }
      }
    }
  }

  if (targetGroupThreadIds.length === 0) {
    throw new Error('Không tìm thấy nhóm Zalo nào được cấu hình hoặc có sẵn để tạo báo cáo.');
  }

  // 2. Fetch messages for each group in the time range
  const groupDigests: GroupDigestItem[] = [];

  for (const threadId of targetGroupThreadIds) {
    const configData = groupConfigsMap.get(threadId);

    // Find conversation
    const conversation = await prisma.conversation.findFirst({
      where: { orgId, externalThreadId: threadId },
      include: { contact: { select: { fullName: true } } },
    });

    const groupName =
      configData?.groupName ||
      conversation?.contact?.fullName ||
      `Nhóm ${threadId}`;

    if (!conversation) {
      groupDigests.push({
        groupThreadId: threadId,
        groupName,
        messageCount: 0,
        filteredCount: 0,
        summary: 'Chưa có dữ liệu hội thoại trong hệ thống.',
      });
      continue;
    }

    const rawMessages = await prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        sentAt: {
          gte: periodFrom,
          lte: periodTo,
        },
        isDeleted: false,
      },
      orderBy: { sentAt: 'asc' },
    });

    const cleanedMessages = filterAndFormatMessages(rawMessages);

    // Empty Activity Guard
    if (cleanedMessages.length === 0) {
      groupDigests.push({
        groupThreadId: threadId,
        groupName,
        messageCount: rawMessages.length,
        filteredCount: 0,
        summary: 'Không có tin nhắn / hoạt động mới trong khoảng thời gian này.',
      });
      continue;
    }

    // Tier 1 Summarization
    const groupSummary = await summarizeGroupMessages(
      groupName,
      cleanedMessages,
      configData?.customPrompt,
      configData?.focusKeywords,
    );

    groupDigests.push({
      groupThreadId: threadId,
      groupName,
      messageCount: rawMessages.length,
      filteredCount: cleanedMessages.length,
      summary: groupSummary,
    });
  }

  // 3. Tier 2 Executive Synthesis
  const summaryContent = await synthesizeExecutiveReport(
    groupDigests,
    reportType,
    periodFrom,
    periodTo,
  );

  const reportTitle =
    title ||
    `Báo Cáo Điều Hành ${reportType === 'daily' ? 'Ngày' : reportType === 'weekly' ? 'Tuần' : 'Tức Thì'} (${periodTo.toLocaleDateString('vi-VN')})`;

  // 4. Save to database
  const createdReport = await prisma.generatedReport.create({
    data: {
      orgId,
      createdById: userId || null,
      title: reportTitle,
      reportType,
      periodFrom,
      periodTo,
      groupThreadIds: targetGroupThreadIds,
      summaryContent,
      structuredData: {
        totalGroups: targetGroupThreadIds.length,
        activeGroups: groupDigests.filter((g) => g.filteredCount > 0).length,
        groupDigests: JSON.parse(JSON.stringify(groupDigests)),
      },
      sentZalo: false,
      sentEmail: false,
      metadata: {
        generatedAt: new Date().toISOString(),
      },
    },
  });

  logger.info(`[summarizer-service] Report created successfully with id ${createdReport.id}`);

  return {
    report: createdReport,
    groupDigests,
  };
}
