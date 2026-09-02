/**
 * ai-report-routes.ts — REST API endpoints for AI Report configuration,
 * on-demand generation, archive viewing, and multi-channel re-dispatching.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { sendReportToZalo } from './zalo-report-sender.js';
import { sendReportEmail, getOrgSmtpConfig, type SmtpConfig } from './email-service.js';
import { getOrgAutomationSettings, type AutomationSettings } from './report-cron.js';
import { logger } from '../../shared/utils/logger.js';
import { requireRole } from '../auth/role-middleware.js';
import { encodeSecureSetting } from '../../shared/settings/secure-setting-codec.js';
import { normalizeReportJobRequest, ReportJobValidationError, submitReportJob } from './report-job-service.js';
import { boundedPositiveInt } from '../../shared/http/request-bounds.js';

interface GenerateBody {
  from_date: string;
  to_date: string;
  group_thread_ids?: string[];
  title?: string;
  report_type?: 'daily' | 'weekly' | 'on_demand';
  send_zalo?: boolean;
  send_email?: boolean;
  zalo_destination_type?: 'self' | 'cloud' | 'uid';
  zalo_target_uid?: string;
  email_recipients?: string[];
}

interface ResendBody {
  send_zalo?: boolean;
  send_email?: boolean;
  zalo_destination_type?: 'self' | 'cloud' | 'uid';
  zalo_target_uid?: string;
  email_recipients?: string[];
}

interface UpsertConfigBody {
  group_name?: string;
  zalo_account_id?: string;
  is_enabled?: boolean;
  custom_prompt?: string;
  focus_keywords?: string[];
}

interface UpdateSettingsBody {
  automation?: Partial<AutomationSettings>;
  smtp?: Partial<SmtpConfig>;
}

type CurrentUser = NonNullable<FastifyRequest['user']>;
type AccountPermission = 'read' | 'chat' | 'admin';

const accountPermissionRank: Record<AccountPermission, number> = {
  read: 1,
  chat: 2,
  admin: 3,
};

function isOrganizationAdministrator(user: CurrentUser): boolean {
  return user.role === 'owner' || user.role === 'admin';
}

function groupThreadIdsFromReport(report: { groupThreadIds: unknown }): string[] {
  if (!Array.isArray(report.groupThreadIds)) return [];
  return report.groupThreadIds.filter((value): value is string => typeof value === 'string');
}

/**
 * A group-thread id is only safe for a member when every matching group
 * conversation belongs to an account explicitly assigned to that member.
 * Treating ambiguous/reused external thread ids as inaccessible avoids using a
 * report config or archive entry to cross an account boundary.
 */
async function accessibleGroupThreadIds(
  user: CurrentUser,
  requestedIds?: string[],
  requiredPermission: AccountPermission = 'read',
) {
  const requested = requestedIds && requestedIds.length > 0 ? [...new Set(requestedIds)] : undefined;
  const conversations = await prisma.conversation.findMany({
    where: {
      orgId: user.orgId,
      threadType: 'group',
      externalThreadId: requested ? { in: requested } : { not: null },
    },
    select: { externalThreadId: true, zaloAccountId: true },
  });

  const accountsByThread = new Map<string, Set<string>>();
  for (const conversation of conversations) {
    if (!conversation.externalThreadId) continue;
    const accountIds = accountsByThread.get(conversation.externalThreadId) ?? new Set<string>();
    if (conversation.zaloAccountId) {
      accountIds.add(conversation.zaloAccountId);
    }
    accountsByThread.set(conversation.externalThreadId, accountIds);
  }

  if (isOrganizationAdministrator(user)) {
    return {
      allowed: requested ? requested.every((id) => accountsByThread.has(id)) : true,
      ids: requested ?? [...accountsByThread.keys()],
      accountsByThread,
    };
  }

  const grants = await prisma.zaloAccountAccess.findMany({
    where: { userId: user.id },
    select: { zaloAccountId: true, permission: true },
  });
  const permissionByAccountId = new Map(grants.map((grant) => [grant.zaloAccountId, grant.permission]));
  const ids = [...accountsByThread.entries()]
    .filter(([, accountIds]) => accountIds.size > 0 && [...accountIds].every((id) => {
      const permission = permissionByAccountId.get(id) as AccountPermission | undefined;
      return permission !== undefined && accountPermissionRank[permission] >= accountPermissionRank[requiredPermission];
    }))
    .map(([threadId]) => threadId);
  const allowedIds = new Set(ids);

  return {
    allowed: requested ? requested.every((id) => allowedIds.has(id)) : true,
    ids,
    accountsByThread,
  };
}

async function canAccessReport(
  user: CurrentUser,
  report: { groupThreadIds: unknown },
  requiredPermission: AccountPermission = 'read',
): Promise<boolean> {
  if (isOrganizationAdministrator(user)) return true;
  const groupThreadIds = groupThreadIdsFromReport(report);
  if (groupThreadIds.length === 0) return false;
  const access = await accessibleGroupThreadIds(user, groupThreadIds, requiredPermission);
  return access.allowed;
}

export async function aiReportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // ── 1. List all Zalo groups with their monitoring config status ──────────────
  app.get('/api/v1/ai-reports/groups', async (request: FastifyRequest) => {
    const user = request.user!;

    // Find all group conversations in org
    const groupConvs = await prisma.conversation.findMany({
      where: {
        orgId: user.orgId,
        threadType: 'group',
        externalThreadId: { not: null },
      },
      include: {
        contact: { select: { fullName: true, avatarUrl: true } },
        zaloAccount: { select: { id: true, displayName: true, zaloUid: true } },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
    const groupAccess = await accessibleGroupThreadIds(user);
    const accessibleGroupThreadIdSet = new Set(groupAccess.ids);

    const configs = await prisma.groupReportConfig.findMany({
      where: { orgId: user.orgId },
    });

    const configMap = new Map(configs.map((c) => [c.groupThreadId, c]));

    const groups = groupConvs.filter((conv) => accessibleGroupThreadIdSet.has(conv.externalThreadId!)).map((conv) => {
      const threadId = conv.externalThreadId!;
      const config = configMap.get(threadId);

      return {
        threadId,
        conversationId: conv.id,
        groupName: config?.groupName || conv.contact?.fullName || `Nhóm ${threadId}`,
        avatarUrl: conv.contact?.avatarUrl || null,
        zaloAccount: conv.zaloAccount,
        lastMessageAt: conv.lastMessageAt,
        unreadCount: conv.unreadCount,
        isConfigured: !!config,
        isEnabled: config ? config.isEnabled : true,
        customPrompt: config?.customPrompt || '',
        focusKeywords: Array.isArray(config?.focusKeywords) ? config.focusKeywords : [],
      };
    });

    return { groups };
  });

  // ── 2. List all Group Report Configurations ─────────────────────────────────
  app.get('/api/v1/ai-reports/configs', async (request: FastifyRequest) => {
    const user = request.user!;
    const [configs, groupAccess] = await Promise.all([
      prisma.groupReportConfig.findMany({
        where: { orgId: user.orgId },
        orderBy: { updatedAt: 'desc' },
      }),
      accessibleGroupThreadIds(user),
    ]);
    const accessibleGroupThreadIdSet = new Set(groupAccess.ids);
    return { configs: configs.filter((config) => accessibleGroupThreadIdSet.has(config.groupThreadId)) };
  });

  // ── 3. Upsert Group Report Configuration ────────────────────────────────────
  app.put('/api/v1/ai-reports/configs/:groupThreadId', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { groupThreadId } = request.params as { groupThreadId: string };
    const body = (request.body || {}) as UpsertConfigBody;

    if (!groupThreadId) {
      return reply.status(400).send({ error: 'groupThreadId is required' });
    }

    const groupAccess = await accessibleGroupThreadIds(user, [groupThreadId], 'admin');
    if (!groupAccess.allowed) {
      return reply.status(404).send({ error: 'Group not found' });
    }

    const groupAccountIds = groupAccess.accountsByThread.get(groupThreadId)!;
    const selectedZaloAccountId = body.zalo_account_id;
    if (selectedZaloAccountId && !groupAccountIds.has(selectedZaloAccountId)) {
      return reply.status(400).send({ error: 'zalo_account_id does not own this group' });
    }
    if (!selectedZaloAccountId && groupAccountIds.size !== 1) {
      return reply.status(400).send({ error: 'zalo_account_id is required for an ambiguous group thread' });
    }
    const zaloAccountId = selectedZaloAccountId ?? [...groupAccountIds][0];

    const config = await prisma.groupReportConfig.upsert({
      where: {
        orgId_groupThreadId: {
          orgId: user.orgId,
          groupThreadId,
        },
      },
      create: {
        orgId: user.orgId,
        groupThreadId,
        groupName: body.group_name || null,
        zaloAccountId,
        isEnabled: body.is_enabled ?? true,
        customPrompt: body.custom_prompt || null,
        focusKeywords: body.focus_keywords ?? [],
      },
      update: {
        groupName: body.group_name !== undefined ? body.group_name : undefined,
        zaloAccountId,
        isEnabled: body.is_enabled !== undefined ? body.is_enabled : undefined,
        customPrompt: body.custom_prompt !== undefined ? body.custom_prompt : undefined,
        focusKeywords: body.focus_keywords !== undefined ? body.focus_keywords : undefined,
      },
    });

    return { success: true, config };
  });

  // ── 4. Queue AI Report On-Demand ─────────────────────────────────────────────
  app.post('/api/v1/ai-reports/generate', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const body = (request.body || {}) as Record<string, unknown>;
    let normalized;
    try {
      normalized = normalizeReportJobRequest(body);
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid report request' });
    }
    const requiredPermission: AccountPermission = normalized.sendZalo || normalized.sendEmail ? 'chat' : 'read';
    const groupAccess = await accessibleGroupThreadIds(user, normalized.groupThreadIds, requiredPermission);
    if (!groupAccess.allowed) {
      return reply.status(404).send({ error: 'One or more groups were not found' });
    }
    try {
      const idempotencyKey = request.headers['idempotency-key'];
      const { job, replay } = await submitReportJob(user.orgId, user.id, Array.isArray(idempotencyKey) ? idempotencyKey[0] : idempotencyKey || '', normalized);
      return reply.status(202).send({ jobId: job.id, status: job.status, replay });
    } catch (err: any) {
      if (err instanceof ReportJobValidationError) return reply.status(400).send({ error: err.message });
      logger.error('[ai-report-routes] Job enqueue failed:', err);
      return reply.status(500).send({ error: 'Unable to queue AI report' });
    }
  });

  app.get('/api/v1/ai-reports/jobs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const job = await prisma.aiReportJob.findFirst({ where: { id: (request.params as { id: string }).id, orgId: request.user!.orgId } });
    if (!job || (job.createdById !== request.user!.id && !isOrganizationAdministrator(request.user!))) return reply.status(404).send({ error: 'Job not found' });
    return { job };
  });

  app.post('/api/v1/ai-reports/jobs/:id/cancel', async (request: FastifyRequest, reply: FastifyReply) => {
    const job = await prisma.aiReportJob.findFirst({ where: { id: (request.params as { id: string }).id, orgId: request.user!.orgId } });
    if (!job || (job.createdById !== request.user!.id && !isOrganizationAdministrator(request.user!))) return reply.status(404).send({ error: 'Job not found' });
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return reply.status(409).send({ error: 'Job is already finished' });
    await prisma.aiReportJob.update({ where: { id: job.id }, data: { cancellationRequestedAt: new Date(), status: job.status === 'queued' ? 'cancelled' : job.status, finishedAt: job.status === 'queued' ? new Date() : undefined } });
    return { success: true };
  });

  // ── 5. List Generated Reports Archive (paginated) ───────────────────────────
  app.get('/api/v1/ai-reports', async (request: FastifyRequest) => {
    const user = request.user!;
    const {
      page = '1',
      limit = '20',
      report_type,
    } = request.query as { page?: string; limit?: string; report_type?: string };

    const where: any = { orgId: user.orgId };
    if (report_type) {
      where.reportType = report_type;
    }

    const pageNum = boundedPositiveInt(page, 1, 10_000);
    const limitNum = boundedPositiveInt(limit, 20, 100);

    const [allReports, total] = await Promise.all([
      prisma.generatedReport.findMany({
        where,
        include: {
          createdBy: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.generatedReport.count({ where }),
    ]);

    const allowedReports = isOrganizationAdministrator(user)
      ? allReports
      : (await Promise.all(allReports.map(async (report) => ({ report, allowed: await canAccessReport(user, report) }))))
        .filter(({ allowed }) => allowed)
        .map(({ report }) => report);
    const reports = allowedReports.slice((pageNum - 1) * limitNum, pageNum * limitNum);
    const accessibleTotal = isOrganizationAdministrator(user) ? total : allowedReports.length;

    return {
      reports,
      total: accessibleTotal,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(accessibleTotal / limitNum),
    };
  });

  // ── 6. Get Report Details ───────────────────────────────────────────────────
  app.get('/api/v1/ai-reports/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const report = await prisma.generatedReport.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (!report) {
      return reply.status(404).send({ error: 'Report not found' });
    }
    if (!(await canAccessReport(user, report))) {
      return reply.status(404).send({ error: 'Report not found' });
    }

    return { report };
  });

  // ── 7. Resend Report to Zalo or Email ───────────────────────────────────────
  app.post('/api/v1/ai-reports/:id/resend', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as ResendBody;

    const report = await prisma.generatedReport.findFirst({
      where: { id, orgId: user.orgId },
    });

    if (!report) {
      return reply.status(404).send({ error: 'Report not found' });
    }
    if (!(await canAccessReport(user, report, 'chat'))) {
      return reply.status(404).send({ error: 'Report not found' });
    }

    let sentZalo = report.sentZalo;
    let sentEmail = report.sentEmail;
    let zaloResult: any = null;
    let emailResult: any = null;

    if (body.send_zalo) {
      const destType = body.zalo_destination_type || 'self';
      zaloResult = await sendReportToZalo({
        orgId: user.orgId,
        destinationType: destType,
        targetUid: body.zalo_target_uid,
        markdownContent: report.summaryContent,
        reportTitle: report.title,
      });
      if (zaloResult.success) sentZalo = true;
    }

    if (body.send_email) {
      const recipients =
        body.email_recipients && body.email_recipients.length > 0
          ? body.email_recipients
          : [user.email];

      emailResult = await sendReportEmail({
        orgId: user.orgId,
        toEmail: recipients,
        reportTitle: report.title,
        markdownContent: report.summaryContent,
        periodText: `Thời gian: ${report.periodFrom.toLocaleDateString('vi-VN')} - ${report.periodTo.toLocaleDateString('vi-VN')}`,
      });
      if (emailResult.success) sentEmail = true;
    }

    await prisma.generatedReport.update({
      where: { id },
      data: { sentZalo, sentEmail },
    });

    return {
      success: true,
      zalo: zaloResult,
      email: emailResult,
    };
  });

  // ── 8. Get Automation & SMTP Settings ───────────────────────────────────────
  app.get('/api/v1/ai-reports/settings', { preHandler: requireRole('owner', 'admin') }, async (request: FastifyRequest) => {
    const user = request.user!;

    const automation = await getOrgAutomationSettings(user.orgId);
    const smtp = await getOrgSmtpConfig(user.orgId);

    // Mask SMTP password for security
    const maskedSmtp = smtp
      ? {
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          user: smtp.auth.user,
          passSet: Boolean(smtp.auth.pass),
          from: smtp.from,
        }
      : null;

    return {
      automation,
      smtp: maskedSmtp,
    };
  });

  // ── 9. Update Automation & SMTP Settings ───────────────────────────────────
  app.put('/api/v1/ai-reports/settings', { preHandler: requireRole('owner', 'admin') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const body = (request.body || {}) as UpdateSettingsBody;

    // Update Automation Settings
    if (body.automation) {
      if ('dailyCronTime' in body.automation || 'weeklyCronTime' in body.automation) {
        return reply.status(400).send({ error: 'Automation schedules are fixed at 18:00 daily and 17:00 Saturday' });
      }
      const current = await getOrgAutomationSettings(user.orgId);
      const merged = { ...current, ...body.automation };

      await prisma.appSetting.upsert({
        where: {
          orgId_settingKey: {
            orgId: user.orgId,
            settingKey: 'ai_report_automation_settings',
          },
        },
        create: {
          orgId: user.orgId,
          settingKey: 'ai_report_automation_settings',
          valuePlain: JSON.stringify(merged),
        },
        update: {
          valuePlain: JSON.stringify(merged),
        },
      });
    }

    // Update SMTP Settings
    if (body.smtp) {
      // The established SPA DTO is flat (`smtp.user`/`smtp.pass`); accept the
      // nested service shape too so existing clients keep working.
      const smtpInput = body.smtp as Partial<SmtpConfig> & { user?: string; pass?: string };
      const existing = await getOrgSmtpConfig(user.orgId);
      const host = smtpInput.host || existing?.host || '';
      const port = smtpInput.port || existing?.port || 587;
      const secure = smtpInput.secure ?? existing?.secure ?? false;
      const userStr = smtpInput.auth?.user ?? smtpInput.user ?? existing?.auth?.user ?? '';
      const passStr = smtpInput.auth?.pass ?? smtpInput.pass ?? existing?.auth?.pass ?? '';
      const from = smtpInput.from || existing?.from || '';

      const updatedSmtp: SmtpConfig = {
        host,
        port,
        secure,
        auth: {
          user: userStr,
          pass: passStr,
        },
        from,
      };

      await prisma.appSetting.upsert({
        where: {
          orgId_settingKey: {
            orgId: user.orgId,
            settingKey: 'ai_report_smtp_config',
          },
        },
        create: {
          orgId: user.orgId,
          settingKey: 'ai_report_smtp_config',
          ...encodeSecureSetting(JSON.stringify(updatedSmtp)),
        },
        update: {
          ...encodeSecureSetting(JSON.stringify(updatedSmtp)),
        },
      });
    }

    return { success: true };
  });
}
