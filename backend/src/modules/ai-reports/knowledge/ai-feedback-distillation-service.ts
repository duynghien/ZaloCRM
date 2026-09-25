import { prisma } from '../../../shared/database/prisma-client.js';
import { generateContent } from '../ai-client.js';
import { logger } from '../../../shared/utils/logger.js';
import {
  type KnowledgeScope,
  type KnowledgeCategory,
  VALID_SCOPES,
  VALID_CATEGORIES,
  formatRuleResponse,
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
  section?: string;
  originalSnippet?: string;
  originalContent?: string;
  feedbackComment?: string;
  comment?: string;
  targetScope?: KnowledgeScope;
  branchTag?: string | null;
  groupThreadId?: string | null;
}

export function formatFeedbackResponse(feedback: any) {
  if (!feedback) return feedback;
  const dRule = feedback.distilledRule ? formatRuleResponse(feedback.distilledRule) : undefined;
  const res: any = { ...feedback };
  if (feedback.feedbackComment !== undefined || feedback.comment !== undefined) {
    const val = feedback.feedbackComment ?? feedback.comment ?? '';
    res.comment = val;
    res.feedbackComment = val;
  }
  if (feedback.originalSnippet !== undefined || feedback.originalContent !== undefined) {
    const val = feedback.originalSnippet ?? feedback.originalContent ?? '';
    res.originalContent = val;
    res.originalSnippet = val;
  }
  if (feedback.sectionKey !== undefined || feedback.section !== undefined) {
    const val = feedback.sectionKey ?? feedback.section ?? 'general';
    res.section = val;
    res.sectionKey = val;
  }
  if (dRule !== undefined) {
    res.distilledRule = dRule;
  }
  return res;
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

export function createFallbackRule(feedbackComment: string, targetScope: KnowledgeScope): DistilledRuleData {
  const fallbackTitle = feedbackComment.trim().slice(0, 80) || 'Đính chính vận hành báo cáo';
  return {
    title: fallbackTitle,
    ruleContent: feedbackComment.trim(),
    category: 'correction',
    scope: targetScope,
  };
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
  const fallbackRule = createFallbackRule(feedbackComment, targetScope);

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
      : fallbackRule.title;

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
  const rawComment = input.feedbackComment ?? input.comment ?? '';
  const comment = rawComment.trim();
  if (!comment) {
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

  const sectionKey = (input.sectionKey ?? input.section ?? 'general').trim() || 'general';
  const originalSnippet = (input.originalSnippet ?? input.originalContent ?? '').trim();

  // 1. Save feedback record immediately with status 'pending' to prevent data loss
  const feedback = await prisma.aiReportFeedback.create({
    data: {
      orgId,
      reportId,
      userId,
      sectionKey,
      originalSnippet,
      feedbackComment: comment,
      targetScope,
      branchTag: targetScope === 'branch' ? input.branchTag?.trim() || null : null,
      groupThreadId: effectiveGroupThreadId,
      status: 'pending',
    },
  });

  // 2. Distill rule synchronously with fallback to prevent orphan pending records
  let createdRule: any;
  try {
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

    createdRule = await prisma.$transaction(async (tx) => {
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
  } catch {
    // If AI distillation or transaction failed, apply deterministic fallback rule
    const fbRule = createFallbackRule(feedback.feedbackComment, targetScope);

    createdRule = await prisma.$transaction(async (tx) => {
      const rule = await tx.aiKnowledgeRule.create({
        data: {
          orgId,
          createdById: userId,
          scope: fbRule.scope,
          branchTag: fbRule.scope === 'branch' ? feedback.branchTag : null,
          groupThreadId: fbRule.scope === 'group' ? feedback.groupThreadId : null,
          category: fbRule.category,
          title: fbRule.title,
          ruleContent: fbRule.ruleContent,
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
    }).catch(async (txErr) => {
      await prisma.aiReportFeedback.update({
        where: { id: feedback.id },
        data: { status: 'failed' },
      }).catch(() => {});
      throw txErr;
    });
  }

  const normalizedRule = formatRuleResponse(createdRule);
  const normalizedFeedback = formatFeedbackResponse({
    ...feedback,
    distilledRuleId: createdRule.id,
    status: 'distilled',
    distilledRule: normalizedRule,
  });

  return {
    feedback: normalizedFeedback,
    distilledRule: normalizedRule,
  };
}

/**
 * Recovers orphaned feedbacks in 'pending' status older than threshold.
 */
export async function recoverPendingAiFeedbacks(olderThanMs = 5 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const orphans = await prisma.aiReportFeedback.findMany({
    where: { status: 'pending', createdAt: { lt: cutoff } },
    take: 50,
  });

  let recovered = 0;
  for (const item of orphans) {
    try {
      const fb = createFallbackRule(item.feedbackComment, item.targetScope as KnowledgeScope);

      await prisma.$transaction(async (tx) => {
        const rule = await tx.aiKnowledgeRule.create({
          data: {
            orgId: item.orgId,
            createdById: item.userId,
            scope: fb.scope,
            branchTag: fb.scope === 'branch' ? item.branchTag : null,
            groupThreadId: fb.scope === 'group' ? item.groupThreadId : null,
            category: fb.category,
            title: fb.title,
            ruleContent: fb.ruleContent,
            isActive: true,
            sourceReportId: item.reportId,
          },
        });

        await tx.aiReportFeedback.update({
          where: { id: item.id },
          data: { distilledRuleId: rule.id, status: 'distilled' },
        });
      });
      recovered++;
    } catch {
      try {
        await prisma.aiReportFeedback.update({
          where: { id: item.id },
          data: { status: 'failed' },
        });
      } catch {}
    }
  }
  return recovered;
}

export async function getReportFeedbacks(orgId: string, reportId: string) {
  const feedbacks = await prisma.aiReportFeedback.findMany({
    where: { orgId, reportId },
    include: {
      distilledRule: true,
      user: { select: { id: true, fullName: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return feedbacks.map(formatFeedbackResponse);
}

export async function listAllFeedbacks(orgId: string, options?: { limit?: number; offset?: number }) {
  const take = Math.min(options?.limit ?? 50, 100);
  const skip = options?.offset ?? 0;

  const feedbacks = await prisma.aiReportFeedback.findMany({
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
  return feedbacks.map(formatFeedbackResponse);
}
