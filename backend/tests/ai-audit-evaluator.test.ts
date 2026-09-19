import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeScanWindow,
  resolveAuditPersonnel,
  buildDeterministicReminderMessage,
  parseEvaluationOutput,
  isValidAuditJson,
  AuditEvaluationParseError,
} from '../src/modules/ai-reports/ai-audit-evaluator-helpers.js';
import { buildAuditPrompt } from '../src/modules/ai-reports/ai-audit-prompt-builder.js';
import { evaluateAuditRule } from '../src/modules/ai-reports/ai-audit-evaluator.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { zaloPool } from '../src/modules/zalo/zalo-pool.js';
import * as aiClient from '../src/modules/ai-reports/ai-client.js';
import * as zaloSender from '../src/modules/ai-reports/zalo-report-sender.js';
import type { AiAuditRule } from '../src/modules/ai-reports/ai-audit-rule-service.js';

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    conversation: {
      findFirst: vi.fn(),
    },
    message: {
      findMany: vi.fn(),
    },
    appSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    aiReportJob: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    aiReportBudgetReservation: {
      aggregate: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    generatedReport: {
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb) => cb(prisma)),
    $queryRaw: vi.fn(),
  },
}));

vi.mock('../src/modules/zalo/zalo-pool.js', () => ({
  zaloPool: {
    getApi: vi.fn(),
  },
}));

vi.mock('../src/modules/ai-reports/ai-client.js', () => ({
  generateContent: vi.fn(),
}));

vi.mock('../src/modules/ai-reports/zalo-report-sender.js', () => ({
  sendReportToZalo: vi.fn(),
}));

vi.mock('../src/modules/ai-reports/email-service.js', () => ({
  sendReportEmail: vi.fn(),
}));

describe('ai-audit-evaluator and helpers', () => {
  const orgId = 'org-audit-test';
  const mockRule: AiAuditRule = {
    id: 'rule-test-101',
    name: 'Kiểm tra báo cáo ca sáng',
    isEnabled: true,
    zaloAccountId: 'acc-1',
    groupThreadId: 'group-source-1',
    groupName: 'Nhóm Vận Hành',
    runTime: '10:00',
    daysOfWeek: [1, 2, 3, 4, 5],
    scanWindowType: 'since_start_of_day',
    personnelType: 'all_group_members',
    templateType: 'schedule_submission',
    destinationType: 'group',
    targetGroupId: 'group-dest-2',
    targetGroupName: 'Nhóm Quản Trị',
    sendOperationalReminder: true,
    createdAt: '2026-09-14T00:00:00Z',
    updatedAt: '2026-09-14T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('computeScanWindow', () => {
    it('calculates start of day accurately in Asia/Ho_Chi_Minh timezone', () => {
      const fixedNow = new Date('2026-09-14T03:00:00.000Z'); // 10:00 AM UTC+7
      const { periodFrom, periodTo } = computeScanWindow('since_start_of_day', 24, fixedNow);

      expect(periodTo.toISOString()).toBe(fixedNow.toISOString());
      // 00:00:00 UTC+7 on 2026-09-14 is 2026-09-13T17:00:00.000Z
      expect(periodFrom.toISOString()).toBe('2026-09-13T17:00:00.000Z');
    });

    it('calculates last_n_hours accurately', () => {
      const fixedNow = new Date('2026-09-14T10:00:00.000Z');
      const { periodFrom, periodTo } = computeScanWindow('last_n_hours', 5, fixedNow);

      expect(periodTo.getTime() - periodFrom.getTime()).toBe(5 * 3600 * 1000);
    });
  });

  describe('resolveAuditPersonnel', () => {
    it('returns explicit personnel list directly', async () => {
      const res = await resolveAuditPersonnel(orgId, {
        personnelType: 'explicit_list',
        personnelList: ['Nguyễn Văn A', 'Trần Thị B'],
        zaloAccountId: 'acc-1',
        groupThreadId: 'group-1',
      });
      expect(res.personnel).toEqual(['Nguyễn Văn A', 'Trần Thị B']);
      expect(res.source).toBe('explicit');
    });

    it('resolves personnel from live getGroupInfo API', async () => {
      const mockGetGroupInfo = vi.fn().mockResolvedValue({
        currentMems: [
          { dName: 'Nguyễn Văn A 🚀 [Sales]' },
          { displayName: 'Trần Thị B' },
          { zName: 'Lê Văn C' },
        ],
      });
      vi.mocked(zaloPool.getApi).mockReturnValue({ getGroupInfo: mockGetGroupInfo } as any);

      const res = await resolveAuditPersonnel(orgId, {
        personnelType: 'all_group_members',
        zaloAccountId: 'acc-1',
        groupThreadId: 'group-1',
      });

      expect(res.personnel).toEqual(['Nguyễn Văn A 🚀 [Sales]', 'Trần Thị B', 'Lê Văn C']);
      expect(res.source).toBe('api');
    });

    it('falls back to cached members when getGroupInfo fails without querying message senders', async () => {
      vi.mocked(zaloPool.getApi).mockReturnValue({
        getGroupInfo: vi.fn().mockRejectedValue(new Error('Network error')),
      } as any);

      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({ id: 'conv-1' } as any);
      vi.mocked(prisma.appSetting.findUnique).mockResolvedValue({
        id: 's-1',
        orgId,
        settingKey: 'cached_group_members:group-1',
        valuePlain: JSON.stringify(['Nhân Viên 1', 'Nhân Viên 2']),
        valueEncrypted: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await resolveAuditPersonnel(orgId, {
        personnelType: 'all_group_members',
        zaloAccountId: 'acc-1',
        groupThreadId: 'group-1',
      });

      expect(res.personnel).toEqual(['Nhân Viên 1', 'Nhân Viên 2']);
      expect(res.source).toBe('cache');
      // Anti-survivorship bias check: prisma.message should never be called for personnel resolution
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });
  });

  describe('buildDeterministicReminderMessage', () => {
    it('creates polite reminder when there are missing members', () => {
      const msg = buildDeterministicReminderMessage(
        {
          totalExpected: 3,
          completedCount: 1,
          missingCount: 2,
          missingNames: ['Nguyễn Văn A', 'Trần Thị B'],
        },
        'Nhóm Kinh Doanh',
        '10:00',
      );

      expect(msg).toContain('🔔 [NHẮC NHỞ TUÂN THỦ BÁO CÁO - Nhóm Kinh Doanh]');
      expect(msg).toContain('- Nguyễn Văn A');
      expect(msg).toContain('- Trần Thị B');
      expect(msg).toContain('10:30');
      expect(msg).toContain('Nếu bạn đã gửi mà hệ thống đọc sót');
    });

    it('creates celebratory message when 100% compliant', () => {
      const msg = buildDeterministicReminderMessage(
        {
          totalExpected: 5,
          completedCount: 5,
          missingCount: 0,
          missingNames: [],
        },
        'Nhóm Kinh Doanh',
        '10:00',
      );

      expect(msg).toContain('🎉 [TUÂN THỦ BÁO CÁO - Nhóm Kinh Doanh]');
      expect(msg).toContain('100% nhân sự (5/5)');
      expect(msg).toContain('Cảm ơn tinh thần trách nhiệm');
    });

    it('filters missingNames against personnel whitelist to prevent prompt injection defamation', () => {
      const msg = buildDeterministicReminderMessage(
        {
          totalExpected: 3,
          completedCount: 1,
          missingCount: 2,
          missingNames: ['Trần Thị B', 'Kẻ Xấu Độc Hại Tiêm Nhiễm'],
        },
        'Nhóm Kinh Doanh',
        '10:00',
        ['Nguyễn Văn A', 'Trần Thị B', 'Lê Văn C'],
      );

      expect(msg).toContain('- Trần Thị B');
      // Injected name not in personnel whitelist must be excluded
      expect(msg).not.toContain('Kẻ Xấu Độc Hại Tiêm Nhiễm');
    });
  });

  describe('isValidAuditJson', () => {
    it('returns true for valid audit JSON', () => {
      const valid = JSON.stringify({
        telemetry: {
          totalExpected: 2,
          compliantNames: ['A'],
          missingNames: ['B'],
        },
        supervisoryReportMarkdown: '## 🟢 ĐÃ HOÀN THÀNH',
      });
      expect(isValidAuditJson(valid)).toBe(true);
    });

    it('returns true for valid audit JSON wrapped in markdown code fence', () => {
      const valid = '```json\n{"telemetry":{"totalExpected":1,"compliantNames":[],"missingNames":[]},"supervisoryReportMarkdown":"Report"}\n```';
      expect(isValidAuditJson(valid)).toBe(true);
    });

    it('returns false for plain markdown without telemetry JSON', () => {
      expect(isValidAuditJson('# Báo cáo giám sát không có JSON')).toBe(false);
      expect(isValidAuditJson('{"otherKey": 123}')).toBe(false);
    });
  });

  describe('parseEvaluationOutput', () => {
    it('parses valid JSON inside markdown code fence', () => {
      const jsonText = `\`\`\`json
{
  "telemetry": {
    "totalExpected": 2,
    "completedCount": 1,
    "missingCount": 1,
    "anomaliesCount": 0,
    "compliantNames": ["A"],
    "missingNames": ["B"],
    "anomaliesList": []
  },
  "supervisoryReportMarkdown": "# BÁO CÁO GIÁM SÁT"
}
\`\`\``;

      const res = parseEvaluationOutput(jsonText);
      expect(res.telemetry.totalExpected).toBe(2);
      expect(res.telemetry.completedCount).toBe(1);
      expect(res.telemetry.compliantNames).toEqual(['A']);
      expect(res.supervisoryReportMarkdown).toBe('# BÁO CÁO GIÁM SÁT');
    });

    it('throws AuditEvaluationParseError when output is raw markdown (never returns unparsed text as report)', () => {
      const raw = '# Báo cáo trực tiếp không có JSON';
      expect(() => parseEvaluationOutput(raw)).toThrow(AuditEvaluationParseError);
    });
  });

  describe('buildAuditPrompt', () => {
    it('includes fuzzy matching instructions and expected output format', () => {
      const prompt = buildAuditPrompt({
        rule: mockRule,
        groupName: 'Nhóm Kinh Doanh',
        personnel: ['Nguyễn Văn A', 'Trần Thị B'],
        formattedMessages: '[09:15] Văn A: Em nộp kế hoạch hôm nay',
        imageCount: 2,
      });

      expect(prompt).toContain('FUZZY & ALIAS MATCHING');
      expect(prompt).toContain('Nguyễn Văn A');
      expect(prompt).toContain('Trần Thị B');
      expect(prompt).toContain('supervisoryReportMarkdown');
      expect(prompt).toContain('2 ảnh');
    });
  });

  describe('evaluateAuditRule end-to-end integration', () => {
    it('executes full evaluation, persists GeneratedReport, and dispatches to dual channels', async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: 'conv-source-1',
        contact: { fullName: 'Nhóm Vận Hành' },
      } as any);

      vi.mocked(prisma.message.findMany).mockResolvedValue([
        {
          id: 'msg-1',
          senderName: 'Văn A',
          senderType: 'contact',
          content: 'Em gửi kế hoạch hôm nay ạ',
          contentType: 'text',
          sentAt: new Date(),
        },
      ] as any);

      // Mock cached personnel so whitelist includes both employees
      vi.mocked(prisma.appSetting.findUnique).mockResolvedValue({
        id: 's-cached-members',
        orgId,
        settingKey: 'cached_group_members:group-source-1',
        valuePlain: JSON.stringify(['Nguyễn Văn A', 'Trần Thị B']),
        valueEncrypted: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.aiReportJob.create).mockResolvedValue({
        id: 'job-lease-123',
        status: 'running',
      } as any);
      vi.mocked(prisma.aiReportJob.findFirst).mockResolvedValue({
        id: 'job-lease-123',
        status: 'running',
      } as any);
      vi.mocked(prisma.aiReportJob.update).mockResolvedValue({} as any);

      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        { leaseExpiresAt: new Date(Date.now() + 60000) },
      ] as any);
      vi.mocked(prisma.aiReportBudgetReservation.aggregate).mockResolvedValue({
        _sum: { inputTokens: 0, outputTokens: 0 },
      } as any);
      vi.mocked(prisma.aiReportBudgetReservation.create).mockResolvedValue({} as any);
      vi.mocked(prisma.aiReportBudgetReservation.updateMany).mockResolvedValue({ count: 1 } as any);

      const aiResponseJson = JSON.stringify({
        telemetry: {
          totalExpected: 2,
          completedCount: 1,
          missingCount: 1,
          anomaliesCount: 0,
          compliantNames: ['Nguyễn Văn A'],
          missingNames: ['Trần Thị B'],
          anomaliesList: [],
        },
        supervisoryReportMarkdown: '# 📋 BÁO CÁO GIÁM SÁT CHI TIẾT',
      });

      vi.mocked(aiClient.generateContent).mockResolvedValue(aiResponseJson);

      vi.mocked(prisma.generatedReport.create).mockResolvedValue({
        id: 'rep-created-456',
      } as any);
      vi.mocked(prisma.generatedReport.update).mockResolvedValue({} as any);

      vi.mocked(zaloSender.sendReportToZalo).mockResolvedValue({
        success: true,
        partsSent: 1,
        totalParts: 1,
        deliveryUncertain: false,
      });

      const user = { id: 'user-admin', orgId, role: 'admin' };
      const result = await evaluateAuditRule(orgId, mockRule, user, { isTestRun: true });

      expect(result.reportId).toBe('rep-created-456');
      expect(result.lastRunStatus).toBe('success');
      expect(result.supervisoryReportMarkdown).toBe('# 📋 BÁO CÁO GIÁM SÁT CHI TIẾT');
      expect(result.operationalReminderMessage).toContain('Trần Thị B');

      // Check GeneratedReport saved with schema v2
      expect(prisma.generatedReport.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reportType: 'audit_rule',
            targetSchemaVersion: 2,
            targetResolutionStatus: 'verified',
            metadata: expect.objectContaining({ isTestRun: true }),
          }),
        }),
      );

      // Check Dual-Dispatch
      // Channel 1: Supervisory report to group-dest-2 with full metadata
      expect(zaloSender.sendReportToZalo).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationType: 'group',
          targetThreadId: 'group-dest-2',
          customPrefixType: 'audit',
          reportTitle: 'Đánh Giá Tuân Thủ: Nhóm Vận Hành',
          periodText: expect.stringContaining('10:00'),
          scopeText: 'Nhóm Vận Hành',
          auditTelemetry: expect.objectContaining({ totalExpected: 2 }),
        }),
      );
      // Channel 2: Operational reminder to source group-source-1
      expect(zaloSender.sendReportToZalo).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationType: 'group',
          targetThreadId: 'group-source-1',
          customPrefixType: 'none',
        }),
      );
    });

    it('catches AuditEvaluationParseError with error boundary, sends fallback report to Channel 1 and BLOCKS Channel 2', async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: 'conv-source-1',
        contact: { fullName: 'Nhóm Vận Hành' },
      } as any);
      vi.mocked(prisma.message.findMany).mockResolvedValue([]);
      vi.mocked(prisma.aiReportJob.create).mockResolvedValue({ id: 'job-err', status: 'running' } as any);
      vi.mocked(prisma.aiReportJob.findFirst).mockResolvedValue({ id: 'job-err', status: 'running' } as any);
      vi.mocked(prisma.aiReportJob.update).mockResolvedValue({} as any);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ leaseExpiresAt: new Date(Date.now() + 60000) }] as any);
      vi.mocked(prisma.aiReportBudgetReservation.aggregate).mockResolvedValue({ _sum: { inputTokens: 0, outputTokens: 0 } } as any);
      vi.mocked(prisma.aiReportBudgetReservation.create).mockResolvedValue({} as any);
      vi.mocked(prisma.aiReportBudgetReservation.updateMany).mockResolvedValue({ count: 1 } as any);

      // AI returns unparseable text
      vi.mocked(aiClient.generateContent).mockResolvedValue('Plain text without JSON');

      vi.mocked(prisma.generatedReport.create).mockResolvedValue({ id: 'rep-fallback-123' } as any);
      vi.mocked(zaloSender.sendReportToZalo).mockResolvedValue({
        success: true,
        partsSent: 1,
        totalParts: 1,
        deliveryUncertain: false,
      });

      const result = await evaluateAuditRule(orgId, mockRule, null);

      expect(result.reportId).toBe('rep-fallback-123');
      expect(result.lastRunStatus).toBe('success');
      expect(result.supervisoryReportMarkdown).toContain('BÁO CÁO SỰ CỐ KỸ THUẬT');
      // Channel 2 must be strictly blocked!
      expect(result.operationalReminderMessage).toBeUndefined();

      // GeneratedReport must record structuredData parseError: true
      expect(prisma.generatedReport.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            structuredData: { parseError: true },
          }),
        }),
      );

      // Channel 1 sent, Channel 2 NOT sent
      expect(zaloSender.sendReportToZalo).toHaveBeenCalledTimes(1);
      expect(zaloSender.sendReportToZalo).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationType: 'group',
          targetThreadId: 'group-dest-2',
          customPrefixType: 'audit',
        }),
      );
    });

    it('handles dispatch failure gracefully without losing generated report', async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: 'conv-source-1',
        contact: { fullName: 'Nhóm Vận Hành' },
      } as any);
      vi.mocked(prisma.message.findMany).mockResolvedValue([]);
      vi.mocked(prisma.aiReportJob.create).mockResolvedValue({ id: 'job-1', status: 'running' } as any);
      vi.mocked(prisma.aiReportJob.findFirst).mockResolvedValue({ id: 'job-1', status: 'running' } as any);
      vi.mocked(prisma.aiReportJob.update).mockResolvedValue({} as any);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ leaseExpiresAt: new Date(Date.now() + 60000) }] as any);
      vi.mocked(prisma.aiReportBudgetReservation.aggregate).mockResolvedValue({ _sum: { inputTokens: 0, outputTokens: 0 } } as any);
      vi.mocked(prisma.aiReportBudgetReservation.create).mockResolvedValue({} as any);
      vi.mocked(prisma.aiReportBudgetReservation.updateMany).mockResolvedValue({ count: 1 } as any);

      vi.mocked(aiClient.generateContent).mockResolvedValue(
        JSON.stringify({
          telemetry: { totalExpected: 1, completedCount: 1, missingCount: 0, compliantNames: ['A'], missingNames: [], anomaliesList: [] },
          supervisoryReportMarkdown: 'Report Content',
        }),
      );

      vi.mocked(prisma.generatedReport.create).mockResolvedValue({ id: 'rep-saved-789' } as any);

      // Simulate Zalo dispatch failure
      vi.mocked(zaloSender.sendReportToZalo).mockResolvedValueOnce({
        success: false,
        partsSent: 0,
        totalParts: 1,
        deliveryUncertain: false,
        error: 'Tài khoản mất quyền gửi tin vào nhóm giám sát',
      });

      const result = await evaluateAuditRule(orgId, mockRule, null);
      expect(result.reportId).toBe('rep-saved-789');
      expect(result.lastRunStatus).toBe('dispatch_failed');
      expect(result.error).toContain('Tài khoản mất quyền gửi tin vào nhóm giám sát');

      // Verify stats updated with dispatch_failed
      expect(prisma.appSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_settingKey: { orgId, settingKey: 'ai_audit_stat:rule-test-101' } },
          create: expect.objectContaining({
            valuePlain: expect.stringContaining('dispatch_failed'),
          }),
        }),
      );
    });
  });
});
