import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  submitReportFeedback,
  distillRuleFromFeedback,
  getReportFeedbacks,
  listAllFeedbacks,
  recoverPendingAiFeedbacks,
  FeedbackValidationError,
} from '../src/modules/ai-reports/knowledge/ai-feedback-distillation-service.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import * as aiClient from '../src/modules/ai-reports/ai-client.js';

vi.mock('../src/shared/database/prisma-client.js', () => {
  const mockTx = {
    aiKnowledgeRule: {
      create: vi.fn().mockResolvedValue({ id: 'rule-mock-123' }),
    },
    aiReportFeedback: {
      update: vi.fn().mockResolvedValue({}),
    },
  };

  return {
    prisma: {
      generatedReport: {
        findFirst: vi.fn(),
      },
      aiReportFeedback: {
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
        findMany: vi.fn(),
      },
      aiKnowledgeRule: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb(mockTx)),
    },
  };
});

vi.mock('../src/modules/ai-reports/ai-client.js', () => ({
  generateContent: vi.fn(),
}));

describe('ai-feedback-distillation-service', () => {
  const orgId = 'org-tenant-1';
  const otherOrgId = 'org-tenant-2';
  const userId = 'user-admin-1';
  const reportId = 'report-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('distillRuleFromFeedback', () => {
    it('distills a clean JSON rule from AI output successfully', async () => {
      const aiResponse = JSON.stringify({
        title: 'Quy trình kiểm kê dầu ăn',
        ruleContent: 'Dầu ăn chiên chỉ sử dụng tối đa 2 ngày hoặc 50 lượt chiên',
        category: 'sop',
        scope: 'branch',
      });
      vi.mocked(aiClient.generateContent).mockResolvedValueOnce(aiResponse);

      const result = await distillRuleFromFeedback({
        orgId,
        userId,
        sectionKey: 'blockers',
        originalSnippet: 'Dầu ăn để qua 3 ngày',
        feedbackComment: 'Sai rồi, quy định là dầu ăn chỉ dùng 2 ngày',
        targetScope: 'branch',
      });

      expect(result).toEqual({
        title: 'Quy trình kiểm kê dầu ăn',
        ruleContent: 'Dầu ăn chiên chỉ sử dụng tối đa 2 ngày hoặc 50 lượt chiên',
        category: 'sop',
        scope: 'branch',
      });
    });

    it('handles markdown json code block fences correctly', async () => {
      const aiResponse = '```json\n{"title": "Bếp trưởng", "ruleContent": "Tuấn là Bếp trưởng", "category": "personnel", "scope": "group"}\n```';
      vi.mocked(aiClient.generateContent).mockResolvedValueOnce(aiResponse);

      const result = await distillRuleFromFeedback({
        orgId,
        userId,
        sectionKey: 'highlights',
        originalSnippet: 'Tuấn là phụ bếp',
        feedbackComment: 'Tuấn là bếp trưởng',
        targetScope: 'group',
      });

      expect(result.title).toBe('Bếp trưởng');
      expect(result.ruleContent).toBe('Tuấn là Bếp trưởng');
      expect(result.category).toBe('personnel');
    });

    it('fallback gracefully when AI call throws network/timeout/429 error without throwing 500', async () => {
      vi.mocked(aiClient.generateContent).mockRejectedValueOnce(new Error('Rate limit 429'));

      const result = await distillRuleFromFeedback({
        orgId,
        userId,
        sectionKey: 'highlights',
        originalSnippet: 'Báo cáo sai số lượng',
        feedbackComment: 'Doanh thu ca sáng phải là 12 triệu',
        targetScope: 'group',
      });

      expect(result).toEqual({
        title: 'Doanh thu ca sáng phải là 12 triệu',
        ruleContent: 'Doanh thu ca sáng phải là 12 triệu',
        category: 'correction',
        scope: 'group',
      });
    });

    it('fallback gracefully when AI returns malformed JSON without throwing', async () => {
      vi.mocked(aiClient.generateContent).mockResolvedValueOnce('This is plain text not JSON');

      const result = await distillRuleFromFeedback({
        orgId,
        userId,
        sectionKey: 'actions',
        originalSnippet: 'Snippet',
        feedbackComment: 'Đính chính quy trình ca tối',
        targetScope: 'org',
      });

      expect(result).toEqual({
        title: 'Đính chính quy trình ca tối',
        ruleContent: 'Đính chính quy trình ca tối',
        category: 'correction',
        scope: 'org',
      });
    });
  });

  describe('submitReportFeedback', () => {
    it('creates pending feedback first, distills rule, and atomically activates rule with isActive: true', async () => {
      const mockReport = {
        id: reportId,
        groupThreadIds: ['group-thread-abc'],
      };
      vi.mocked(prisma.generatedReport.findFirst).mockResolvedValueOnce(mockReport as any);

      const mockFeedback = {
        id: 'feedback-1',
        orgId,
        reportId,
        userId,
        sectionKey: 'metrics',
        originalSnippet: 'Doanh thu 10tr',
        feedbackComment: 'Doanh thu thực tế là 15tr',
        targetScope: 'group',
        branchTag: null,
        groupThreadId: 'group-thread-abc',
        status: 'pending',
      };
      vi.mocked(prisma.aiReportFeedback.create).mockResolvedValueOnce(mockFeedback as any);

      const mockDistilledRule = {
        id: 'rule-distilled-1',
        orgId,
        scope: 'group',
        groupThreadId: 'group-thread-abc',
        category: 'correction',
        title: 'Doanh thu thực tế là 15tr',
        ruleContent: 'Doanh thu thực tế là 15tr',
        isActive: true,
        sourceReportId: reportId,
      };

      // Mock transaction execution
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        return cb({
          aiKnowledgeRule: {
            create: vi.fn().mockResolvedValueOnce(mockDistilledRule),
          },
          aiReportFeedback: {
            update: vi.fn().mockResolvedValueOnce({
              ...mockFeedback,
              distilledRuleId: mockDistilledRule.id,
              status: 'distilled',
            }),
          },
        });
      });

      vi.mocked(aiClient.generateContent).mockRejectedValueOnce(new Error('Use fallback'));

      const result = await submitReportFeedback(orgId, userId, reportId, {
        sectionKey: 'metrics',
        originalSnippet: 'Doanh thu 10tr',
        feedbackComment: 'Doanh thu thực tế là 15tr',
        targetScope: 'group',
      });

      expect(prisma.aiReportFeedback.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orgId,
          reportId,
          status: 'pending',
          feedbackComment: 'Doanh thu thực tế là 15tr',
        }),
      });

      expect(result.feedback.status).toBe('distilled');
      expect(result.feedback.distilledRuleId).toBe(mockDistilledRule.id);
      expect(result.distilledRule.isActive).toBe(true);
    });

    it('rejects empty feedbackComment with validation error', async () => {
      await expect(
        submitReportFeedback(orgId, userId, reportId, {
          feedbackComment: '   ',
        }),
      ).rejects.toThrow('Ý kiến phản hồi / đính chính không được để trống');
    });

    it('accepts comment alias (frontend format) and returns normalized feedback and rule', async () => {
      const mockReport = {
        id: reportId,
        groupThreadIds: ['group-thread-abc'],
      };
      vi.mocked(prisma.generatedReport.findFirst).mockResolvedValueOnce(mockReport as any);

      const mockFeedback = {
        id: 'feedback-2',
        orgId,
        reportId,
        userId,
        sectionKey: 'general',
        originalSnippet: 'Trích dẫn lỗi',
        feedbackComment: 'Đính chính thực tế',
        targetScope: 'group',
        branchTag: null,
        groupThreadId: 'group-thread-abc',
        status: 'pending',
      };
      vi.mocked(prisma.aiReportFeedback.create).mockResolvedValueOnce(mockFeedback as any);

      const mockDistilledRule = {
        id: 'rule-distilled-2',
        orgId,
        scope: 'group',
        groupThreadId: 'group-thread-abc',
        category: 'correction',
        title: 'Đính chính thực tế',
        ruleContent: 'Đính chính thực tế',
        isActive: true,
        sourceReportId: reportId,
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        return cb({
          aiKnowledgeRule: {
            create: vi.fn().mockResolvedValueOnce(mockDistilledRule),
          },
          aiReportFeedback: {
            update: vi.fn().mockResolvedValueOnce({
              ...mockFeedback,
              distilledRuleId: mockDistilledRule.id,
              status: 'distilled',
            }),
          },
        });
      });

      vi.mocked(aiClient.generateContent).mockRejectedValueOnce(new Error('Use fallback'));

      const result = await submitReportFeedback(orgId, userId, reportId, {
        section: 'general',
        originalContent: 'Trích dẫn lỗi',
        comment: 'Đính chính thực tế',
        targetScope: 'group',
      });

      expect(prisma.aiReportFeedback.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orgId,
          reportId,
          status: 'pending',
          sectionKey: 'general',
          originalSnippet: 'Trích dẫn lỗi',
          feedbackComment: 'Đính chính thực tế',
        }),
      });

      expect(result.feedback.comment).toBe('Đính chính thực tế');
      expect(result.feedback.feedbackComment).toBe('Đính chính thực tế');
      expect(result.feedback.section).toBe('general');
      expect(result.feedback.originalContent).toBe('Trích dẫn lỗi');
      expect(result.distilledRule.content).toBe('Đính chính thực tế');
      expect(result.distilledRule.ruleContent).toBe('Đính chính thực tế');
    });

    it('rejects when both feedbackComment and comment are empty or missing', async () => {
      await expect(
        submitReportFeedback(orgId, userId, reportId, {
          comment: '   ',
        }),
      ).rejects.toThrow('Ý kiến phản hồi / đính chính không được để trống');

      await expect(
        submitReportFeedback(orgId, userId, reportId, {} as any),
      ).rejects.toThrow('Ý kiến phản hồi / đính chính không được để trống');
    });

    it('rejects non-existent report or cross-tenant report with 404', async () => {
      vi.mocked(prisma.generatedReport.findFirst).mockResolvedValueOnce(null);

      await expect(
        submitReportFeedback(otherOrgId, userId, reportId, {
          feedbackComment: 'Phản hồi',
        }),
      ).rejects.toMatchObject({
        statusCode: 404,
        message: 'Không tìm thấy báo cáo',
      });
    });
  });

  describe('getReportFeedbacks and listAllFeedbacks', () => {
    it('queries feedbacks for a specific report scoped to orgId', async () => {
      const mockList = [{ id: 'fb-1', reportId, orgId }];
      vi.mocked(prisma.aiReportFeedback.findMany).mockResolvedValueOnce(mockList as any);

      const result = await getReportFeedbacks(orgId, reportId);

      expect(prisma.aiReportFeedback.findMany).toHaveBeenCalledWith({
        where: { orgId, reportId },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(mockList);
    });

    it('queries all feedbacks across org with pagination', async () => {
      const mockList = [{ id: 'fb-1', orgId }];
      vi.mocked(prisma.aiReportFeedback.findMany).mockResolvedValueOnce(mockList as any);

      const result = await listAllFeedbacks(orgId, { limit: 20, offset: 10 });

      expect(prisma.aiReportFeedback.findMany).toHaveBeenCalledWith({
        where: { orgId },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 10,
      });
      expect(result).toEqual(mockList);
    });
  });

  describe('recoverPendingAiFeedbacks', () => {
    it('recovers pending feedbacks older than threshold', async () => {
      const stalePending = [
        {
          id: 'fb-stale-1',
          orgId,
          userId,
          reportId,
          feedbackComment: 'Doanh thu là 20tr',
          targetScope: 'branch',
          branchTag: 'Chi nhánh 1',
          groupThreadId: null,
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      ];

      vi.mocked(prisma.aiReportFeedback.findMany).mockResolvedValueOnce(stalePending as any);

      const recovered = await recoverPendingAiFeedbacks(5 * 60 * 1000);

      expect(recovered).toBe(1);
      expect(prisma.aiReportFeedback.findMany).toHaveBeenCalledWith({
        where: {
          status: 'pending',
          createdAt: { lt: expect.any(Date) },
        },
        take: 50,
      });
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });
});
