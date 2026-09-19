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
 * Thrown when AI output cannot be parsed into valid audit JSON structure.
 * Caught by the error boundary in evaluateAuditRule to trigger fallback report.
 */
export class AuditEvaluationParseError extends Error {
  constructor(message = 'Không thể phân tích đầu ra AI thành cấu trúc JSON kiểm toán hợp lệ.') {
    super(message);
    this.name = 'AuditEvaluationParseError';
  }
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
 * Lightweight pre-screen: checks if AI raw output contains a parseable JSON with `telemetry` key.
 * Used as `validateOutput` callback for AiProviderRouter to trigger failover when AI returns
 * unparseable Markdown instead of structured JSON.
 */
export function isValidAuditJson(rawOutput: string): boolean {
  try {
    let cleaned = rawOutput.trim();
    // Strip markdown code block wrapper
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }
    // Try direct parse first
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Fallback: find outermost { ... } containing "telemetry"
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return false;
      const candidate = cleaned.slice(firstBrace, lastBrace + 1);
      if (!candidate.includes('"telemetry"')) return false;
      parsed = JSON.parse(candidate);
    }
    // Validate minimum required structure
    if (!parsed || typeof parsed !== 'object') return false;
    const t = parsed.telemetry;
    if (!t || typeof t !== 'object') return false;
    if (!('totalExpected' in t) || !('compliantNames' in t) || !('missingNames' in t)) return false;
    if (typeof parsed.supervisoryReportMarkdown !== 'string') return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds deterministic reminder message from telemetry data (immune to prompt injection).
 * Filters missingNames through personnel whitelist to prevent injection-based defamation.
 */
export function buildDeterministicReminderMessage(
  telemetry: Partial<AuditTelemetry>,
  groupName: string,
  runTime: string,
  personnel?: string[],
): string {
  let missing = (telemetry.missingNames || []).filter(Boolean);
  const total = telemetry.totalExpected || 0;
  const completed = telemetry.completedCount || 0;

  // Whitelist filter: only names present in personnel list are allowed in reminder
  if (personnel && personnel.length > 0) {
    const personnelLower = personnel.map((p) => p.toLowerCase().trim());
    missing = missing.filter((name) => {
      const nameLower = name.toLowerCase().trim();
      return personnelLower.some(
        (p) => p === nameLower || p.includes(nameLower) || nameLower.includes(p),
      );
    });
  }

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
 * Throws AuditEvaluationParseError if JSON cannot be extracted — NEVER assigns raw text as report.
 */
export function parseEvaluationOutput(rawOutput: string): {
  telemetry: AuditTelemetry;
  supervisoryReportMarkdown: string;
} {
  let cleaned = rawOutput.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }

  // Attempt 1: Direct JSON parse
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Attempt 2: Find outermost { ... } containing "telemetry"
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const candidate = cleaned.slice(firstBrace, lastBrace + 1);
      if (candidate.includes('"telemetry"')) {
        try {
          parsed = JSON.parse(candidate);
        } catch {
          // fall through to error
        }
      }
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    logger.error(
      { rawAiOutputPreview: rawOutput.slice(0, 500) },
      '[ai-audit-evaluator-helpers] Cannot parse AI output as JSON',
    );
    throw new AuditEvaluationParseError();
  }

  const telemetry = parsed.telemetry;
  if (!telemetry || typeof telemetry !== 'object') {
    logger.error(
      { rawAiOutputPreview: rawOutput.slice(0, 500) },
      '[ai-audit-evaluator-helpers] Parsed JSON missing telemetry field',
    );
    throw new AuditEvaluationParseError('Đầu ra JSON thiếu trường telemetry bắt buộc.');
  }

  const supervisoryReportMarkdown =
    typeof parsed.supervisoryReportMarkdown === 'string'
      ? parsed.supervisoryReportMarkdown
      : '';

  if (!supervisoryReportMarkdown) {
    logger.warn('[ai-audit-evaluator-helpers] supervisoryReportMarkdown is empty, using fallback');
  }

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
    supervisoryReportMarkdown: supervisoryReportMarkdown || `# ⚠️ Báo cáo giám sát\n\nHệ thống đã phân tích thành công nhưng nội dung báo cáo Markdown trống.`,
  };
}

/**
 * Generates a structured technical fallback report when AI parse completely fails after all providers.
 * Sent to Channel 1 (supervisory group) only. Channel 2 is BLOCKED absolutely.
 */
export function buildStructuredFallbackAuditReport(params: {
  groupName: string;
  runTime: string;
  errorMessage: string;
  rawOutputPreview?: string;
}): string {
  const { groupName, runTime, errorMessage, rawOutputPreview } = params;
  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  return (
    `# ⚠️ BÁO CÁO SỰ CỐ KỸ THUẬT — KIỂM TOÁN TUÂN THỦ\n\n` +
    `## Nhóm: ${groupName}\n` +
    `## Mốc chốt: ${runTime}\n` +
    `## Thời gian phát sinh: ${now}\n\n` +
    `---\n\n` +
    `**Trạng thái:** ❌ Hệ thống phân tích AI không thể sinh báo cáo tuân thủ hợp lệ sau khi thử toàn bộ nhà cung cấp dự phòng.\n\n` +
    `**Nguyên nhân kỹ thuật:** ${errorMessage}\n\n` +
    `**Hành động cần thiết:**\n` +
    `- Quản trị viên kiểm tra cấu hình AI Provider và kết nối mạng.\n` +
    `- Chạy lại đánh giá tuân thủ thủ công qua giao diện ZaloCRM.\n` +
    `- Nếu lỗi lặp lại, liên hệ đội kỹ thuật.\n\n` +
    (rawOutputPreview
      ? `**Đầu ra AI thô (rút gọn):**\n\`\`\`\n${rawOutputPreview.slice(0, 300)}\n\`\`\`\n`
      : '')
  );
}
