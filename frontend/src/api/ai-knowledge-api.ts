/**
 * ai-knowledge-api.ts — API client for AI Knowledge Rules and Admin Feedback Distillation.
 */
import { api } from './index';

export type KnowledgeScope = 'org' | 'branch' | 'group';
export type KnowledgeCategory = 'personnel' | 'sop' | 'terminology' | 'correction' | 'general';

export interface AiKnowledgeRule {
  id: string;
  orgId: string;
  scope: KnowledgeScope;
  branchTag: string | null;
  groupThreadId: string | null;
  category: KnowledgeCategory;
  title: string;
  content: string;
  isActive: boolean;
  version: number;
  sourceFeedbackId: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  groupName?: string | null;
}

export interface CreateKnowledgeRuleInput {
  scope: KnowledgeScope;
  branchTag?: string;
  groupThreadId?: string;
  category: KnowledgeCategory;
  title: string;
  content: string;
  isActive?: boolean;
}

export interface UpdateKnowledgeRuleInput {
  scope?: KnowledgeScope;
  branchTag?: string | null;
  groupThreadId?: string | null;
  category?: KnowledgeCategory;
  title?: string;
  content?: string;
  isActive?: boolean;
}

export interface ListKnowledgeRulesFilter {
  scope?: KnowledgeScope;
  branchTag?: string;
  groupThreadId?: string;
  category?: KnowledgeCategory;
  isActive?: boolean;
  search?: string;
}

export interface AiReportFeedbackItem {
  id: string;
  orgId: string;
  reportId: string;
  userId: string;
  user?: {
    id: string;
    fullName: string;
    email: string;
  };
  section: string;
  originalContent: string | null;
  comment: string;
  targetScope: KnowledgeScope;
  branchTag: string | null;
  groupThreadId: string | null;
  status: 'pending' | 'distilled' | 'rejected';
  distilledRuleId: string | null;
  distilledRule?: AiKnowledgeRule | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubmitReportFeedbackInput {
  section?: string;
  originalContent?: string;
  comment: string;
  targetScope?: KnowledgeScope;
  branchTag?: string;
  groupThreadId?: string;
}

export interface SubmitReportFeedbackResponse {
  feedback: AiReportFeedbackItem;
  distilledRule: AiKnowledgeRule | null;
}

export const aiKnowledgeApi = {
  // Knowledge Rules CRUD
  async getKnowledgeRules(filter?: ListKnowledgeRulesFilter): Promise<{ rules: AiKnowledgeRule[] }> {
    const res = await api.get('/ai-reports/knowledge-rules', { params: filter });
    return res.data;
  },

  async createKnowledgeRule(input: CreateKnowledgeRuleInput): Promise<{ rule: AiKnowledgeRule }> {
    const res = await api.post('/ai-reports/knowledge-rules', input);
    return res.data;
  },

  async updateKnowledgeRule(id: string, input: UpdateKnowledgeRuleInput): Promise<{ rule: AiKnowledgeRule }> {
    const res = await api.put(`/ai-reports/knowledge-rules/${id}`, input);
    return res.data;
  },

  async deleteKnowledgeRule(id: string): Promise<{ success: boolean }> {
    const res = await api.delete(`/ai-reports/knowledge-rules/${id}`);
    return res.data;
  },

  async toggleKnowledgeRule(id: string): Promise<{ success: boolean; rule: AiKnowledgeRule }> {
    const res = await api.patch(`/ai-reports/knowledge-rules/${id}/toggle`);
    return res.data;
  },

  async getAvailableBranches(): Promise<{ branches: string[] }> {
    const res = await api.get('/ai-reports/knowledge-branches');
    return res.data;
  },

  // Feedback & Distillation
  async submitReportFeedback(
    reportId: string,
    input: SubmitReportFeedbackInput,
  ): Promise<SubmitReportFeedbackResponse> {
    const res = await api.post(`/ai-reports/reports/${reportId}/feedback`, input);
    return res.data;
  },

  async getReportFeedbacks(reportId: string): Promise<{ feedbacks: AiReportFeedbackItem[] }> {
    const res = await api.get(`/ai-reports/reports/${reportId}/feedbacks`);
    return res.data;
  },

  async getAllFeedbacks(limit = 50, offset = 0): Promise<{ feedbacks: AiReportFeedbackItem[] }> {
    const res = await api.get('/ai-reports/feedbacks', { params: { limit, offset } });
    return res.data;
  },
};
