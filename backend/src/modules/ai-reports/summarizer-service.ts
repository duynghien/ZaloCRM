/**
 * summarizer-service.ts — Core AI engine implementing Hierarchical Map-Reduce
 * with message chunking, empty activity guard, multimodal OCR integration, and executive 5-part synthesis.
 */
import type { Prisma } from '@prisma/client';
import { config } from '../../config/index.js';
import { decodeReportTargets, type ReportTarget } from './report-target-service.js';
import { ReportControlError, isReportControlError, runReportExecutionGuard, type ReportJobBudget } from './report-job-budget.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { generateContent } from './ai-client.js';
import { filterAndFormatMessages, formatTranscriptForPrompt, type CleanedMessage } from './noise-filter.js';
import { extractImagePartsFromMessages } from './attachment-image-loader.js';
import { parseActionItemsFromMarkdown, type ReportActionItem } from './report-action-item-parser.js';
import type { ContentPart, FallbackTelemetry } from './providers/ai-provider-interface.js';

export interface GenerateReportParams {
  orgId: string;
  userId?: string;
  reportType?: 'daily' | 'weekly' | 'on_demand';
  periodFrom: Date;
  periodTo: Date;
  targets: ReportTarget[];
  title?: string;
  budget: ReportJobBudget;
  executionGuard: () => Promise<void>;
  signal?: AbortSignal;
}

export interface GroupDigestItem extends ReportTarget {
  groupThreadId: string;
  groupName: string;
  messageCount: number;
  filteredCount: number;
  summary: string;
}

const CHUNK_SIZE = 150;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[m] || m));
}

/**
 * Summarize a chunk of messages for a single group (Tier 1 Map phase)
 */
async function summarizeGroupMessages(
  groupName: string,
  messages: CleanedMessage[],
  customPrompt: string | null | undefined,
  focusKeywords: string[] | undefined,
  imageParts: ContentPart[],
  budget: ReportJobBudget,
  executionGuard: () => Promise<void>,
  orgId?: string,
  signal?: AbortSignal,
  onFallback?: (telemetry: FallbackTelemetry) => void,
): Promise<string> {
  await runReportExecutionGuard(executionGuard);
  if (messages.length === 0 && imageParts.length === 0) {
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

    const promptText = `Bạn là trợ lý AI chuyên nghiệp phân tích dữ liệu nhóm làm việc Zalo.
Hãy đọc nội dung trao đổi sau đây của nhóm "${groupName}" và trích xuất tóm tắt ngắn gọn, mạch lạc:

NỘI DUNG TRAO ĐỔI:
${transcript}
${keywordsHint}${customHint}

YÊU CẦU:
1. Nêu rõ các công việc đã giải quyết xong, ai phụ trách (nếu có).
2. Nêu các vấn đề phát sinh, sự cố, tồn đọng chưa xong.
3. Trích xuất các số liệu cụ thể (doanh số, tiến độ, số lượng, thời hạn, báo cáo đính kèm).
4. Các kế hoạch hoặc đầu việc tiếp theo.
5. Viết bằng tiếng Việt súc tích, gạch đầu dòng rõ ràng.
6. ĐỐI CHIẾU HÌNH ẢNH THỰC TẾ (nếu có ảnh đính kèm): Hãy quan sát kỹ từng hình ảnh được cung cấp và đối chiếu với nội dung nhân viên báo cáo (ví dụ: khay hoa quả có đủ các món và tươi ngon không; tình trạng máy móc, màn hình đo; cốc cà phê hủy; thành phẩm...). Nêu rõ những điểm KHỚP hoặc BẤT THƯỜNG phát hiện qua ảnh. NẾU PHÁT HIỆN SAI LỆCH HOẶC BẤT THƯỜNG: đánh cờ cảnh báo rõ ràng để quản lý rà soát.`;

    const prompt: string | ContentPart[] = imageParts.length > 0
      ? [{ text: promptText }, ...imageParts]
      : promptText;

    try {
      await runReportExecutionGuard(executionGuard);
      return await generateContent(prompt, {
        budget,
        executionGuard,
        orgId,
        taskType: 'executive_report',
        signal,
        onFallback,
        systemInstruction: 'Bạn là chuyên gia phân tích dữ liệu vận hành và điều hành doanh nghiệp.',
        temperature: 0.2,
      });
    } catch (err: any) {
      if (isReportControlError(err)) throw err;
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

  const chunkSummaries: string[] = [];
  for (const [idx, chunk] of chunks.entries()) {
    await runReportExecutionGuard(executionGuard);
    const transcript = formatTranscriptForPrompt(chunk);
    const photoVerificationHint = idx === 0 && imageParts.length > 0
      ? `\nĐỐI CHIẾU HÌNH ẢNH THỰC TẾ: Hãy quan sát kỹ các hình ảnh đính kèm và đối chiếu với nội dung nhân viên báo cáo (khay hoa quả, máy móc, sự cố, thành phẩm...). Nêu rõ các điểm khớp hoặc bất thường phát hiện qua ảnh.`
      : '';
    const promptText = `Tóm tắt nhanh các điểm chính trong phần ${idx + 1}/${chunks.length} của nhóm "${groupName}":\n${transcript}\n${customPrompt || ""}\n${focusKeywords?.join(", ") || ""}${photoVerificationHint}`;

    // Attach image parts to the first chunk
    const prompt: string | ContentPart[] = idx === 0 && imageParts.length > 0
      ? [{ text: promptText }, ...imageParts]
      : promptText;

    try {
      chunkSummaries.push(await generateContent(prompt, {
        budget,
        executionGuard,
        orgId,
        taskType: 'executive_report',
        signal,
        onFallback,
        temperature: 0.2,
      }));
    } catch (err: any) {
      if (isReportControlError(err)) throw err;
      chunkSummaries.push(`Phần ${idx + 1}: ${chunk.length} tin nhắn trao đổi.`);
    }
  }

  // Reduce chunk summaries
  const reducePrompt = `Dưới đây là các tóm tắt từng phần của nhóm "${groupName}":
${chunkSummaries.join('\n\n')}

Hãy tổng hợp lại thành một bản tóm tắt nhất quán, loại bỏ thông tin trùng lặp, nêu bật công việc hoàn thành, sự cố và số liệu chính.
ĐẶC BIỆT: Nếu trong các phần có mục ĐỐI CHIẾU HÌNH ẢNH THỰC TẾ hoặc phát hiện sai lệch/bất thường từ hình ảnh minh chứng, BẮT BUỘC phải giữ lại đầy đủ mục này trong bản tổng hợp.`;

  try {
    return await generateContent(reducePrompt, {
      budget,
      executionGuard,
      orgId,
      taskType: 'executive_report',
      signal,
      onFallback,
      temperature: 0.2,
    });
  } catch (err: any) {
    if (isReportControlError(err)) throw err;
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
  budget: ReportJobBudget,
  executionGuard: () => Promise<void>,
  orgId?: string,
  signal?: AbortSignal,
  onFallback?: (telemetry: FallbackTelemetry) => void,
): Promise<string> {
  await runReportExecutionGuard(executionGuard);
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
BẮT BUỘC TRÌNH BÀY DƯỚI DẠNG BẢNG MARKDOWN CHUẨN theo mẫu:
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
| 1 | [Nội dung việc cụ thể, rõ ràng] | [Tên người/ca/bộ phận phụ trách] | [Thời hạn hoàn thành] | [🔴 Cao / 🟡 Trung bình / 🟢 Thấp] |

QUY TẮC ĐỐI CHIẾU HÌNH ẢNH THỰC TẾ:
Nếu trong mục "ĐỐI CHIẾU HÌNH ẢNH THỰC TẾ" của bất kỳ nhóm nào có ghi nhận sai lệch hoặc bất thường giữa hình ảnh và lời khai của nhân viên: BẮT BUỘC phải tạo 1 Action Item ưu tiên Cao (🔴 Cao) tại Mục 5 của báo cáo điều hành để Trưởng ca/Quản lý vận hành kiểm tra và xử lý.

---
*(Trạng thái nhóm không có hoạt động mới: ${inactiveGroups.map((g) => g.groupName).join(', ') || 'Không có'})*
`;

  try {
    await runReportExecutionGuard(executionGuard);
    return await generateContent(prompt, {
      budget,
      executionGuard,
      orgId,
      taskType: 'executive_report',
      signal,
      onFallback,
      systemInstruction: 'Bạn là chuyên gia quản trị và điều hành doanh nghiệp, viết báo cáo sắc sảo, trung thực, chính xác.',
      temperature: 0.2,
      maxOutputTokens: 8192,
    });
  } catch (err: any) {
    if (isReportControlError(err)) throw err;
    logger.error('[summarizer-service] Tier 2 synthesis failed:', err?.message || err);
    return `# Báo Cáo Tổng Hợp (${fromStr} - ${toStr})\n\n${digestContext}`;
  }
}

/**
 * Main entry point to run full AI digest pipeline
 */
export async function generateDigestReport(params: GenerateReportParams) {
  const { orgId, userId, reportType = 'on_demand', periodFrom, periodTo, title, budget, executionGuard, signal } = params;
  const targets = decodeReportTargets(params.targets);
  await runReportExecutionGuard(executionGuard);

  const fallbackState: { telemetry: FallbackTelemetry | null } = { telemetry: null };
  const onFallback = (telemetry: FallbackTelemetry) => {
    fallbackState.telemetry = telemetry;
  };

  // Materialize all exact sources before spending tokens; cap+1 detects overflow without truncation.
  const materialized = [];
  let messageCount = 0;
  for (const target of targets) {
    await runReportExecutionGuard(executionGuard);
    const scope = { id: target.conversationId, orgId, zaloAccountId: target.zaloAccountId, externalThreadId: target.groupThreadId, threadType: 'group', zaloAccount: { orgId } };
    const conversation = await prisma.conversation.findFirst({ where: scope, include: { contact: { select: { fullName: true } } } });
    if (!conversation) throw new ReportControlError('Report source changed');
    const configData = await prisma.groupReportConfig.findFirst({ where: { orgId, zaloAccountId: target.zaloAccountId, groupThreadId: target.groupThreadId, targetResolutionStatus: 'resolved' } });
    const rawMessages = await prisma.message.findMany({
      where: { conversationId: target.conversationId, conversation: scope, sentAt: { gte: periodFrom, lte: periodTo }, isDeleted: false },
      orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
      take: config.aiReportMaxMessages - messageCount + 1,
    });
    messageCount += rawMessages.length;
    if (messageCount > config.aiReportMaxMessages) throw new ReportControlError('Report exceeds the configured message budget');
    materialized.push({ target, configData, rawMessages, groupName: configData?.groupName || conversation.contact?.fullName || `Nhóm ${target.groupThreadId}` });
  }

  const groupDigests: GroupDigestItem[] = [];
  for (const { target, configData, rawMessages, groupName } of materialized) {
    await runReportExecutionGuard(executionGuard);
    const cleaned = filterAndFormatMessages(rawMessages);
    const imageParts = await extractImagePartsFromMessages(rawMessages, 15, { orgId, executionGuard, signal });

    const summary = await summarizeGroupMessages(
      groupName,
      cleaned,
      configData?.customPrompt,
      Array.isArray(configData?.focusKeywords) ? configData.focusKeywords as string[] : undefined,
      imageParts,
      budget,
      executionGuard,
      orgId,
      signal,
      onFallback,
    );
    groupDigests.push({ ...target, groupName, messageCount: rawMessages.length, filteredCount: cleaned.length, summary });
  }

  let summaryContent = await synthesizeExecutiveReport(
    groupDigests,
    reportType,
    periodFrom,
    periodTo,
    budget,
    executionGuard,
    orgId,
    signal,
    onFallback,
  );
  await runReportExecutionGuard(executionGuard);

  // If a fallback model was used, append a sanitized footnote to the master report
  const telemetry = fallbackState.telemetry;
  if (telemetry?.isFallback) {
    const safeModelName = escapeHtml(telemetry.actualModel || 'dự phòng');
    summaryContent += `\n\n---\n*Ghi chú: Báo cáo được tổng hợp bởi model dự phòng ${safeModelName} do sự cố tạm thời từ nhà cung cấp chính.*`;
  }

  const actionItems = parseActionItemsFromMarkdown(
    summaryContent,
    groupDigests[0]?.groupName,
    groupDigests[0]?.groupThreadId,
  );

  const reportData: Prisma.GeneratedReportUncheckedCreateInput = {
    orgId, createdById: userId || null,
    title: title || `Báo Cáo Điều Hành ${reportType === 'daily' ? 'Ngày' : reportType === 'weekly' ? 'Tuần' : 'Tức Thì'} (${periodTo.toLocaleDateString('vi-VN')})`,
    reportType, periodFrom, periodTo, summaryContent,
    groupThreadIds: targets.map(target => target.groupThreadId),
    sourceTargets: targets.map(target => ({ ...target })), targetSchemaVersion: 2, targetResolutionStatus: 'verified',
    structuredData: {
      totalGroups: targets.length,
      activeGroups: groupDigests.filter(g => g.filteredCount > 0).length,
      groupDigests: groupDigests.map(g => ({ ...g })),
      actionItems: actionItems as unknown as Prisma.InputJsonValue,
    } as Prisma.InputJsonObject,
    sentZalo: false, sentEmail: false,
    metadata: {
      generatedAt: new Date().toISOString(),
      isFallback: Boolean(telemetry?.isFallback),
      primaryModel: telemetry?.primaryModel,
      actualModel: telemetry?.actualModel,
      fallbackReason: telemetry?.errorReason,
    },
  };
  return { reportData, groupDigests };
}
