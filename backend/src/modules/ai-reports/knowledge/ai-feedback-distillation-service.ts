import { prisma } from '../../../shared/database/prisma-client.js';
import { generateContent } from '../ai-client.js';
import { logger } from '../../../shared/utils/logger.js';
import {
  type KnowledgeScope,
  type KnowledgeCategory,
  VALID_SCOPES,
  VALID_CATEGORIES,
} from './ai-knowledge-service.js';

export class FeedbackValidationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'FeedbackValidationError';
    this.statusCode = statusCode;
  }
}

export interface SubmitReportFeedbackInput {
  sectionKey?: string;
  originalSnippet?: string;
  feedbackComment: string;
  targetScope?: KnowledgeScope;
  branchTag?: string | null;
  groupThreadId?: string | null;
}

export interface DistilledRuleData {
  title: string;
  ruleContent: string;
  category: KnowledgeCategory;
  scope: KnowledgeScope;
}

export function parseJsonSafely(rawText: string): any {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  return JSON.parse(cleaned);
}

export async function distillRuleFromFeedback(params: {
  orgId: string;
  userId: string;
  sectionKey: string;
  originalSnippet: string;
  feedbackComment: string;
  targetScope: KnowledgeScope;
  branchTag?: string | null;
  groupThreadId?: string | null;
}): Promise<DistilledRuleData> {
  const { orgId, sectionKey, originalSnippet, feedbackComment, targetScope } = params;

  const fallbackTitle = feedbackComment.trim().slice(0, 80) || 'Đính chính vận hành báo cáo';
  const fallbackRule: DistilledRuleData = {
    title: fallbackTitle,
    ruleContent: feedbackComment.trim(),
    category: 'correction',
    scope: targetScope,
  };

  const prompt = `Bạn là Trợ lý Tinh chế Tri thức Vận hành F&B cho ZaloCRM.
Nhiệm vụ của bạn là đọc đoạn báo cáo gốc và ý kiến phản hồi/đính chính của quản lý, từ đó chắt lọc ra ĐÚNG 01 QUY TẮC TRI THỨC VẬN HÀNH DUY NHẤT.

Yêu cầu bắt buộc:
1. Quy tắc phải ngắn gọn (< 40 từ), dứt khoát, mang tính chỉ dẫn vận hành cho AI khi lập báo cáo sau này.
2. Nêu rõ nhân sự/vai trò, quy trình, thuật ngữ hoặc số liệu điều chỉnh cụ thể.
3. Trả về định dạng JSON thuần túy (không kèm text ngoài JSON):
{
  "title": "Tiêu đề ngắn gọn dưới 80 ký tự",
  "ruleContent": "Nội dung quy tắc chỉ dẫn vận hành ngắn gọn dưới 40 từ",
  "category": "personnel" | "sop" | "terminology" | "correction" | "general",
  "scope": "${targetScope}"
}

Dữ liệu đầu vào:
- Mục báo cáo: ${sectionKey}
- Đoạn trích báo cáo gốc: "${originalSnippet || '(Không có đoạn trích)'}"
- Đính chính thực tế của quản lý: "${feedbackComment}"
- Phạm vi áp dụng: ${targetScope}`;

  try {
    const rawOutput = await generateContent(prompt, {
      orgId,
      taskType: 'knowledge_distillation',
      temperature: 0.1,
      responseMimeType: 'application/json',
      maxOutputTokens: 512,
    });

    const parsed = parseJsonSafely(rawOutput);
    if (!parsed || typeof parsed !== 'object') {
      return fallbackRule;
    }

    const title = typeof parsed.title === 'string' && parsed.title.trim()
      ? parsed.title.trim().slice(0, 150)
      : fallbackTitle;

    const ruleContent = typeof parsed.ruleContent === 'string' && parsed.ruleContent.trim()
      ? parsed.ruleContent.trim().slice(0, 2000)
      : feedbackComment.trim();

    const category: KnowledgeCategory = VALID_CATEGORIES.includes(parsed.category)
      ? parsed.category
      : 'correction';

    const scope: KnowledgeScope = VALID_SCOPES.includes(parsed.scope)
      ? parsed.scope
      : targetScope;

    return { title, ruleContent, category, scope };
  } catch (err: any) {
    logger.warn({ err: err?.message || err, orgId }, '[ai-feedback-distillation] AI call failed, using fallback rule');
    return fallbackRule;
  }
}

export async function submitReportFeedback(
  orgId: string,
  userId: string,
  reportId: string,
  input: SubmitReportFeedbackInput,
) {
  if (!input.feedbackComment?.trim()) {
    throw new FeedbackValidationError('Ý kiến phản hồi / đính chính không được để trống');
  }

  const report = await prisma.generatedReport.findFirst({
    where: { id: reportId, orgId },
    select: { id: true, groupThreadIds: true },
  });
  if (!report) {
    throw new FeedbackValidationError('Không tìm thấy báo cáo', 404);
  }

  const targetScope: KnowledgeScope = input.targetScope && VALID_SCOPES.includes(input.targetScope)
    ? input.targetScope
    : 'group';

  let effectiveGroupThreadId: string | null = null;
  if (targetScope === 'group') {
    if (input.groupThreadId?.trim()) {
      effectiveGroupThreadId = input.groupThreadId.trim();
    } else {
      const threadIds = Array.isArray(report.groupThreadIds) ? (report.groupThreadIds as string[]) : [];
      if (threadIds.length > 0) {
        effectiveGroupThreadId = threadIds[0];
      }
    }
  }

  // 1. Save feedback record immediately with status 'pending' to prevent data loss
  const feedback = await prisma.aiReportFeedback.create({
    data: {
      orgId,
      reportId,
      userId,
      sectionKey: input.sectionKey?.trim() || 'general',
      originalSnippet: (input.originalSnippet || '').trim(),
      feedbackComment: input.feedbackComment.trim(),
      targetScope,
      branchTag: targetScope === 'branch' ? input.branchTag?.trim() || null : null,
      groupThreadId: effectiveGroupThreadId,
      status: 'pending',
    },
  });

  // 2. Distill rule synchronously (< 2s)
  const distilled = await distillRuleFromFeedback({
    orgId,
    userId,
    sectionKey: feedback.sectionKey,
    originalSnippet: feedback.originalSnippet,
    feedbackComment: feedback.feedbackComment,
    targetScope,
    branchTag: feedback.branchTag,
    groupThreadId: feedback.groupThreadId,
  });

  // 3. Atomically create rule with isActive = true and link to feedback
  const createdRule = await prisma.$transaction(async (tx) => {
    const rule = await tx.aiKnowledgeRule.create({
      data: {
        orgId,
        createdById: userId,
        scope: distilled.scope,
        branchTag: distilled.scope === 'branch' ? feedback.branchTag : null,
        groupThreadId: distilled.scope === 'group' ? feedback.groupThreadId : null,
        category: distilled.category,
        title: distilled.title,
        ruleContent: distilled.ruleContent,
        isActive: true,
        sourceReportId: reportId,
      },
    });

    await tx.aiReportFeedback.update({
      where: { id: feedback.id },
      data: {
        distilledRuleId: rule.id,
        status: 'distilled',
      },
    });

    return rule;
  });

  return {
    feedback: {
      ...feedback,
      distilledRuleId: createdRule.id,
      status: 'distilled',
    },
    distilledRule: createdRule,
  };
}

export async function getReportFeedbacks(orgId: string, reportId: string) {
  return prisma.aiReportFeedback.findMany({
    where: { orgId, reportId },
    include: {
      distilledRule: true,
      user: { select: { id: true, fullName: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listAllFeedbacks(orgId: string, options?: { limit?: number; offset?: number }) {
  const take = Math.min(options?.limit ?? 50, 100);
  const skip = options?.offset ?? 0;

  return prisma.aiReportFeedback.findMany({
    where: { orgId },
    include: {
      distilledRule: true,
      report: { select: { id: true, title: true, createdAt: true } },
      user: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take,
    skip,
  });
}
