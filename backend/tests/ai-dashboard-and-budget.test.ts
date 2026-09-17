import { describe, expect, it, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import {
  getAiBudgetStatus,
  getVnMonthStartDate,
} from '../src/modules/ai-reports/ai-budget-alert-service.js';
import {
  sanitizeExcelCell,
  formatTaskTypeLabel,
  buildAiUsageSheet,
} from '../src/modules/dashboard/ai-report-sheet-builder.js';
import * as settingsService from '../src/modules/ai-reports/ai-provider-settings-service.js';

describe('ai-dashboard-and-budget', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAiBudgetStatus', () => {
    it('returns status ok and 0% when budget is 0 or not configured (no division by zero / Infinity)', async () => {
      vi.spyOn(settingsService, 'getOrgAiProviderCredentials').mockResolvedValue({
        primaryProvider: 'gemini',
        providers: {},
        fallbackEnabled: false,
        fallbackChain: [],
        allowSystemFallback: true,
        monthlyBudgetVnd: 0,
      });

      const mockPrisma = {
        dailyAiUsageStat: {
          aggregate: vi.fn().mockResolvedValue({ _sum: { costVnd: BigInt(500000) } }),
        },
      } as any;

      const result = await getAiBudgetStatus('org-1', mockPrisma);
      expect(result.status).toBe('ok');
      expect(result.usagePercentage).toBe(0);
      expect(result.monthlyBudgetVnd).toBe(0);
      expect(result.currentCostVnd).toBe(500000);
      expect(Number.isFinite(result.usagePercentage)).toBe(true);
    });

    it('returns warning when spending reaches 80% of budget', async () => {
      vi.spyOn(settingsService, 'getOrgAiProviderCredentials').mockResolvedValue({
        primaryProvider: 'gemini',
        providers: {},
        fallbackEnabled: false,
        fallbackChain: [],
        allowSystemFallback: true,
        monthlyBudgetVnd: 1000000,
      });

      const mockPrisma = {
        dailyAiUsageStat: {
          aggregate: vi.fn().mockResolvedValue({ _sum: { costVnd: BigInt(850000) } }),
        },
      } as any;

      const result = await getAiBudgetStatus('org-1', mockPrisma);
      expect(result.status).toBe('warning');
      expect(result.usagePercentage).toBe(85);
      expect(result.currentCostVnd).toBe(850000);
      expect(result.monthlyBudgetVnd).toBe(1000000);
    });

    it('returns exceeded when spending reaches 100% or more', async () => {
      vi.spyOn(settingsService, 'getOrgAiProviderCredentials').mockResolvedValue({
        primaryProvider: 'gemini',
        providers: {},
        fallbackEnabled: false,
        fallbackChain: [],
        allowSystemFallback: true,
        monthlyBudgetVnd: 1000000,
      });

      const mockPrisma = {
        dailyAiUsageStat: {
          aggregate: vi.fn().mockResolvedValue({ _sum: { costVnd: BigInt(1200000) } }),
        },
      } as any;

      const result = await getAiBudgetStatus('org-1', mockPrisma);
      expect(result.status).toBe('exceeded');
      expect(result.usagePercentage).toBe(120);
      expect(result.currentCostVnd).toBe(1200000);
    });
  });

  describe('sanitizeExcelCell (CWE-1236 Formula Injection defense)', () => {
    it('escapes cells starting with formula trigger characters', () => {
      expect(sanitizeExcelCell('=cmd|/C calc')).toBe("'=cmd|/C calc");
      expect(sanitizeExcelCell('+12345')).toBe("'+12345");
      expect(sanitizeExcelCell('-100')).toBe("'-100");
      expect(sanitizeExcelCell('@SUM(A1:A10)')).toBe("'@SUM(A1:A10)");
    });

    it('leaves safe values untouched', () => {
      expect(sanitizeExcelCell('gemini-3.6-flash')).toBe('gemini-3.6-flash');
      expect(sanitizeExcelCell('Trợ lý Copilot')).toBe('Trợ lý Copilot');
      expect(sanitizeExcelCell(154200)).toBe(154200);
      expect(sanitizeExcelCell(null)).toBe(null);
    });
  });

  describe('buildAiUsageSheet', () => {
    it('creates Excel worksheet with sanitized data and formatted columns', async () => {
      const mockPrisma = {
        aiUsageLog: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'log-1',
              createdAt: new Date('2026-09-17T03:00:00Z'),
              taskType: 'copilot',
              provider: 'gemini',
              model: '=dangerous_formula_model',
              inputTokens: 500,
              outputTokens: 100,
              cachedTokens: 50,
              totalTokens: 600,
              costUsd: 0.0001,
              costVnd: BigInt(254),
              status: 'success',
            },
          ]),
        },
      } as any;

      const workbook = new ExcelJS.Workbook();
      await buildAiUsageSheet(workbook, 'org-1', '2026-09-01', '2026-09-17', mockPrisma);

      const sheet = workbook.getWorksheet('Chi phí AI');
      expect(sheet).toBeDefined();
      expect(sheet?.rowCount).toBe(2); // header + 1 data row

      const dataRow = sheet?.getRow(2);
      expect(dataRow?.getCell(2).value).toBe('Trợ lý Copilot');
      // Verify formula injection sanitization applied
      expect(dataRow?.getCell(4).value).toBe("'=dangerous_formula_model");
      expect(dataRow?.getCell(5).value).toBe(500);
      expect(dataRow?.getCell(10).value).toBe(254);
    });
  });
});
