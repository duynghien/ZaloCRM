import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAiKpi, getAiUsageReport, getAiUsageExportUrl, type AiKpiData } from '../src/api/ai-usage-api';
import { api } from '../src/api/index';

vi.mock('../src/api/index', () => ({
  api: {
    get: vi.fn(),
  },
}));

describe('AI Usage API & KPI Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls GET /dashboard/ai-kpi with given date filters', async () => {
    const mockKpi: AiKpiData = {
      totalCostVnd: 154200,
      totalCostUsd: 6.0,
      totalTokens: 1200000,
      promptTokens: 800000,
      completionTokens: 400000,
      requestCount: 84,
      budgetStatus: {
        status: 'warning',
        monthlyBudgetVnd: 180000,
        currentMonthSpendVnd: 154200,
        usagePercentage: 85,
      },
    };

    vi.mocked(api.get).mockResolvedValueOnce({ data: mockKpi });

    const result = await getAiKpi({ from: '2026-09-01', to: '2026-09-17' });
    expect(api.get).toHaveBeenCalledWith('/dashboard/ai-kpi', {
      params: { from: '2026-09-01', to: '2026-09-17' },
    });
    expect(result).toEqual(mockKpi);
  });

  it('calls GET /reports/ai-usage with date range filters', async () => {
    const mockReport = {
      summary: {
        totalCostVnd: 250000,
        totalCostUsd: 10,
        totalTokens: 2000000,
        promptTokens: 1500000,
        completionTokens: 500000,
        requestCount: 120,
      },
      dailyStats: [],
      byTaskType: [],
      byModel: [],
    };

    vi.mocked(api.get).mockResolvedValueOnce({ data: mockReport });

    const res = await getAiUsageReport({ from: '2026-09-10', to: '2026-09-17' });
    expect(api.get).toHaveBeenCalledWith('/reports/ai-usage', {
      params: { from: '2026-09-10', to: '2026-09-17' },
    });
    expect(res.summary.totalCostVnd).toBe(250000);
  });

  it('generates export URL correctly with params', () => {
    const url1 = getAiUsageExportUrl({});
    expect(url1).toBe('/api/v1/reports/export?type=ai-usage');

    const url2 = getAiUsageExportUrl({ from: '2026-09-01', to: '2026-09-17' });
    expect(url2).toBe('/api/v1/reports/export?type=ai-usage&from=2026-09-01&to=2026-09-17');
  });

  describe('Budget Badge Logic', () => {
    function computeBudgetBadge(status?: 'ok' | 'warning' | 'exceeded', usagePercentage = 0) {
      if (!status || status === 'ok') return null;
      if (status === 'exceeded') {
        return { type: 'badge-exceeded', text: `🚨 Vượt ngân sách (${usagePercentage}%)` };
      }
      if (status === 'warning') {
        return { type: 'badge-warning', text: `⚠️ Cảnh báo ngân sách (${usagePercentage}%)` };
      }
      return null;
    }

    it('returns null when status is ok or unconfigured', () => {
      expect(computeBudgetBadge('ok', 45)).toBeNull();
      expect(computeBudgetBadge(undefined)).toBeNull();
    });

    it('returns warning badge when status is warning', () => {
      const badge = computeBudgetBadge('warning', 85);
      expect(badge).toEqual({
        type: 'badge-warning',
        text: '⚠️ Cảnh báo ngân sách (85%)',
      });
    });

    it('returns exceeded badge when status is exceeded', () => {
      const badge = computeBudgetBadge('exceeded', 112);
      expect(badge).toEqual({
        type: 'badge-exceeded',
        text: '🚨 Vượt ngân sách (112%)',
      });
    });
  });

  describe('Token & VND Formatter Logic', () => {
    function formatTokens(count: number): string {
      if (!count || count <= 0) return '0 token';
      if (count >= 1_000_000) {
        return `${(count / 1_000_000).toFixed(1).replace(/\\.0$/, '')}M tokens`;
      }
      if (count >= 1_000) {
        return `${(count / 1_000).toFixed(1).replace(/\\.0$/, '')}K tokens`;
      }
      return `${count} tokens`;
    }

    it('formats tokens properly', () => {
      expect(formatTokens(0)).toBe('0 token');
      expect(formatTokens(500)).toBe('500 tokens');
      expect(formatTokens(4500)).toBe('4.5K tokens');
      expect(formatTokens(1200000)).toBe('1.2M tokens');
    });
  });
});
