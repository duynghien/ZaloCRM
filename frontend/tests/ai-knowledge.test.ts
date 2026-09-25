import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aiKnowledgeApi } from '@/api/ai-knowledge-api';
import { api } from '@/api/index';

vi.mock('@/api/index', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('aiKnowledgeApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getKnowledgeRules passes filter parameters to GET /ai-reports/knowledge-rules', async () => {
    const mockRules = [{ id: 'rule-1', title: 'Rule 1', scope: 'org', category: 'general', isActive: true }];
    vi.mocked(api.get).mockResolvedValueOnce({ data: { rules: mockRules } });

    const filter = { scope: 'org' as const, category: 'general' as const, isActive: true };
    const result = await aiKnowledgeApi.getKnowledgeRules(filter);

    expect(api.get).toHaveBeenCalledWith('/ai-reports/knowledge-rules', { params: filter });
    expect(result.rules).toEqual(mockRules);
  });

  it('createKnowledgeRule calls POST /ai-reports/knowledge-rules', async () => {
    const newRule = { scope: 'branch' as const, branchTag: 'CN1', category: 'sop' as const, title: 'Test SOP', content: 'Content' };
    const savedRule = { id: 'rule-2', ...newRule, isActive: true, version: 1 };
    vi.mocked(api.post).mockResolvedValueOnce({ data: { rule: savedRule } });

    const result = await aiKnowledgeApi.createKnowledgeRule(newRule);

    expect(api.post).toHaveBeenCalledWith('/ai-reports/knowledge-rules', newRule);
    expect(result.rule.id).toBe('rule-2');
  });

  it('updateKnowledgeRule calls PUT /ai-reports/knowledge-rules/:id', async () => {
    const updateInput = { title: 'Updated Title' };
    const updatedRule = { id: 'rule-1', title: 'Updated Title' };
    vi.mocked(api.put).mockResolvedValueOnce({ data: { rule: updatedRule } });

    const result = await aiKnowledgeApi.updateKnowledgeRule('rule-1', updateInput);

    expect(api.put).toHaveBeenCalledWith('/ai-reports/knowledge-rules/rule-1', updateInput);
    expect(result.rule.title).toBe('Updated Title');
  });

  it('toggleKnowledgeRule calls PATCH /ai-reports/knowledge-rules/:id/toggle', async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({ data: { success: true, rule: { id: 'rule-1', isActive: false } } });

    const result = await aiKnowledgeApi.toggleKnowledgeRule('rule-1');

    expect(api.patch).toHaveBeenCalledWith('/ai-reports/knowledge-rules/rule-1/toggle');
    expect(result.success).toBe(true);
    expect(result.rule.isActive).toBe(false);
  });

  it('deleteKnowledgeRule calls DELETE /ai-reports/knowledge-rules/:id', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({ data: { success: true } });

    const result = await aiKnowledgeApi.deleteKnowledgeRule('rule-1');

    expect(api.delete).toHaveBeenCalledWith('/ai-reports/knowledge-rules/rule-1');
    expect(result.success).toBe(true);
  });

  it('getAvailableBranches calls GET /ai-reports/knowledge-branches', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { branches: ['CN1', 'CN2'] } });

    const result = await aiKnowledgeApi.getAvailableBranches();

    expect(api.get).toHaveBeenCalledWith('/ai-reports/knowledge-branches');
    expect(result.branches).toEqual(['CN1', 'CN2']);
  });

  it('submitReportFeedback calls POST /ai-reports/reports/:reportId/feedback', async () => {
    const feedbackPayload = { comment: 'Tuấn Anh là Bếp trưởng', targetScope: 'group' as const, groupThreadId: 'thread-1' };
    const mockResponse = {
      feedback: { id: 'fb-1', reportId: 'rep-1', status: 'distilled', ...feedbackPayload },
      distilledRule: { id: 'rule-new', title: 'Vai trò Tuấn Anh', content: 'Tuấn Anh là Bếp trưởng', isActive: true },
    };
    vi.mocked(api.post).mockResolvedValueOnce({ data: mockResponse });

    const result = await aiKnowledgeApi.submitReportFeedback('rep-1', feedbackPayload);

    expect(api.post).toHaveBeenCalledWith('/ai-reports/reports/rep-1/feedback', feedbackPayload);
    expect(result.distilledRule?.title).toBe('Vai trò Tuấn Anh');
    expect(result.feedback.status).toBe('distilled');
  });

  it('submitReportFeedback works with both comment and feedbackComment', async () => {
    const feedbackPayload = {
      section: 'general',
      sectionKey: 'general',
      comment: 'Báo cáo cốc tồn',
      feedbackComment: 'Báo cáo cốc tồn',
      originalContent: 'Đoạn trích',
      originalSnippet: 'Đoạn trích',
      targetScope: 'group' as const,
      groupThreadId: 'thread-1',
    };
    const mockResponse = {
      feedback: { id: 'fb-2', reportId: 'rep-2', status: 'distilled', ...feedbackPayload },
      distilledRule: { id: 'rule-2', title: 'Quy tắc cốc', content: 'Báo cáo cốc tồn', ruleContent: 'Báo cáo cốc tồn', isActive: true },
    };
    vi.mocked(api.post).mockResolvedValueOnce({ data: mockResponse });

    const result = await aiKnowledgeApi.submitReportFeedback('rep-2', feedbackPayload);

    expect(api.post).toHaveBeenCalledWith('/ai-reports/reports/rep-2/feedback', feedbackPayload);
    expect(result.distilledRule?.ruleContent).toBe('Báo cáo cốc tồn');
  });

  it('getReportFeedbacks calls GET /ai-reports/reports/:reportId/feedbacks', async () => {
    const mockFeedbacks = [{ id: 'fb-1', reportId: 'rep-1', comment: 'test' }];
    vi.mocked(api.get).mockResolvedValueOnce({ data: { feedbacks: mockFeedbacks } });

    const result = await aiKnowledgeApi.getReportFeedbacks('rep-1');

    expect(api.get).toHaveBeenCalledWith('/ai-reports/reports/rep-1/feedbacks');
    expect(result.feedbacks).toEqual(mockFeedbacks);
  });
});
