import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { resolveReportTargets, ReportTargetError } from './report-target-service.js';

export interface AiAuditRule {
  id: string;
  name: string;
  isEnabled: boolean;
  zaloAccountId: string;
  groupThreadId: string;
  groupName?: string;
  runTime: string; // "HH:mm" e.g. "10:00"
  daysOfWeek: number[]; // 1=Mon .. 7=Sun
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

export type CreateAuditRuleInput = Omit<
  AiAuditRule,
  'id' | 'createdAt' | 'updatedAt' | 'lastRunAt' | 'lastRunStatus' | 'lastRunReportId' | 'lastError'
>;

export type UpdateAuditRuleInput = Partial<CreateAuditRuleInput>;

export interface AiAuditRuleRunStats {
  lastRunAt: string;
  lastRunStatus: 'success' | 'failed' | 'dispatch_failed';
  lastRunReportId?: string | null;
  lastError?: string | null;
}

const SETTING_KEY_RULES = 'ai_audit_rules';
const statKey = (ruleId: string) => `ai_audit_stat:${ruleId}`;

export class AuditRuleValidationError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'AuditRuleValidationError';
  }
}

/**
 * Validate audit rule input parameters and cross-tenant target authorization.
 */
export async function validateAuditRuleInput(
  orgId: string,
  input: CreateAuditRuleInput | UpdateAuditRuleInput,
  user: { id: string; orgId: string; role: string } | null,
  isUpdate = false,
): Promise<void> {
  if (!isUpdate || input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200) {
      throw new AuditRuleValidationError(400, 'Tên quy tắc không hợp lệ (tối đa 200 ký tự)');
    }
  }

  if (!isUpdate || input.runTime !== undefined) {
    if (typeof input.runTime !== 'string' || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(input.runTime)) {
      throw new AuditRuleValidationError(400, 'Giờ chạy không hợp lệ, định dạng phải là HH:mm (ví dụ 10:00)');
    }
  }

  if (!isUpdate || input.daysOfWeek !== undefined) {
    if (
      !Array.isArray(input.daysOfWeek) ||
      input.daysOfWeek.length === 0 ||
      input.daysOfWeek.some((d) => !Number.isInteger(d) || d < 1 || d > 7)
    ) {
      throw new AuditRuleValidationError(400, 'Ngày trong tuần không hợp lệ (mảng các số từ 1 đến 7)');
    }
  }

  if (!isUpdate || input.scanWindowType !== undefined) {
    if (!['since_start_of_day', 'last_n_hours'].includes(input.scanWindowType || '')) {
      throw new AuditRuleValidationError(400, 'Khung giờ quét không hợp lệ');
    }
    if (input.scanWindowType === 'last_n_hours') {
      const hours = input.scanWindowHours;
      if (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > 168) {
        throw new AuditRuleValidationError(400, 'Số giờ quét phải là số nguyên từ 1 đến 168 giờ');
      }
    }
  }

  if (!isUpdate || input.personnelType !== undefined) {
    if (!['explicit_list', 'all_group_members'].includes(input.personnelType || '')) {
      throw new AuditRuleValidationError(400, 'Loại nhân sự kiểm tra không hợp lệ');
    }
    if (input.personnelType === 'explicit_list') {
      if (!Array.isArray(input.personnelList) || input.personnelList.length === 0) {
        throw new AuditRuleValidationError(400, 'Danh sách nhân sự không được để trống khi chọn nhập cụ thể');
      }
    }
  }

  if (!isUpdate || input.templateType !== undefined) {
    if (!['schedule_submission', 'work_progress', 'image_verification', 'custom'].includes(input.templateType || '')) {
      throw new AuditRuleValidationError(400, 'Kịch bản nghiệp vụ không hợp lệ');
    }
  }

  if (!isUpdate || input.destinationType !== undefined) {
    if (!['group', 'self', 'cloud', 'uid', 'email'].includes(input.destinationType || '')) {
      throw new AuditRuleValidationError(400, 'Kênh nhận báo cáo không hợp lệ');
    }
  }

  // Authorize source group target
  if (input.zaloAccountId && input.groupThreadId) {
    try {
      await resolveReportTargets(
        orgId,
        { groupTargets: [{ zaloAccountId: input.zaloAccountId, groupThreadId: input.groupThreadId }] },
        user,
        'chat',
      );
    } catch (err: any) {
      if (err instanceof ReportTargetError) {
        throw new AuditRuleValidationError(err.statusCode, 'Nhóm Zalo nguồn không thuộc quyền quản lý của tổ chức');
      }
      throw err;
    }
  }

  // Authorize destination group target if group destination is selected
  if (input.destinationType === 'group' && input.targetGroupId) {
    const destConv = await prisma.conversation.findFirst({
      where: {
        orgId,
        threadType: 'group',
        externalThreadId: input.targetGroupId,
      },
    });
    if (!destConv) {
      throw new AuditRuleValidationError(400, 'Nhóm Zalo đích nhận báo cáo không tồn tại trong tổ chức');
    }
  }

  if (input.destinationType === 'uid' && !input.targetUid) {
    throw new AuditRuleValidationError(400, 'targetUid không được để trống khi chọn gửi UID');
  }

  if (input.destinationType === 'email') {
    if (!Array.isArray(input.emailRecipients) || input.emailRecipients.length === 0) {
      throw new AuditRuleValidationError(400, 'emailRecipients không được để trống khi chọn gửi Email');
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const email of input.emailRecipients) {
      if (typeof email !== 'string' || !emailRegex.test(email.trim())) {
        throw new AuditRuleValidationError(400, `Địa chỉ email không hợp lệ: ${email}`);
      }
    }
  }
}

/**
 * Retrieve all audit rules for an organization with merged decoupled runtime stats.
 */
export async function getAuditRules(orgId: string): Promise<AiAuditRule[]> {
  const [rulesSetting, statSettings] = await Promise.all([
    prisma.appSetting.findUnique({
      where: { orgId_settingKey: { orgId, settingKey: SETTING_KEY_RULES } },
    }),
    prisma.appSetting.findMany({
      where: {
        orgId,
        settingKey: { startsWith: 'ai_audit_stat:' },
      },
    }),
  ]);

  if (!rulesSetting?.valuePlain) {
    return [];
  }

  let storedRules: AiAuditRule[] = [];
  try {
    storedRules = JSON.parse(rulesSetting.valuePlain);
  } catch {
    storedRules = [];
  }

  const statMap = new Map<string, AiAuditRuleRunStats>();
  for (const s of statSettings) {
    const ruleId = s.settingKey.slice('ai_audit_stat:'.length);
    if (s.valuePlain) {
      try {
        statMap.set(ruleId, JSON.parse(s.valuePlain));
      } catch {
        // ignore invalid json
      }
    }
  }

  return storedRules.map((r) => {
    const stats = statMap.get(r.id);
    return {
      ...r,
      lastRunAt: stats?.lastRunAt ?? null,
      lastRunStatus: stats?.lastRunStatus ?? null,
      lastRunReportId: stats?.lastRunReportId ?? null,
      lastError: stats?.lastError ?? null,
    };
  });
}

/**
 * Retrieve a single audit rule by ID.
 */
export async function getAuditRuleById(orgId: string, ruleId: string): Promise<AiAuditRule | null> {
  const rules = await getAuditRules(orgId);
  return rules.find((r) => r.id === ruleId) || null;
}

/**
 * Create or update an audit rule with advisory locking and decoupled stats.
 */
export async function saveAuditRule(
  orgId: string,
  input: CreateAuditRuleInput | UpdateAuditRuleInput,
  user: { id: string; orgId: string; role: string } | null,
  ruleId?: string,
): Promise<AiAuditRule> {
  await validateAuditRuleInput(orgId, input, user, !!ruleId);

  return prisma.$transaction(async (tx) => {
    // Acquire transaction-scoped advisory lock to prevent lost updates under concurrency
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`audit-rules:${orgId}`}));`;

    const setting = await tx.appSetting.findUnique({
      where: { orgId_settingKey: { orgId, settingKey: SETTING_KEY_RULES } },
    });

    let rules: AiAuditRule[] = [];
    if (setting?.valuePlain) {
      try {
        rules = JSON.parse(setting.valuePlain);
      } catch {
        rules = [];
      }
    }

    const nowIso = new Date().toISOString();
    let savedRule: AiAuditRule;

    if (ruleId) {
      const idx = rules.findIndex((r) => r.id === ruleId);
      if (idx === -1) {
        throw new AuditRuleValidationError(404, 'Quy tắc không tồn tại');
      }
      const existing = rules[idx];
      savedRule = {
        ...existing,
        ...(input as UpdateAuditRuleInput),
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: nowIso,
      };
      rules[idx] = savedRule;
    } else {
      const createInput = input as CreateAuditRuleInput;
      savedRule = {
        id: randomUUID(),
        name: createInput.name,
        isEnabled: createInput.isEnabled ?? true,
        zaloAccountId: createInput.zaloAccountId,
        groupThreadId: createInput.groupThreadId,
        groupName: createInput.groupName,
        runTime: createInput.runTime,
        daysOfWeek: createInput.daysOfWeek,
        scanWindowType: createInput.scanWindowType,
        scanWindowHours: createInput.scanWindowHours,
        personnelType: createInput.personnelType,
        personnelList: createInput.personnelList ?? [],
        templateType: createInput.templateType,
        customPrompt: createInput.customPrompt,
        destinationType: createInput.destinationType,
        targetGroupId: createInput.targetGroupId,
        targetGroupName: createInput.targetGroupName,
        targetUid: createInput.targetUid,
        emailRecipients: createInput.emailRecipients ?? [],
        sendOperationalReminder: createInput.sendOperationalReminder ?? true,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      rules.push(savedRule);
    }

    // Persist only static configurations to avoid overwriting runtime stats
    const cleanRules = rules.map((r) => {
      const { lastRunAt, lastRunStatus, lastRunReportId, lastError, ...clean } = r;
      return clean;
    });

    await tx.appSetting.upsert({
      where: { orgId_settingKey: { orgId, settingKey: SETTING_KEY_RULES } },
      create: {
        orgId,
        settingKey: SETTING_KEY_RULES,
        valuePlain: JSON.stringify(cleanRules),
      },
      update: {
        valuePlain: JSON.stringify(cleanRules),
      },
    });

    // Read any existing decoupled stats for the rule
    const statSetting = await tx.appSetting.findUnique({
      where: { orgId_settingKey: { orgId, settingKey: statKey(savedRule.id) } },
    });
    let stats: AiAuditRuleRunStats | null = null;
    if (statSetting?.valuePlain) {
      try {
        stats = JSON.parse(statSetting.valuePlain);
      } catch {
        // ignore
      }
    }

    return {
      ...savedRule,
      lastRunAt: stats?.lastRunAt ?? null,
      lastRunStatus: stats?.lastRunStatus ?? null,
      lastRunReportId: stats?.lastRunReportId ?? null,
      lastError: stats?.lastError ?? null,
    };
  });
}

/**
 * Delete an audit rule and its associated runtime stats.
 */
export async function deleteAuditRule(orgId: string, ruleId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`audit-rules:${orgId}`}));`;

    const setting = await tx.appSetting.findUnique({
      where: { orgId_settingKey: { orgId, settingKey: SETTING_KEY_RULES } },
    });
    if (!setting?.valuePlain) return false;

    let rules: AiAuditRule[] = [];
    try {
      rules = JSON.parse(setting.valuePlain);
    } catch {
      return false;
    }

    const filtered = rules.filter((r) => r.id !== ruleId);
    if (filtered.length === rules.length) return false;

    await tx.appSetting.update({
      where: { orgId_settingKey: { orgId, settingKey: SETTING_KEY_RULES } },
      data: { valuePlain: JSON.stringify(filtered) },
    });

    // Delete decoupled runtime stat
    await tx.appSetting
      .delete({
        where: { orgId_settingKey: { orgId, settingKey: statKey(ruleId) } },
      })
      .catch(() => null);

    return true;
  });
}

/**
 * Update decoupled runtime stats for a rule without touching main config JSON.
 */
export async function updateRuleRunStats(
  orgId: string,
  ruleId: string,
  stats: AiAuditRuleRunStats,
): Promise<void> {
  await prisma.appSetting.upsert({
    where: { orgId_settingKey: { orgId, settingKey: statKey(ruleId) } },
    create: {
      orgId,
      settingKey: statKey(ruleId),
      valuePlain: JSON.stringify(stats),
    },
    update: {
      valuePlain: JSON.stringify(stats),
    },
  });
}
