/**
 * ai-report-settings-routes.ts — Endpoints for automation schedules, SMTP credentials, AI provider configuration, and AI model telemetry/testing.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { requireRole } from '../../auth/role-middleware.js';
import { encodeSecureSetting } from '../../../shared/settings/secure-setting-codec.js';
import { invalidateAppSetting } from '../../../shared/settings/app-setting-service.js';
import { assertReportAdmission } from '../report-admission.js';
import { authorizeReportAccount } from '../report-target-service.js';
import { getOrgSmtpConfig, type SmtpConfig } from '../email-service.js';
import { getOrgAutomationSettings, type AutomationSettings } from '../report-cron.js';
import {
  getOrgAiProviderSettingsDto,
  saveOrgAiProviderSettings,
  getOrgAiProviderCredentials,
} from '../ai-provider-settings-service.js';
import { GeminiProvider } from '../providers/gemini-provider.js';
import { OpenAiCompatibleProvider } from '../providers/openai-compatible-provider.js';
import { validateAiGatewayUrl } from '../ai-gateway-validator.js';
import { fetchProviderModelList } from '../ai-model-catalog-service.js';
import { recordAiUsage } from '../ai-usage-tracker.js';

interface UpdateSettingsBody {
  automation?: Partial<AutomationSettings>;
  smtp?: Partial<SmtpConfig>;
  aiProviders?: any;
}

export async function aiReportSettingsRoutes(app: FastifyInstance) {
  // ── 1. Get Automation & SMTP Settings ───────────────────────────────────────
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

  // ── 2. Update Automation & SMTP Settings ───────────────────────────────────
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
      if (merged.sendZalo && merged.zaloDestinationType === 'uid' && !merged.zaloTargetUid) {
        return reply.status(400).send({ error: 'zaloTargetUid is required' });
      }
      if (merged.sendEmail && !merged.emailRecipients.length) {
        return reply.status(400).send({ error: 'Automation email recipients are required' });
      }
      assertReportAdmission();
      if (merged.sendZalo && (!merged.senderAccountId || !await authorizeReportAccount(user.orgId, merged.senderAccountId, user, 'chat'))) {
        return reply.status(400).send({ error: 'Select an accessible Zalo sender account' });
      }

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
      invalidateAppSetting(user.orgId, 'ai_report_automation_settings');
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
      invalidateAppSetting(user.orgId, 'ai_report_smtp_config');
    }

    // Update AI Providers Settings
    if (body.aiProviders) {
      await saveOrgAiProviderSettings(user.orgId, body.aiProviders);
    }

    return { success: true };
  });

  // ── 3. Test AI Provider Connection ───────────────────────────────────────
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
      model: body.model || existingProviderCfg?.model || (body.type === 'gemini' ? 'gemini-2.5-flash' : body.type === 'deepseek' ? 'deepseek-flash' : 'gpt-4o-mini'),
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

  // ── 4. Fetch Available Models from AI Provider ───────────────────────────
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
}
