import { validateReportHttpRequest } from './report-http-validation.js';
/**
 * ai-report-routes.ts — REST API endpoints for AI Report configuration,
 * on-demand generation, archive viewing, and multi-channel re-dispatching.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { sendReportToZalo, formatTasksForZaloMessage } from './zalo-report-sender.js';
import type { ReportActionItem } from './report-action-item-parser.js';
import { sendReportEmail, getOrgSmtpConfig, type SmtpConfig } from './email-service.js';
import { getOrgAutomationSettings, type AutomationSettings } from './report-cron.js';
import { logger } from '../../shared/utils/logger.js';
import { requireRole } from '../auth/role-middleware.js';
import { encodeSecureSetting } from '../../shared/settings/secure-setting-codec.js';
import { normalizeReportJobRequest, ReportJobValidationError, submitReportJob } from './report-job-service.js';
import { resolveReportTargets, authorizeReportTargets, authorizeReportAccount, decodeReportTargets } from './report-target-service.js';
import { assertReportAdmission, trackReportProducer } from './report-admission.js';
import { resendReport } from './report-resend-service.js';
import { boundedPositiveInt } from '../../shared/http/request-bounds.js';
import {
  getOrgAiProviderSettingsDto,
  saveOrgAiProviderSettings,
  getOrgAiProviderCredentials,
} from './ai-provider-settings-service.js';
import { GeminiProvider } from './providers/gemini-provider.js';
import { OpenAiCompatibleProvider } from './providers/openai-compatible-provider.js';
import { validateAiGatewayUrl } from './ai-gateway-validator.js';
import { fetchProviderModelList } from './ai-model-catalog-service.js';
import { recordAiUsage } from './ai-usage-tracker.js';
import { aiAuditRuleRoutes } from './ai-audit-rule-routes.js';
import './ai-audit-evaluator.js';

interface GenerateBody {
  from_date: string;
  to_date: string;
  group_thread_ids?: string[];
  title?: string;
  report_type?: 'daily' | 'weekly' | 'on_demand' | 'audit_rule';
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
  aiProviders?: any;
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

async function canAccessReport(user: CurrentUser, report: { orgId: string; sourceTargets: unknown; targetResolutionStatus: string }, permission: AccountPermission = 'read'): Promise<boolean> {
  if (report.orgId !== user.orgId) return false;
  if (report.targetResolutionStatus !== 'verified') return permission === 'read' && isOrganizationAdministrator(user);
  try { return await authorizeReportTargets(user.orgId, decodeReportTargets(report.sourceTargets), user, permission); }
  catch { return false; }
}

export async function aiReportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);
  app.addHook('preHandler', async request => validateReportHttpRequest(request));

  await app.register(aiAuditRuleRoutes);

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
    const allowedAccounts = new Set<string>();
    for (const accountId of new Set(groupConvs.map(c => c.zaloAccountId))) if (await authorizeReportAccount(user.orgId, accountId, user, 'read')) allowedAccounts.add(accountId);

    const configs = await prisma.groupReportConfig.findMany({
      where: { orgId: user.orgId },
    });

    const configMap = new Map(configs.map((c) => [JSON.stringify([c.zaloAccountId, c.groupThreadId]), c]));

    const groups = groupConvs.filter((conv) => allowedAccounts.has(conv.zaloAccountId)).map((conv) => {
      const threadId = conv.externalThreadId!;
      const config = configMap.get(JSON.stringify([conv.zaloAccountId, threadId]));

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
    const configs = await prisma.groupReportConfig.findMany({ where: { orgId: user.orgId }, orderBy: { updatedAt: 'desc' } });
    const allowed = await Promise.all(configs.map(async config => ({ config, allowed: config.zaloAccountId ? await authorizeReportAccount(user.orgId, config.zaloAccountId, user, 'read') : isOrganizationAdministrator(user) })));
    return { configs: allowed.filter(row => row.allowed).map(row => row.config) };
  });

  // ── 3. Upsert Group Report Configuration ────────────────────────────────────
  app.put('/api/v1/ai-reports/configs/:groupThreadId', async (request: FastifyRequest, reply: FastifyReply) => trackReportProducer(async () => {
    const user = request.user!;
    const { groupThreadId } = request.params as { groupThreadId: string };
    const body = (request.body || {}) as UpsertConfigBody;

    if (body.is_enabled !== undefined && typeof body.is_enabled !== 'boolean'
      || body.group_name !== undefined && (typeof body.group_name !== 'string' || body.group_name.length > 200)
      || body.custom_prompt !== undefined && (typeof body.custom_prompt !== 'string' || body.custom_prompt.length > 20_000)
      || body.focus_keywords !== undefined && (!Array.isArray(body.focus_keywords) || body.focus_keywords.length > 100 || body.focus_keywords.some(k => typeof k !== 'string' || k.length > 200))) return reply.status(400).send({ error: 'Invalid report configuration' });
    if (!groupThreadId) {
      return reply.status(400).send({ error: 'groupThreadId is required' });
    }

    assertReportAdmission();
    if (typeof body.zalo_account_id !== 'string' || !body.zalo_account_id) return reply.status(400).send({ error: 'zalo_account_id is required' });
    const [target] = await resolveReportTargets(user.orgId, { groupTargets: [{ zaloAccountId: body.zalo_account_id, groupThreadId }] }, user, 'admin');
    const zaloAccountId = target.zaloAccountId;
    const config = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`report-config:${user.orgId}:${groupThreadId}`}));`;
      assertReportAdmission();
      const unresolved = await tx.groupReportConfig.findFirst({ where: { orgId: user.orgId, groupThreadId, targetResolutionStatus: 'needs_resolution' } });
      const data = { groupName: body.group_name, customPrompt: body.custom_prompt, focusKeywords: body.focus_keywords, isEnabled: body.is_enabled, zaloAccountId, targetResolutionStatus: 'resolved' };
      if (unresolved) {
        if (!isOrganizationAdministrator(user)) throw new ReportJobValidationError('An organization administrator must resolve the legacy configuration', 403);
        return tx.groupReportConfig.update({ where: { id: unresolved.id }, data });
      }
      return tx.groupReportConfig.upsert({
        where: { orgId_zaloAccountId_groupThreadId: { orgId: user.orgId, zaloAccountId, groupThreadId } },
        create: { orgId: user.orgId, groupThreadId, ...data, isEnabled: body.is_enabled ?? true, focusKeywords: body.focus_keywords ?? [] },
        update: data,
      });
    });

    return { success: true, config };
  }));

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
    try {
      const idempotencyKey = request.headers['idempotency-key'];
      const { job, replay } = await submitReportJob(user.orgId, user.id, Array.isArray(idempotencyKey) ? idempotencyKey[0] : idempotencyKey || '', normalized);
      return reply.status(202).send({ jobId: job.id, status: job.status, replay });
    } catch (err: any) {
      if (err instanceof ReportJobValidationError) return reply.status(err.statusCode).send({ error: err.message });
      if (Number.isInteger(err?.statusCode)) return reply.status(err.statusCode).send({ error: err.message });
      logger.error('[ai-report-routes] Job enqueue failed:', err);
      return reply.status(500).send({ error: 'Unable to queue AI report' });
    }
  });

  app.get('/api/v1/ai-reports/jobs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const job = await prisma.aiReportJob.findFirst({ where: { id: (request.params as { id: string }).id, orgId: request.user!.orgId } });
    if (!job || (job.createdById !== request.user!.id && !isOrganizationAdministrator(request.user!))) return reply.status(404).send({ error: 'Job not found' });
    return { job: { id: job.id, status: job.status, errorMessage: job.errorMessage, createdAt: job.createdAt, finishedAt: job.finishedAt, cancellationRequestedAt: job.cancellationRequestedAt, resultReportId: job.resultReportId } };
  });

  app.post('/api/v1/ai-reports/jobs/:id/cancel', async (request: FastifyRequest, reply: FastifyReply) => {
    const job = await prisma.aiReportJob.findFirst({ where: { id: (request.params as { id: string }).id, orgId: request.user!.orgId } });
    if (!job || (job.createdById !== request.user!.id && !isOrganizationAdministrator(request.user!))) return reply.status(404).send({ error: 'Job not found' });
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM ai_report_jobs WHERE id=${job.id} FOR UPDATE`;
      const current = await tx.aiReportJob.findUniqueOrThrow({ where: { id: job.id } });
      if (['succeeded', 'failed', 'cancelled'].includes(current.status)) return reply.status(409).send({ error: 'Job is already finished' });
      await tx.aiReportJob.update({ where: { id: current.id }, data: { cancellationRequestedAt: new Date(), ...(current.status === 'queued' ? { status: 'cancelled', finishedAt: new Date() } : {}) } });
      return { success: true };
    });
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

    assertReportAdmission();
    const key = request.headers['idempotency-key'];
    return resendReport(user, report, body as Record<string, unknown>, typeof key === 'string' ? key : '');
  });

  // ── 8. Get Automation & SMTP Settings ───────────────────────────────────────
  app.get('/api/v1/ai-reports/settings', { preHandler: requireRole('owner', 'admin') }, async (request: FastifyRequest) => {
    const user = request.user!;

    const automation = await getOrgAutomationSettings(user.orgId);
    const smtp = await getOrgSmtpConfig(user.orgId);
    const aiProviders = await getOrgAiProviderSettingsDto(user.orgId);

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
      aiProviders,
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
      merged.emailRecipients = merged.emailRecipients.map(email => email.trim().toLowerCase());
      if (merged.sendZalo && merged.zaloDestinationType === 'uid' && !merged.zaloTargetUid) return reply.status(400).send({ error: 'zaloTargetUid is required' });
      if (merged.sendEmail && !merged.emailRecipients.length) return reply.status(400).send({ error: 'Automation email recipients are required' });
      assertReportAdmission();
      if (merged.sendZalo && (!merged.senderAccountId || !await authorizeReportAccount(user.orgId, merged.senderAccountId, user, 'chat'))) return reply.status(400).send({ error: 'Select an accessible Zalo sender account' });

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

    // Update AI Providers Settings
    if (body.aiProviders) {
      await saveOrgAiProviderSettings(user.orgId, body.aiProviders);
    }

    return { success: true };
  });

  // ── 10. Test AI Provider Connection ───────────────────────────────────────
  app.post('/api/v1/ai-reports/settings/test-ai', { preHandler: requireRole('owner', 'admin') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const body = (request.body || {}) as {
      type: 'gemini' | 'openai' | 'deepseek' | 'custom';
      apiKey?: string;
      model?: string;
      baseUrl?: string;
      supportsVision?: boolean;
    };

    if (!body.type || !['gemini', 'openai', 'deepseek', 'custom'].includes(body.type)) {
      return reply.status(400).send({ error: 'Loại AI provider không hợp lệ' });
    }

    const orgCreds = await getOrgAiProviderCredentials(user.orgId);
    const existingProviderCfg = orgCreds.providers[body.type];

    let apiKey = body.apiKey?.trim();
    if (!apiKey || apiKey.includes('••••')) {
      apiKey = existingProviderCfg?.apiKey;
    }

    // SSRF Check on baseUrl
    const baseUrl = body.baseUrl?.trim() || existingProviderCfg?.baseUrl;
    if (baseUrl) {
      if ((!body.apiKey || body.apiKey.includes('••••')) && body.baseUrl && body.baseUrl !== existingProviderCfg?.baseUrl) {
        return reply.status(400).send({ error: 'Không thể thay đổi Base URL khi đang sử dụng API Key đã lưu' });
      }
      try {
        await validateAiGatewayUrl(baseUrl);
      } catch (err: any) {
        return reply.status(400).send({ error: err.message || 'Base URL không an toàn' });
      }
    }

    if (!apiKey) {
      return reply.status(400).send({ error: `Chưa có API key cho nhà cung cấp ${body.type}` });
    }

    const providerConfig = {
      type: body.type,
      apiKey,
      model: body.model || existingProviderCfg?.model || (body.type === 'gemini' ? 'gemini-2.5-flash' : body.type === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini'),
      baseUrl,
      supportsVision: body.supportsVision ?? existingProviderCfg?.supportsVision,
    };

    const provider = body.type === 'gemini'
      ? new GeminiProvider(providerConfig)
      : new OpenAiCompatibleProvider(providerConfig);

    const testResult = await provider.testConnection();
    if (testResult.success && testResult.usage) {
      recordAiUsage({
        orgId: user.orgId,
        userId: user.id,
        taskType: 'test_connection',
        provider: body.type,
        model: providerConfig.model,
        usage: testResult.usage,
        durationMs: testResult.latencyMs,
        status: 'success',
      });
    } else if (!testResult.success) {
      recordAiUsage({
        orgId: user.orgId,
        userId: user.id,
        taskType: 'test_connection',
        provider: body.type,
        model: providerConfig.model,
        usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0 },
        durationMs: testResult.latencyMs,
        status: 'failed',
        metadata: { error: testResult.message },
      });
    }
    return testResult;
  });

  // ── 11. Fetch Available Models from AI Provider ───────────────────────────
  app.post('/api/v1/ai-reports/settings/models', { preHandler: requireRole('owner', 'admin') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const body = (request.body || {}) as {
      type: 'gemini' | 'openai' | 'deepseek' | 'custom';
      apiKey?: string;
      baseUrl?: string;
    };

    if (!body.type || !['gemini', 'openai', 'deepseek', 'custom'].includes(body.type)) {
      return reply.status(400).send({ error: 'Loại AI provider không hợp lệ' });
    }

    const orgCreds = await getOrgAiProviderCredentials(user.orgId);
    const existingProviderCfg = orgCreds.providers[body.type];

    let apiKey = body.apiKey?.trim();
    if (!apiKey || apiKey.includes('••••')) {
      apiKey = existingProviderCfg?.apiKey;
    }

    // SSRF Check on baseUrl
    const baseUrl = body.baseUrl?.trim() || existingProviderCfg?.baseUrl;
    if (baseUrl) {
      if ((!body.apiKey || body.apiKey.includes('••••')) && body.baseUrl && body.baseUrl !== existingProviderCfg?.baseUrl) {
        return reply.status(400).send({ error: 'Không thể thay đổi Base URL khi đang sử dụng API Key đã lưu' });
      }
      try {
        await validateAiGatewayUrl(baseUrl);
      } catch (err: any) {
        return reply.status(400).send({ error: err.message || 'Base URL không an toàn' });
      }
    }

    if (!apiKey) {
      return reply.status(400).send({ error: `Chưa có API key cho nhà cung cấp ${body.type}` });
    }

    try {
      const models = await fetchProviderModelList({
        type: body.type,
        apiKey,
        baseUrl,
        timeoutMs: 15_000,
      });
      return { models };
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Không thể lấy danh sách model' });
    }
  });

  // ── 9. Update task completion status (Action Item) ──────────────────────────
  app.put('/api/v1/ai-reports/:id/tasks/:taskId', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const params = request.params as { id: string; taskId: string };
    const { done } = request.body as { done: boolean };

    const report = await prisma.generatedReport.findUnique({
      where: { id: params.id },
    });

    if (!report || report.orgId !== user.orgId) {
      return reply.status(404).send({ error: 'Report not found' });
    }

    if (!(await canAccessReport(user, report, 'chat'))) {
      return reply.status(404).send({ error: 'Report not found' });
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'report-task:' + user.orgId + ':' + params.id}))`;
      const fresh = await tx.generatedReport.findUnique({
        where: { id: params.id },
        select: { structuredData: true },
      });
      if (!fresh) return null;

      const structuredData =
        typeof fresh.structuredData === 'object' && fresh.structuredData !== null
          ? ({ ...fresh.structuredData } as Record<string, any>)
          : {};

      const items: ReportActionItem[] = Array.isArray(structuredData.actionItems)
        ? [...structuredData.actionItems]
        : [];

      const taskIndex = items.findIndex((t) => t.id === params.taskId);
      if (taskIndex === -1) {
        return { notFound: true };
      }

      const updatedTask: ReportActionItem = {
        ...items[taskIndex],
        done,
        completedAt: done ? new Date().toISOString() : undefined,
      };
      items[taskIndex] = updatedTask;
      structuredData.actionItems = items;

      await tx.generatedReport.update({
        where: { id: params.id },
        data: { structuredData },
      });

      return { task: updatedTask, actionItems: items };
    });

    if (!result || (result as any).notFound) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    return { success: true, task: (result as any).task, actionItems: (result as any).actionItems };
  });

  // ── 10. Broadcast actionable tasks to verified source Zalo group ────────────
  app.post('/api/v1/ai-reports/:id/broadcast-tasks', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const params = request.params as { id: string };
    const rawIdempotencyKey = request.headers['idempotency-key'];
    const idempotencyKey = typeof rawIdempotencyKey === 'string' ? rawIdempotencyKey.trim() : '';

    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      return reply.status(400).send({ error: 'Header Idempotency-Key is required (8-128 chars)' });
    }

    const body = request.body as {
      senderAccountId: string;
      targetThreadId: string;
      selectedTaskIds?: string[];
      customHeaderNote?: string;
    };

    const report = await prisma.generatedReport.findUnique({
      where: { id: params.id },
    });

    if (!report || report.orgId !== user.orgId) {
      return reply.status(404).send({ error: 'Report not found' });
    }

    if (!(await canAccessReport(user, report, 'chat'))) {
      return reply.status(404).send({ error: 'Report not found' });
    }

    // Anti-Exfiltration Target Bounds: Ensure targetThreadId is among verified report sources
    const verifiedTargets = decodeReportTargets(report.sourceTargets);
    const targetMatch = verifiedTargets.find((t) => t.groupThreadId === body.targetThreadId);
    if (!targetMatch) {
      return reply.status(400).send({ error: 'Target thread does not belong to the verified sources of this report' });
    }

    // Permission: Verify user has chat access to the sending account
    const hasAccountAccess = await authorizeReportAccount(user.orgId, body.senderAccountId, user, 'chat');
    if (!hasAccountAccess) {
      return reply.status(403).send({ error: 'You do not have permission to send messages from this Zalo account' });
    }

    // Check existing broadcast history for idempotency replay
    const metadata =
      typeof report.metadata === 'object' && report.metadata !== null
        ? ({ ...report.metadata } as Record<string, any>)
        : {};
    const broadcastHistory: any[] = Array.isArray(metadata.broadcastHistory) ? [...metadata.broadcastHistory] : [];
    const previousBroadcast = broadcastHistory.find((h) => h.idempotencyKey === idempotencyKey);
    if (previousBroadcast) {
      return { success: true, replay: true, partsSent: previousBroadcast.partsSent, taskCount: previousBroadcast.taskCount };
    }

    const structuredData =
      typeof report.structuredData === 'object' && report.structuredData !== null
        ? (report.structuredData as Record<string, any>)
        : {};
    const allTasks: ReportActionItem[] = Array.isArray(structuredData.actionItems) ? structuredData.actionItems : [];

    let tasksToBroadcast = allTasks;
    if (body.selectedTaskIds && body.selectedTaskIds.length > 0) {
      tasksToBroadcast = allTasks.filter((t) => body.selectedTaskIds!.includes(t.id));
    }

    if (tasksToBroadcast.length === 0) {
      return reply.status(400).send({ error: 'No actionable tasks available to broadcast' });
    }

    const structured = (report.structuredData && typeof report.structuredData === 'object')
      ? (report.structuredData as Record<string, any>)
      : {};
    const digests = Array.isArray(structured?.groupDigests) ? structured.groupDigests : [];
    const groupDigest = digests.find((d: any) => d.groupThreadId === body.targetThreadId);
    const targetGroupName = groupDigest?.groupName || `Nhóm ${targetMatch.groupThreadId}`;

    const formattedMessage = formatTasksForZaloMessage(
      report.title,
      targetGroupName,
      tasksToBroadcast,
      body.customHeaderNote,
    );

    const dispatchResult = await sendReportToZalo({
      accountId: body.senderAccountId,
      orgId: user.orgId,
      destinationType: 'group',
      targetThreadId: body.targetThreadId,
      markdownContent: formattedMessage,
      customPrefixType: 'none',
      executionGuard: async () => {
        const acc = await prisma.zaloAccount.findFirst({
          where: { id: body.senderAccountId, orgId: user.orgId, status: 'connected' },
          select: { id: true },
        });
        if (!acc) throw new Error('report_sender_unavailable');
      },
    });

    if (!dispatchResult.success) {
      return reply.status(502).send({ error: dispatchResult.error || 'Failed to dispatch tasks to Zalo group' });
    }

    // Persist to broadcastHistory
    broadcastHistory.push({
      idempotencyKey,
      sentAt: new Date().toISOString(),
      sentByUserId: user.id,
      targetThreadId: body.targetThreadId,
      taskCount: tasksToBroadcast.length,
      partsSent: dispatchResult.partsSent,
    });
    metadata.broadcastHistory = broadcastHistory;

    await prisma.generatedReport.update({
      where: { id: params.id },
      data: { metadata },
    });

    return { success: true, partsSent: dispatchResult.partsSent, taskCount: tasksToBroadcast.length };
  });
}
