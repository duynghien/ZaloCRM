import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getVietnamTimeComponents,
  checkAndExecuteDueRules,
  startAuditRuleCron,
  stopAuditRuleCron,
} from '../src/modules/ai-reports/audit-rule-cron-runner.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import * as ruleService from '../src/modules/ai-reports/ai-audit-rule-service.js';
import * as evaluator from '../src/modules/ai-reports/ai-audit-evaluator.js';
import type { AiAuditRule } from '../src/modules/ai-reports/ai-audit-rule-service.js';

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    organization: {
      findMany: vi.fn(),
    },
    aiReportJob: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (cb) => cb(prisma)),
    $executeRaw: vi.fn(),
  },
}));

vi.mock('../src/modules/ai-reports/ai-audit-rule-service.js', () => ({
  getAuditRules: vi.fn(),
}));

vi.mock('../src/modules/ai-reports/ai-audit-evaluator.js', () => ({
  evaluateAuditRule: vi.fn(),
}));

describe('audit-rule-cron-runner', () => {
  const orgId = 'org-cron-test';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getVietnamTimeComponents', () => {
    it('accurately parses time, date, and 1-7 day-of-week for Asia/Ho_Chi_Minh', () => {
      // 2026-09-14 03:00 UTC = 10:00 AM UTC+7 (Monday)
      const monday10am = new Date('2026-09-14T03:00:00.000Z');
      const comp = getVietnamTimeComponents(monday10am);

      expect(comp.timeStr).toBe('10:00');
      expect(comp.dateStr).toBe('2026-09-14');
      expect(comp.dayOfWeek).toBe(1); // Monday is 1
    });

    it('identifies Sunday as dayOfWeek = 7', () => {
      // 2026-09-13 11:30 UTC = 18:30 UTC+7 (Sunday)
      const sunday = new Date('2026-09-13T11:30:00.000Z');
      const comp = getVietnamTimeComponents(sunday);

      expect(comp.timeStr).toBe('18:30');
      expect(comp.dateStr).toBe('2026-09-13');
      expect(comp.dayOfWeek).toBe(7); // Sunday is 7
    });
  });

  describe('checkAndExecuteDueRules', () => {
    const fixedNow = new Date('2026-09-14T03:00:00.000Z'); // 10:00 AM, Monday (day 1)

    const matchingRule: AiAuditRule = {
      id: 'rule-matching',
      name: 'Quy tắc khớp giờ',
      isEnabled: true,
      zaloAccountId: 'acc-1',
      groupThreadId: 'group-1',
      runTime: '10:00',
      daysOfWeek: [1, 2, 3],
      scanWindowType: 'since_start_of_day',
      personnelType: 'all_group_members',
      templateType: 'schedule_submission',
      destinationType: 'group',
      sendOperationalReminder: true,
      createdAt: '2026-09-14T00:00:00Z',
      updatedAt: '2026-09-14T00:00:00Z',
    };

    const disabledRule: AiAuditRule = {
      ...matchingRule,
      id: 'rule-disabled',
      isEnabled: false,
    };

    const wrongTimeRule: AiAuditRule = {
      ...matchingRule,
      id: 'rule-wrong-time',
      runTime: '11:00',
    };

    const wrongDayRule: AiAuditRule = {
      ...matchingRule,
      id: 'rule-wrong-day',
      daysOfWeek: [6, 7], // Weekend only
    };

    it('triggers only enabled rules that match current HH:mm and dayOfWeek', async () => {
      vi.mocked(prisma.organization.findMany).mockResolvedValue([
        { id: orgId, name: 'Công Ty ABC' },
      ] as any);

      vi.mocked(ruleService.getAuditRules).mockResolvedValue([
        matchingRule,
        disabledRule,
        wrongTimeRule,
        wrongDayRule,
      ]);

      vi.mocked(prisma.aiReportJob.findUnique).mockResolvedValue(null);
      vi.mocked(evaluator.evaluateAuditRule).mockResolvedValue({
        lastRunStatus: 'success',
        supervisoryReportMarkdown: 'Report',
      });

      const count = await checkAndExecuteDueRules(fixedNow);
      expect(count).toBe(1);

      expect(evaluator.evaluateAuditRule).toHaveBeenCalledTimes(1);
      expect(evaluator.evaluateAuditRule).toHaveBeenCalledWith(
        orgId,
        matchingRule,
        null,
        expect.objectContaining({
          isScheduled: true,
          scheduleKey: `${orgId}:audit_rule:rule-matching:2026-09-14-10-00`,
        }),
      );
    });

    it('skips duplicate executions when scheduleKey has already been processed', async () => {
      vi.mocked(prisma.organization.findMany).mockResolvedValue([
        { id: orgId, name: 'Công Ty ABC' },
      ] as any);
      vi.mocked(ruleService.getAuditRules).mockResolvedValue([matchingRule]);

      // Job already exists for this minute's scheduleKey
      vi.mocked(prisma.aiReportJob.findUnique).mockResolvedValue({ id: 'job-existing' } as any);

      const count = await checkAndExecuteDueRules(fixedNow);
      expect(count).toBe(0);
      expect(evaluator.evaluateAuditRule).not.toHaveBeenCalled();
    });

    it('isolates errors so a failure in one rule does not interrupt other rules', async () => {
      const secondMatchingRule: AiAuditRule = {
        ...matchingRule,
        id: 'rule-matching-2',
        name: 'Quy tắc thứ 2',
      };

      vi.mocked(prisma.organization.findMany).mockResolvedValue([
        { id: orgId, name: 'Công Ty ABC' },
      ] as any);
      vi.mocked(ruleService.getAuditRules).mockResolvedValue([matchingRule, secondMatchingRule]);
      vi.mocked(prisma.aiReportJob.findUnique).mockResolvedValue(null);

      // First rule rejects, second succeeds
      vi.mocked(evaluator.evaluateAuditRule)
        .mockRejectedValueOnce(new Error('LLM Timeout'))
        .mockResolvedValueOnce({
          lastRunStatus: 'success',
          supervisoryReportMarkdown: 'Report 2',
        });

      const count = await checkAndExecuteDueRules(fixedNow);
      expect(count).toBe(1);
      expect(evaluator.evaluateAuditRule).toHaveBeenCalledTimes(2);
    });
  });

  describe('startAuditRuleCron & stopAuditRuleCron', () => {
    it('initializes and stops without throwing', () => {
      expect(() => startAuditRuleCron()).not.toThrow();
      expect(() => stopAuditRuleCron()).not.toThrow();
    });
  });
});
