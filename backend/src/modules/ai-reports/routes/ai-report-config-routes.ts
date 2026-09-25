/**
 * ai-report-config-routes.ts — Endpoints for Zalo group discovery and group report configurations.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { assertReportAdmission, trackReportProducer } from '../report-admission.js';
import { resolveReportTargets, authorizeReportAccount } from '../report-target-service.js';
import { ReportJobValidationError } from '../report-job-service.js';
import { isOrganizationAdministrator } from './ai-report-route-helpers.js';

interface UpsertConfigBody {
  group_name?: string;
  zalo_account_id?: string;
  is_enabled?: boolean;
  custom_prompt?: string;
  focus_keywords?: string[];
}

export async function aiReportConfigRoutes(app: FastifyInstance) {
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
    for (const accountId of new Set(groupConvs.map(c => c.zaloAccountId))) {
      if (await authorizeReportAccount(user.orgId, accountId, user, 'read')) allowedAccounts.add(accountId);
    }

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
    const allowed = await Promise.all(configs.map(async config => ({
      config,
      allowed: config.zaloAccountId ? await authorizeReportAccount(user.orgId, config.zaloAccountId, user, 'read') : isOrganizationAdministrator(user),
    })));
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
      || body.focus_keywords !== undefined && (!Array.isArray(body.focus_keywords) || body.focus_keywords.length > 100 || body.focus_keywords.some(k => typeof k !== 'string' || k.length > 200))) {
      return reply.status(400).send({ error: 'Invalid report configuration' });
    }
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
}
