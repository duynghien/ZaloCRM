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
  zaloAccountId?: string | null;
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
  reportType: 'daily' | 'weekly' | 'on_demand';
  periodFrom: string;
  periodTo: string;
  groupThreadIds: string[];
  summaryContent: string;
  structuredData: any;
  sentZalo: boolean;
  sentEmail: boolean;
  metadata: any;
  createdAt: string;
}

export interface AutomationSettings {
  dailyEnabled: boolean;
  dailyCronTime?: string;
  weeklyEnabled: boolean;
  weeklyCronTime?: string;
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
  group_thread_ids?: string[];
  title?: string;
  report_type?: 'daily' | 'weekly' | 'on_demand';
  send_zalo?: boolean;
  send_email?: boolean;
  zalo_destination_type?: 'self' | 'cloud' | 'uid';
  zalo_target_uid?: string;
  email_recipients?: string[];
}

export interface ResendReportPayload {
  send_zalo?: boolean;
  send_email?: boolean;
  zalo_destination_type?: 'self' | 'cloud' | 'uid';
  zalo_target_uid?: string;
  email_recipients?: string[];
}

export const aiReportApi = {
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
      group_name?: string;
      is_enabled?: boolean;
      custom_prompt?: string;
      focus_keywords?: string[];
    },
  ): Promise<{ success: boolean; config: GroupConfig }> {
    const res = await api.put(`/ai-reports/configs/${groupThreadId}`, data);
    return res.data;
  },

  // Report Generation & Archive
  async generateReport(payload: GenerateReportPayload): Promise<{
    success: boolean;
    report: GeneratedReportItem;
    groupDigests?: any[];
    dispatchStatus?: any;
  }> {
    const res = await api.post('/ai-reports/generate', payload);
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
  ): Promise<{ success: boolean; zalo?: any; email?: any }> {
    const res = await api.post(`/ai-reports/${id}/resend`, payload);
    return res.data;
  },

  // Settings
  async getSettings(): Promise<{
    automation: AutomationSettings;
    smtp: SmtpSettings | null;
  }> {
    const res = await api.get('/ai-reports/settings');
    return res.data;
  },

  async updateSettings(payload: {
    automation?: Partial<AutomationSettings>;
    smtp?: Partial<SmtpSettings>;
  }): Promise<{ success: boolean }> {
    const res = await api.put('/ai-reports/settings', payload);
    return res.data;
  },
};
