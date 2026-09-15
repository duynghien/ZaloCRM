import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateAuditRuleInput,
  getAuditRules,
  getAuditRuleById,
  saveAuditRule,
  deleteAuditRule,
  updateRuleRunStats,
  AuditRuleValidationError,
  type CreateAuditRuleInput,
} from '../src/modules/ai-reports/ai-audit-rule-service.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import * as targetService from '../src/modules/ai-reports/report-target-service.js';

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(async (cb) => cb(prisma)),
    $executeRaw: vi.fn(),
  },
}));

vi.mock('../src/modules/ai-reports/report-target-service.js', () => ({
  resolveReportTargets: vi.fn(),
  ReportTargetError: class ReportTargetError extends Error {
    constructor(public statusCode: number, message: string) {
      super(message);
    }
  },
}));

describe('ai-audit-rule-service', () => {
  const orgId = 'org-test-123';
  const user = { id: 'user-1', orgId, role: 'admin' };

  const validRuleInput: CreateAuditRuleInput = {
    name: 'Kiểm tra báo cáo sáng',
    isEnabled: true,
    zaloAccountId: 'acc-1',
    groupThreadId: 'group-1',
    groupName: 'Nhóm Kinh Doanh',
    runTime: '09:30',
    daysOfWeek: [1, 2, 3, 4, 5],
    scanWindowType: 'since_start_of_day',
    personnelType: 'all_group_members',
    templateType: 'schedule_submission',
    destinationType: 'group',
    targetGroupId: 'target-group-1',
    targetGroupName: 'Nhóm Giám Sát',
    sendOperationalReminder: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(targetService, 'resolveReportTargets').mockResolvedValue([
      { zaloAccountId: 'acc-1', groupThreadId: 'group-1', conversationId: 'conv-1' },
    ]);
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue({ id: 'target-conv-1' } as any);
  });

  describe('validateAuditRuleInput', () => {
    it('validates a correct audit rule input without throwing', async () => {
      await expect(validateAuditRuleInput(orgId, validRuleInput, user)).resolves.not.toThrow();
    });

    it('rejects empty or excessively long rule names', async () => {
      await expect(
        validateAuditRuleInput(orgId, { ...validRuleInput, name: '   ' }, user),
      ).rejects.toThrow(AuditRuleValidationError);

      await expect(
        validateAuditRuleInput(orgId, { ...validRuleInput, name: 'a'.repeat(201) }, user),
      ).rejects.toThrow(AuditRuleValidationError);
    });

    it('rejects invalid runTime formats', async () => {
      await expect(
        validateAuditRuleInput(orgId, { ...validRuleInput, runTime: '25:00' }, user),
      ).rejects.toThrow('Giờ chạy không hợp lệ');

      await expect(
        validateAuditRuleInput(orgId, { ...validRuleInput, runTime: '9:30' }, user),
      ).rejects.toThrow('Giờ chạy không hợp lệ');
    });

    it('rejects invalid daysOfWeek', async () => {
      await expect(
        validateAuditRuleInput(orgId, { ...validRuleInput, daysOfWeek: [] }, user),
      ).rejects.toThrow('Ngày trong tuần không hợp lệ');

      await expect(
        validateAuditRuleInput(orgId, { ...validRuleInput, daysOfWeek: [0, 8] }, user),
      ).rejects.toThrow('Ngày trong tuần không hợp lệ');
    });

    it('rejects last_n_hours when scanWindowHours is invalid', async () => {
      await expect(
        validateAuditRuleInput(
          orgId,
          { ...validRuleInput, scanWindowType: 'last_n_hours', scanWindowHours: 0 },
          user,
        ),
      ).rejects.toThrow('Số giờ quét phải là số nguyên');
    });

    it('rejects explicit_list when personnelList is empty', async () => {
      await expect(
        validateAuditRuleInput(
          orgId,
          { ...validRuleInput, personnelType: 'explicit_list', personnelList: [] },
          user,
        ),
      ).rejects.toThrow('Danh sách nhân sự không được để trống');
    });

    it('rejects group destination when destination group is not in organization', async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(null);
      await expect(
        validateAuditRuleInput(orgId, validRuleInput, user),
      ).rejects.toThrow('Nhóm Zalo đích nhận báo cáo không tồn tại trong tổ chức');
    });

    it('rejects uid destination when targetUid is missing', async () => {
      await expect(
        validateAuditRuleInput(
          orgId,
          { ...validRuleInput, destinationType: 'uid', targetUid: '' },
          user,
        ),
      ).rejects.toThrow('targetUid không được để trống');
    });

    it('rejects email destination with invalid email addresses', async () => {
      await expect(
        validateAuditRuleInput(
          orgId,
          { ...validRuleInput, destinationType: 'email', emailRecipients: ['not-an-email'] },
          user,
        ),
      ).rejects.toThrow('Địa chỉ email không hợp lệ');
    });
  });

  describe('getAuditRules & saveAuditRule with decoupled stats', () => {
    it('returns empty array when no rules exist', async () => {
      vi.mocked(prisma.appSetting.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.appSetting.findMany).mockResolvedValue([]);

      const rules = await getAuditRules(orgId);
      expect(rules).toEqual([]);
    });

    it('merges decoupled runtime stats into returned rules', async () => {
      const storedRule = {
        id: 'rule-1',
        name: 'Rule 1',
        isEnabled: true,
        zaloAccountId: 'acc-1',
        groupThreadId: 'group-1',
        runTime: '10:00',
        daysOfWeek: [1],
        scanWindowType: 'since_start_of_day' as const,
        personnelType: 'all_group_members' as const,
        templateType: 'schedule_submission' as const,
        destinationType: 'group' as const,
        sendOperationalReminder: true,
        createdAt: '2026-09-14T00:00:00Z',
        updatedAt: '2026-09-14T00:00:00Z',
      };

      vi.mocked(prisma.appSetting.findUnique).mockResolvedValue({
        id: 'set-1',
        orgId,
        settingKey: 'ai_audit_rules',
        valuePlain: JSON.stringify([storedRule]),
        valueEncrypted: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.appSetting.findMany).mockResolvedValue([
        {
          id: 'stat-1',
          orgId,
          settingKey: 'ai_audit_stat:rule-1',
          valuePlain: JSON.stringify({
            lastRunAt: '2026-09-14T10:00:00Z',
            lastRunStatus: 'success',
            lastRunReportId: 'rep-123',
            lastError: null,
          }),
          valueEncrypted: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const rules = await getAuditRules(orgId);
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe('rule-1');
      expect(rules[0].lastRunStatus).toBe('success');
      expect(rules[0].lastRunReportId).toBe('rep-123');

      const single = await getAuditRuleById(orgId, 'rule-1');
      expect(single?.lastRunStatus).toBe('success');
    });

    it('creates a new rule and saves clean config without stats', async () => {
      vi.mocked(prisma.appSetting.findUnique).mockResolvedValue(null);

      const result = await saveAuditRule(orgId, validRuleInput, user);
      expect(result.id).toBeDefined();
      expect(result.name).toBe('Kiểm tra báo cáo sáng');
      expect(prisma.appSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_settingKey: { orgId, settingKey: 'ai_audit_rules' } },
        }),
      );
    });

    it('updates runtime stats independently with updateRuleRunStats', async () => {
      await updateRuleRunStats(orgId, 'rule-1', {
        lastRunAt: '2026-09-14T10:05:00Z',
        lastRunStatus: 'dispatch_failed',
        lastRunReportId: 'rep-999',
        lastError: 'Zalo group permission revoked',
      });

      expect(prisma.appSetting.upsert).toHaveBeenCalledWith({
        where: { orgId_settingKey: { orgId, settingKey: 'ai_audit_stat:rule-1' } },
        create: {
          orgId,
          settingKey: 'ai_audit_stat:rule-1',
          valuePlain: expect.stringContaining('dispatch_failed'),
        },
        update: {
          valuePlain: expect.stringContaining('dispatch_failed'),
        },
      });
    });

    it('deletes a rule and cleans up its decoupled runtime stat', async () => {
      vi.mocked(prisma.appSetting.findUnique).mockResolvedValue({
        id: 'set-1',
        orgId,
        settingKey: 'ai_audit_rules',
        valuePlain: JSON.stringify([{ id: 'rule-to-delete', name: 'Rule To Delete' }]),
        valueEncrypted: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(prisma.appSetting.delete).mockResolvedValue({} as any);

      const deleted = await deleteAuditRule(orgId, 'rule-to-delete');
      expect(deleted).toBe(true);
      expect(prisma.appSetting.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { valuePlain: '[]' },
        }),
      );
      expect(prisma.appSetting.delete).toHaveBeenCalledWith({
        where: { orgId_settingKey: { orgId, settingKey: 'ai_audit_stat:rule-to-delete' } },
      });
    });
  });
});
