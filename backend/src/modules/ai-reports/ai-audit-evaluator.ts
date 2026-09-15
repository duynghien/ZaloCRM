import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { filterAndFormatMessages, formatTranscriptForPrompt } from './noise-filter.js';
import { extractImagePartsFromMessages } from './attachment-image-loader.js';
import { generateContent, type ContentPart } from './ai-client.js';
import { createReportJobBudget, ReportControlError } from './report-job-budget.js';
import { sendReportToZalo } from './zalo-report-sender.js';
import { sendReportEmail } from './email-service.js';
import { updateRuleRunStats, type AiAuditRule } from './ai-audit-rule-service.js';
import { registerAuditRuleEvaluator } from './ai-audit-rule-routes.js';
import {
  computeScanWindow,
  resolveAuditPersonnel,
  buildDeterministicReminderMessage,
  parseEvaluationOutput,
} from './ai-audit-evaluator-helpers.js';
import { buildAuditPrompt } from './ai-audit-prompt-builder.js';

export interface EvaluateAuditRuleOptions {
  isTestRun?: boolean;
  isScheduled?: boolean;
  scheduleKey?: string;
}

export interface EvaluateAuditRuleResult {
  reportId?: string;
  supervisoryReportMarkdown: string;
  operationalReminderMessage?: string;
  lastRunStatus: 'success' | 'failed' | 'dispatch_failed';
  error?: string;
}

/**
 * Executes full multimodal audit evaluation, reports generation, and independent dual-channel dispatch.
 */
export async function evaluateAuditRule(
  orgId: string,
  rule: AiAuditRule,
  user: { id: string; orgId: string; role: string } | null,
  options?: EvaluateAuditRuleOptions,
): Promise<EvaluateAuditRuleResult> {
  const conv = await prisma.conversation.findFirst({
    where: {
      orgId,
      zaloAccountId: rule.zaloAccountId,
      externalThreadId: rule.groupThreadId,
    },
    include: { contact: { select: { fullName: true } } },
  });

  if (!conv) {
    throw new Error('Không tìm thấy cuộc trò chuyện nhóm nguồn trong cơ sở dữ liệu');
  }

  const groupName = rule.groupName || conv.contact?.fullName || `Nhóm ${rule.groupThreadId}`;
  const { periodFrom, periodTo } = computeScanWindow(rule.scanWindowType, rule.scanWindowHours);
  const { personnel } = await resolveAuditPersonnel(orgId, rule);

  const rawMessages = await prisma.message.findMany({
    where: {
      conversationId: conv.id,
      sentAt: { gte: periodFrom, lte: periodTo },
      isDeleted: false,
    },
    orderBy: { sentAt: 'asc' },
  });

  const cleaned = filterAndFormatMessages(rawMessages);
  const formattedMessages = formatTranscriptForPrompt(cleaned);
  const imageParts = await extractImagePartsFromMessages(rawMessages, 15);

  // Direct Execution Lease on ai_report_jobs
  const leaseOwner = `report-audit:${process.pid}:${randomUUID()}`;
  const leaseExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const scheduleKey = options?.scheduleKey || `${orgId}:audit_rule:${rule.id}:${Date.now()}`;
  const idempotencyKey = randomUUID();

  const job = await prisma.aiReportJob.create({
    data: {
      orgId,
      createdById: user?.id ?? null,
      idempotencyKey,
      status: 'running',
      leaseOwner,
      leaseExpiresAt,
      scheduleKey,
      startedAt: new Date(),
      requestData: {
        report_type: 'audit_rule',
        ruleId: rule.id,
        ruleName: rule.name,
        groupThreadId: rule.groupThreadId,
      },
    },
  });

  const executionGuard = async () => {
    const live = await prisma.aiReportJob.findFirst({
      where: {
        id: job.id,
        status: 'running',
        leaseOwner,
        leaseExpiresAt: { gt: new Date() },
        cancellationRequestedAt: null,
      },
    });
    if (!live) throw new ReportControlError('Audit evaluation lease lost or cancelled');
  };

  const budget = createReportJobBudget(job.id, leaseOwner, executionGuard);

  let rawAiOutput = '';
  try {
    const promptText = buildAuditPrompt({
      rule,
      groupName,
      personnel,
      formattedMessages,
      imageCount: imageParts.length,
    });
    const promptParts: ContentPart[] = [{ text: promptText }, ...imageParts];

    rawAiOutput = await generateContent(promptParts, {
      budget,
      executionGuard,
      orgId,
    });
  } catch (evalError: any) {
    await prisma.aiReportJob
      .update({
        where: { id: job.id },
        data: { status: 'failed', finishedAt: new Date(), errorMessage: evalError?.message },
      })
      .catch(() => null);
    await updateRuleRunStats(orgId, rule.id, {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: 'failed',
      lastError: evalError?.message,
    });
    throw evalError;
  }

  const { telemetry, supervisoryReportMarkdown } = parseEvaluationOutput(rawAiOutput);
  const operationalReminderMessage = buildDeterministicReminderMessage(telemetry, groupName, rule.runTime);

  // Persist GeneratedReport immediately (Schema v2 Compliance)
  const report = await prisma.generatedReport.create({
    data: {
      orgId,
      createdById: user?.id ?? null,
      title: `Đánh Giá Tuân Thủ: ${groupName} (${rule.runTime})`,
      reportType: 'audit_rule',
      periodFrom,
      periodTo,
      groupThreadIds: [rule.groupThreadId],
      sourceTargets: [
        {
          zaloAccountId: rule.zaloAccountId,
          groupThreadId: rule.groupThreadId,
          conversationId: conv.id,
        },
      ],
      targetSchemaVersion: 2,
      targetResolutionStatus: 'verified',
      summaryContent: supervisoryReportMarkdown,
      structuredData: telemetry as any,
      metadata: {
        isTestRun: !!options?.isTestRun,
        ruleId: rule.id,
        operationalReminderMessage,
      },
      sentZalo: false,
      sentEmail: false,
    },
  });

  await prisma.aiReportJob
    .update({
      where: { id: job.id },
      data: { status: 'succeeded', finishedAt: new Date(), resultReportId: report.id },
    })
    .catch(() => null);

  // Dual-Channel Dispatch with Independent Error Boundaries
  let dispatchError: string | null = null;

  // Channel 1: Supervisory Report
  try {
    if (['group', 'self', 'cloud', 'uid'].includes(rule.destinationType)) {
      const sendRes = await sendReportToZalo({
        accountId: rule.zaloAccountId,
        orgId,
        destinationType: rule.destinationType as any,
        targetThreadId: rule.targetGroupId,
        targetUid: rule.targetUid,
        markdownContent: supervisoryReportMarkdown,
        customPrefixType: 'audit',
        executionGuard: async () => {},
      });
      if (!sendRes.success) {
        dispatchError = sendRes.error || 'Lỗi gửi báo cáo giám sát vào Zalo';
      } else {
        await prisma.generatedReport.update({ where: { id: report.id }, data: { sentZalo: true } }).catch(() => null);
      }
    } else if (rule.destinationType === 'email' && rule.emailRecipients?.length) {
      const emailRes = await sendReportEmail({
        orgId,
        toEmail: rule.emailRecipients,
        reportTitle: `[Đánh Giá Tuân Thủ] ${groupName}`,
        markdownContent: supervisoryReportMarkdown,
        executionGuard: async () => {},
      });
      if (!emailRes.success) {
        dispatchError = emailRes.error || 'Lỗi gửi email báo cáo';
      } else {
        await prisma.generatedReport.update({ where: { id: report.id }, data: { sentEmail: true } }).catch(() => null);
      }
    }
  } catch (err: any) {
    dispatchError = err?.message || 'Lỗi điều phối kênh giám sát';
  }

  // Channel 2: Operational Reminder in Source Group (Independent Boundary)
  if (rule.sendOperationalReminder !== false && operationalReminderMessage) {
    try {
      await new Promise((r) => setTimeout(r, 2000));
      await sendReportToZalo({
        accountId: rule.zaloAccountId,
        orgId,
        destinationType: 'group',
        targetThreadId: rule.groupThreadId,
        markdownContent: operationalReminderMessage,
        customPrefixType: 'none',
        executionGuard: async () => {},
      });
    } catch (reminderErr: any) {
      logger.warn({ reminderErr: reminderErr?.message }, '[ai-audit-evaluator] Failed to send operational reminder');
    }
  }

  const lastRunStatus = dispatchError ? 'dispatch_failed' : 'success';
  await updateRuleRunStats(orgId, rule.id, {
    lastRunAt: new Date().toISOString(),
    lastRunStatus,
    lastRunReportId: report.id,
    lastError: dispatchError,
  });

  return {
    reportId: report.id,
    supervisoryReportMarkdown,
    operationalReminderMessage,
    lastRunStatus,
    error: dispatchError || undefined,
  };
}

// Auto-register evaluator hook for Run Now API
registerAuditRuleEvaluator(evaluateAuditRule);
