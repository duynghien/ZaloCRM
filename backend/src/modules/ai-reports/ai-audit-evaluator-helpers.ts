import { prisma } from '../../shared/database/prisma-client.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { logger } from '../../shared/utils/logger.js';

export interface AuditTelemetry {
  totalExpected: number;
  completedCount: number;
  missingCount: number;
  anomaliesCount: number;
  compliantNames: string[];
  missingNames: string[];
  anomaliesList: string[];
}

/**
 * Strictly computes the scan window boundary in Asia/Ho_Chi_Minh (UTC+7).
 */
export function computeScanWindow(
  scanWindowType: 'since_start_of_day' | 'last_n_hours',
  scanWindowHours: number = 24,
  now = new Date(),
): { periodFrom: Date; periodTo: Date } {
  const periodTo = new Date(now);

  if (scanWindowType === 'last_n_hours') {
    const hours = Math.max(1, Math.min(168, scanWindowHours || 24));
    const periodFrom = new Date(periodTo.getTime() - hours * 3600 * 1000);
    return { periodFrom, periodTo };
  }

  // 'since_start_of_day' in Asia/Ho_Chi_Minh
  const vnDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const periodFrom = new Date(`${vnDateStr}T00:00:00.000+07:00`);
  return { periodFrom, periodTo };
}

/**
 * Dynamically resolves personnel without survivorship bias.
 */
export async function resolveAuditPersonnel(
  orgId: string,
  rule: {
    personnelType: 'explicit_list' | 'all_group_members';
    personnelList?: string[];
    zaloAccountId: string;
    groupThreadId: string;
  },
): Promise<{ personnel: string[]; source: 'explicit' | 'api' | 'cache' }> {
  if (rule.personnelType === 'explicit_list') {
    const list = (rule.personnelList || []).map((n) => n.trim()).filter(Boolean);
    return { personnel: list, source: 'explicit' };
  }

  // Tier 1: Query live Zalo API getGroupInfo
  const api = zaloPool.getApi(rule.zaloAccountId);
  if (api && typeof api.getGroupInfo === 'function') {
    try {
      const info = await api.getGroupInfo(rule.groupThreadId);
      const memList: any[] =
        info?.gridInfoMap?.[rule.groupThreadId]?.memList ||
        info?.memList ||
        info?.currentMems ||
        [];

      if (Array.isArray(memList) && memList.length > 0) {
        const names = memList
          .map((m: any) => m.dName || m.displayName || m.zName || m.name)
          .filter((name: any): name is string => typeof name === 'string' && name.trim().length > 0)
          .map((n) => n.trim());

        if (names.length > 0) {
          const unique = Array.from(new Set(names));
          return { personnel: unique, source: 'api' };
        }
      }
    } catch (err: any) {
      logger.warn(
        { err: err?.message, groupThreadId: rule.groupThreadId },
        '[ai-audit-evaluator] getGroupInfo failed, attempting cache fallback',
      );
    }
  }

  // Tier 2: Cached group members
  const cachedMembersSetting = await prisma.appSetting.findUnique({
    where: {
      orgId_settingKey: {
        orgId,
        settingKey: `cached_group_members:${rule.groupThreadId}`,
      },
    },
  });

  if (cachedMembersSetting?.valuePlain) {
    try {
      const parsed = JSON.parse(cachedMembersSetting.valuePlain);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { personnel: parsed, source: 'cache' };
      }
    } catch {
      // ignore
    }
  }

  // Anti-Survivorship Bias: Do NOT fall back to message senders
  return { personnel: [], source: 'cache' };
}

/**
 * Builds deterministic reminder message from telemetry data (immune to prompt injection).
 */
export function buildDeterministicReminderMessage(
  telemetry: Partial<AuditTelemetry>,
  groupName: string,
  runTime: string,
): string {
  const missing = (telemetry.missingNames || []).filter(Boolean);
  const total = telemetry.totalExpected || 0;
  const completed = telemetry.completedCount || 0;

  if (missing.length === 0 && total > 0) {
    return (
      `🎉 [TUÂN THỦ BÁO CÁO - ${groupName}]\n\n` +
      `Tuyệt vời! Hệ thống ghi nhận 100% nhân sự (${completed}/${total}) đã hoàn thành gửi báo cáo đúng hạn tính đến mốc ${runTime}.\n` +
      `Cảm ơn tinh thần trách nhiệm và sự chuyên nghiệp của cả nhà! 👏`
    );
  }

  let deadlineNotice = '30 phút nữa';
  try {
    const [h, m] = runTime.split(':').map(Number);
    if (!isNaN(h) && !isNaN(m)) {
      const extraMinutes = h * 60 + m + 30;
      const newH = Math.floor((extraMinutes / 60) % 24);
      const newM = extraMinutes % 60;
      deadlineNotice = `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
    }
  } catch {
    // fallback
  }

  const missingListStr =
    missing.length > 0
      ? missing.map((name) => `- ${name}`).join('\n')
      : '- Các thành viên chưa nộp';

  return (
    `🔔 [NHẮC NHỞ TUÂN THỦ BÁO CÁO - ${groupName}]\n\n` +
    `Chào cả nhà, đã đến mốc chốt kiểm tra ${runTime}. Hệ thống hiện chưa ghi nhận báo cáo từ các bạn:\n` +
    `${missingListStr}\n\n` +
    `👉 Các bạn vui lòng gửi bổ sung trước ${deadlineNotice} nhé!\n` +
    `(Lưu ý: Nếu bạn đã gửi mà hệ thống đọc sót, vui lòng phản hồi tại đây để được đối chiếu).`
  );
}

/**
 * Safely parses the JSON output returned by LLM.
 */
export function parseEvaluationOutput(rawOutput: string): {
  telemetry: AuditTelemetry;
  supervisoryReportMarkdown: string;
} {
  let cleaned = rawOutput.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);
    const telemetry = parsed.telemetry || {};
    return {
      telemetry: {
        totalExpected: Number(telemetry.totalExpected) || 0,
        completedCount: Number(telemetry.completedCount) || 0,
        missingCount: Number(telemetry.missingCount) || 0,
        anomaliesCount: Number(telemetry.anomaliesCount) || 0,
        compliantNames: Array.isArray(telemetry.compliantNames) ? telemetry.compliantNames : [],
        missingNames: Array.isArray(telemetry.missingNames) ? telemetry.missingNames : [],
        anomaliesList: Array.isArray(telemetry.anomaliesList) ? telemetry.anomaliesList : [],
      },
      supervisoryReportMarkdown:
        typeof parsed.supervisoryReportMarkdown === 'string'
          ? parsed.supervisoryReportMarkdown
          : cleaned,
    };
  } catch {
    return {
      telemetry: {
        totalExpected: 0,
        completedCount: 0,
        missingCount: 0,
        anomaliesCount: 0,
        compliantNames: [],
        missingNames: [],
        anomaliesList: [],
      },
      supervisoryReportMarkdown: cleaned,
    };
  }
}
