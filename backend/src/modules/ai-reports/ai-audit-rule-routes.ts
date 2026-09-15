import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireRole } from '../auth/role-middleware.js';
import {
  getAuditRules,
  getAuditRuleById,
  saveAuditRule,
  deleteAuditRule,
  AuditRuleValidationError,
  type CreateAuditRuleInput,
  type UpdateAuditRuleInput,
} from './ai-audit-rule-service.js';

// Handler hook for Run Now evaluation (injected or dynamically imported from ai-audit-evaluator)
export type AuditRuleEvaluatorFn = (
  orgId: string,
  rule: any,
  user: any,
  options?: { isTestRun?: boolean; isScheduled?: boolean; scheduleKey?: string },
) => Promise<{
  reportId?: string;
  supervisoryReportMarkdown: string;
  operationalReminderMessage?: string;
  lastRunStatus: 'success' | 'failed' | 'dispatch_failed';
  error?: string;
}>;

let auditRuleEvaluator: AuditRuleEvaluatorFn | null = null;

export function registerAuditRuleEvaluator(evaluator: AuditRuleEvaluatorFn): void {
  auditRuleEvaluator = evaluator;
}

export async function aiAuditRuleRoutes(app: FastifyInstance) {
  // ── 1. List all Audit Rules for Org ─────────────────────────────────────────
  app.get('/api/v1/ai-reports/rules', async (request: FastifyRequest) => {
    const user = request.user!;
    const rules = await getAuditRules(user.orgId);
    return { rules };
  });

  // ── 2. Create Audit Rule ────────────────────────────────────────────────────
  app.post(
    '/api/v1/ai-reports/rules',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const body = (request.body || {}) as CreateAuditRuleInput;

      try {
        const rule = await saveAuditRule(user.orgId, body, user);
        return reply.status(201).send({ rule });
      } catch (err: any) {
        if (err instanceof AuditRuleValidationError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        request.log.error(err, '[ai-audit-rule-routes] Failed to create rule');
        return reply.status(500).send({ error: 'Không thể tạo quy tắc kiểm tra' });
      }
    },
  );

  // ── 3. Update Audit Rule ────────────────────────────────────────────────────
  app.put(
    '/api/v1/ai-reports/rules/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = (request.body || {}) as UpdateAuditRuleInput;

      try {
        const rule = await saveAuditRule(user.orgId, body, user, id);
        return { rule };
      } catch (err: any) {
        if (err instanceof AuditRuleValidationError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        request.log.error(err, '[ai-audit-rule-routes] Failed to update rule');
        return reply.status(500).send({ error: 'Không thể cập nhật quy tắc kiểm tra' });
      }
    },
  );

  // ── 4. Delete Audit Rule ────────────────────────────────────────────────────
  app.delete(
    '/api/v1/ai-reports/rules/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const deleted = await deleteAuditRule(user.orgId, id);
      if (!deleted) {
        return reply.status(404).send({ error: 'Quy tắc không tồn tại' });
      }
      return { success: true };
    },
  );

  // ── 5. Run Audit Rule Now (Synchronous Test Run) ─────────────────────────────
  app.post(
    '/api/v1/ai-reports/rules/:id/run-now',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const rule = await getAuditRuleById(user.orgId, id);
      if (!rule) {
        return reply.status(404).send({ error: 'Quy tắc không tồn tại' });
      }

      if (!auditRuleEvaluator) {
        return reply.status(503).send({ error: 'Audit rule evaluator chưa được khởi tạo' });
      }

      try {
        const result = await auditRuleEvaluator(user.orgId, rule, user, { isTestRun: true });
        return {
          success: result.lastRunStatus === 'success',
          reportId: result.reportId,
          supervisoryReportMarkdown: result.supervisoryReportMarkdown,
          operationalReminderMessage: result.operationalReminderMessage,
          lastRunStatus: result.lastRunStatus,
          error: result.error,
        };
      } catch (err: any) {
        request.log.error(err, '[ai-audit-rule-routes] Run Now evaluation failed');
        return reply.status(500).send({ error: err?.message || 'Không thể thực thi kiểm tra ngay' });
      }
    },
  );
}
