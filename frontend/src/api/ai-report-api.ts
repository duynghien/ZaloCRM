/**
 * ai-report-api.ts — API client for AI Digest & Multi-Channel Reporting endpoints.
 */
import { api } from './index';

export interface GroupItem {
  threadId: string;
  conversationId: string;
  groupName: string;
  avatarUrl: string | null;
  zaloAccount: { id: string; displayName: string | null; zaloUid: string | null } | null;
  lastMessageAt: string | null;
  unreadCount: number;
  isConfigured: boolean;
  isEnabled: boolean;
  customPrompt: string;
  focusKeywords: string[];
}

export interface GroupConfig {
  id?: string;
  groupThreadId: string;
  groupName?: string | null;
  zaloAccountId: string | null;
  targetResolutionStatus?: string;
  isEnabled: boolean;
  customPrompt?: string | null;
  focusKeywords: string[];
  updatedAt?: string;
}

export interface GeneratedReportItem {
  id: string;
  orgId: string;
  createdById: string | null;
  createdBy?: { id: string; fullName: string; email: string };
  title: string;
  reportType: 'daily' | 'weekly' | 'on_demand' | 'audit_rule';
  periodFrom: string;
  periodTo: string;
  groupThreadIds: string[];
  targetSchemaVersion: number;
  targetResolutionStatus: 'legacy_unverified' | 'verified';
  sourceTargets: Array<{ zaloAccountId: string; groupThreadId: string; conversationId: string }> | null;
  summaryContent: string;
  structuredData: any;
  sentZalo: boolean;
  sentEmail: boolean;
  metadata?: {
    generatedAt?: string;
    isFallback?: boolean;
    primaryModel?: string;
    actualModel?: string;
    fallbackReason?: string;
    [key: string]: any;
  };
  createdAt: string;
}

export interface AiProviderDetail {
  type: 'gemini' | 'openai' | 'deepseek' | 'custom';
  model: string;
  apiKey?: string;
  apiKeySet?: boolean;
  baseUrl?: string;
  supportsVision?: boolean;
}

export interface AiProviderSettings {
  isSystemDefault?: boolean;
  primaryProvider: 'gemini' | 'deepseek' | 'openai' | 'custom';
  providers: Record<string, AiProviderDetail>;
  fallbackEnabled: boolean;
  fallbackChain: string[];
  allowSystemFallback: boolean;
}

export interface TestAiResult {
  success: boolean;
  latencyMs: number;
  message: string;
  modelName: string;
}

export interface AutomationSettings {
  senderAccountId?: string;
  dailyEnabled: boolean;
  weeklyEnabled: boolean;
  sendZalo: boolean;
  zaloDestinationType: 'self' | 'cloud' | 'uid';
  zaloTargetUid?: string;
  sendEmail: boolean;
  emailRecipients: string[];
}

export interface SmtpSettings {
  host: string;
  port: number;
  secure?: boolean;
  user: string;
  pass?: string;
  passSet?: boolean;
  from?: string;
}

export interface GenerateReportPayload {
  from_date: string;
  to_date: string;
  group_targets: Array<{ zalo_account_id: string; group_thread_id: string }>;
  title?: string;
  report_type?: 'daily' | 'weekly' | 'on_demand';
  zalo_account_id?: string;
  send_zalo?: boolean;
  send_email?: boolean;
  zalo_destination_type?: 'self' | 'cloud' | 'uid';
  zalo_target_uid?: string;
  email_recipients?: string[];
}

export interface ResendReportPayload {
  zalo_account_id?: string;
  send_zalo?: boolean;
  send_email?: boolean;
  zalo_destination_type?: 'self' | 'cloud' | 'uid';
  zalo_target_uid?: string;
  email_recipients?: string[];
}

export interface AiReportJob {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  resultReportId: string | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
  cancellationRequestedAt: string | null;
}

export interface AiAuditRule {
  id: string;
  name: string;
  isEnabled: boolean;
  zaloAccountId: string;
  groupThreadId: string;
  groupName?: string;
  runTime: string;
  daysOfWeek: number[];
  scanWindowType: 'since_start_of_day' | 'last_n_hours';
  scanWindowHours?: number;
  personnelType: 'explicit_list' | 'all_group_members';
  personnelList?: string[];
  templateType: 'schedule_submission' | 'work_progress' | 'image_verification' | 'custom';
  customPrompt?: string;
  destinationType: 'group' | 'self' | 'cloud' | 'uid' | 'email';
  targetGroupId?: string;
  targetGroupName?: string;
  targetUid?: string;
  emailRecipients?: string[];
  sendOperationalReminder: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string | null;
  lastRunStatus?: 'success' | 'failed' | 'dispatch_failed' | null;
  lastRunReportId?: string | null;
  lastError?: string | null;
}

export type AuditRuleInput = Omit<
  AiAuditRule,
  'id' | 'createdAt' | 'updatedAt' | 'lastRunAt' | 'lastRunStatus' | 'lastRunReportId' | 'lastError'
>;

export interface RunAuditRuleNowResult {
  success: boolean;
  reportId?: string;
  supervisoryReportMarkdown: string;
  operationalReminderMessage?: string;
  lastRunStatus: 'success' | 'failed' | 'dispatch_failed';
  error?: string;
}

export const aiReportApi = {
  async getSenderAccounts(): Promise<Array<{ id: string; displayName: string | null; zaloUid: string | null; status: string }>> {
    const res = await api.get('/zalo-accounts');
    return res.data;
  },

  // Groups & Configs
  async getGroups(): Promise<{ groups: GroupItem[] }> {
    const res = await api.get('/ai-reports/groups');
    return res.data;
  },

  async getConfigs(): Promise<{ configs: GroupConfig[] }> {
    const res = await api.get('/ai-reports/configs');
    return res.data;
  },

  async updateConfig(
    groupThreadId: string,
    data: {
      zalo_account_id: string;
      group_name?: string;
      is_enabled?: boolean;
      custom_prompt?: string;
      focus_keywords?: string[];
    },
  ): Promise<{ success: boolean; config: GroupConfig }> {
    const res = await api.put(`/ai-reports/configs/${encodeURIComponent(groupThreadId)}`, data);
    return res.data;
  },

  // Report Generation & Archive
  async generateReport(payload: GenerateReportPayload, idempotencyKey: string): Promise<{ jobId: string; status: AiReportJob['status']; replay: boolean }> {
    const res = await api.post('/ai-reports/generate', payload, { headers: { 'Idempotency-Key': idempotencyKey } });
    return res.data;
  },

  async getJob(id: string): Promise<{ job: AiReportJob }> {
    const res = await api.get(`/ai-reports/jobs/${id}`);
    return res.data;
  },

  async cancelJob(id: string): Promise<{ success: boolean }> {
    const res = await api.post(`/ai-reports/jobs/${id}/cancel`);
    return res.data;
  },

  async getReports(params?: {
    page?: number;
    limit?: number;
    report_type?: string;
  }): Promise<{
    reports: GeneratedReportItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const res = await api.get('/ai-reports', { params });
    return res.data;
  },

  async getReport(id: string): Promise<{ report: GeneratedReportItem }> {
    const res = await api.get(`/ai-reports/${id}`);
    return res.data;
  },

  async resendReport(
    id: string,
    payload: ResendReportPayload,
    idempotencyKey: string,
  ): Promise<{ success: boolean; resendId: string; replay?: boolean;
    zalo?: { success: boolean; partsSent: number; totalParts: number; deliveryUncertain: boolean; error?: string } | null;
    email?: { success: boolean; error?: string } | null }> {
    const res = await api.post(`/ai-reports/${id}/resend`, payload, { headers: { 'Idempotency-Key': idempotencyKey } });
    return res.data;
  },

  // Settings
  async getSettings(): Promise<{
    automation: AutomationSettings;
    smtp: SmtpSettings | null;
    aiProviders?: AiProviderSettings;
  }> {
    const res = await api.get('/ai-reports/settings');
    return res.data;
  },

  async updateSettings(payload: {
    automation?: Partial<AutomationSettings>;
    smtp?: Partial<SmtpSettings>;
    aiProviders?: Partial<AiProviderSettings>;
  }): Promise<{ success: boolean }> {
    const res = await api.put('/ai-reports/settings', payload);
    return res.data;
  },

  async testAiConnection(config: Partial<AiProviderDetail>): Promise<TestAiResult> {
    const res = await api.post('/ai-reports/settings/test-ai', config, { timeout: 65000 });
    return res.data;
  },

  async fetchProviderModels(payload: {
    type: 'gemini' | 'openai' | 'deepseek' | 'custom';
    apiKey?: string;
    baseUrl?: string;
  }): Promise<{ models: string[] }> {
    const res = await api.post('/ai-reports/settings/models', payload, { timeout: 20000 });
    return res.data;
  },

  // Audit Rules
  async getAuditRules(): Promise<{ rules: AiAuditRule[] }> {
    const res = await api.get('/ai-reports/rules');
    return res.data;
  },

  async createAuditRule(payload: AuditRuleInput): Promise<{ rule: AiAuditRule }> {
    const res = await api.post('/ai-reports/rules', payload);
    return res.data;
  },

  async updateAuditRule(id: string, payload: Partial<AuditRuleInput>): Promise<{ rule: AiAuditRule }> {
    const res = await api.put(`/ai-reports/rules/${id}`, payload);
    return res.data;
  },

  async deleteAuditRule(id: string): Promise<{ success: boolean }> {
    const res = await api.delete(`/ai-reports/rules/${id}`);
    return res.data;
  },

  async runAuditRuleNow(id: string): Promise<RunAuditRuleNowResult> {
    const res = await api.post(`/ai-reports/rules/${id}/run-now`);
    return res.data;
  },
};
