import { api } from './index.js';

export interface BudgetStatus {
  status: 'ok' | 'warning' | 'exceeded';
  currentCostVnd: number;
  monthlyBudgetVnd: number;
  usagePercentage: number;
}

export interface AiKpiData {
  totalCostVnd: number;
  totalCostUsd: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  requestCount: number;
  budgetStatus: BudgetStatus;
}

export interface DailyTimelineItem {
  date: string;
  costVnd: number;
  costUsd: number;
  totalTokens: number;
  requestCount: number;
}

export interface TaskTypeBreakdown {
  taskType: string;
  costVnd: number;
  costUsd: number;
  totalTokens: number;
  requestCount: number;
  percentage: number;
}

export interface ModelBreakdown {
  model: string;
  provider: string;
  costVnd: number;
  costUsd: number;
  totalTokens: number;
  requestCount: number;
  percentage: number;
}

export interface DailyAiUsageRecord {
  id: string;
  date: string;
  taskType: string;
  provider: string;
  model: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  costUsd: number;
  costVnd: number;
}

export interface AiUsageReportResponse {
  from: string;
  to: string;
  summary: {
    totalCostVnd: number;
    totalCostUsd: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    requestCount: number;
  };
  dailyTimeline: DailyTimelineItem[];
  byTaskType: TaskTypeBreakdown[];
  byModel: ModelBreakdown[];
  tableData: DailyAiUsageRecord[];
}

export async function getAiKpi(params?: { from?: string; to?: string }): Promise<AiKpiData> {
  const res = await api.get<AiKpiData>('/dashboard/ai-kpi', { params });
  return res.data;
}

export async function getAiUsageReport(params?: { from?: string; to?: string }): Promise<AiUsageReportResponse> {
  const res = await api.get<AiUsageReportResponse>('/reports/ai-usage', { params });
  return res.data;
}

export function getAiUsageExportUrl(params?: { from?: string; to?: string }): string {
  const query = new URLSearchParams();
  query.set('type', 'ai-usage');
  if (params?.from) query.set('from', params.from);
  if (params?.to) query.set('to', params.to);
  return `/api/v1/reports/export?${query.toString()}`;
}
