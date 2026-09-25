import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireRole } from '../../auth/role-middleware.js';
import {
  listKnowledgeRules,
  createKnowledgeRule,
  updateKnowledgeRule,
  deleteKnowledgeRule,
  toggleKnowledgeRule,
  getDistinctBranchTags,
  KnowledgeValidationError,
  type ListKnowledgeRulesFilter,
  type CreateKnowledgeRuleInput,
  type UpdateKnowledgeRuleInput,
} from './ai-knowledge-service.js';

export async function aiKnowledgeRoutes(app: FastifyInstance) {
  // ── 1. List Knowledge Rules ──────────────────────────────────────────────────
  app.get(
    '/api/v1/ai-reports/knowledge-rules',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const query = (request.query || {}) as any;

      const filter: ListKnowledgeRulesFilter = {};
      if (query.scope) filter.scope = query.scope;
      if (query.branchTag) filter.branchTag = query.branchTag;
      if (query.groupThreadId) filter.groupThreadId = query.groupThreadId;
      if (query.category) filter.category = query.category;
      if (query.isActive !== undefined) {
        filter.isActive = query.isActive === 'true' || query.isActive === true;
      }
      if (query.search) filter.search = query.search;

      try {
        const rules = await listKnowledgeRules(user.orgId, filter);
        return reply.send({ rules });
      } catch (err: any) {
        request.log.error(err, '[ai-knowledge-routes] Failed to list rules');
        return reply.status(500).send({ error: 'Không thể tải danh sách quy tắc tri thức' });
      }
    },
  );

  // ── 2. Create Knowledge Rule ────────────────────────────────────────────────
  app.post(
    '/api/v1/ai-reports/knowledge-rules',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const body = (request.body || {}) as CreateKnowledgeRuleInput;

      try {
        const rule = await createKnowledgeRule(user.orgId, user.id, body);
        return reply.status(201).send({ rule });
      } catch (err: any) {
        if (err instanceof KnowledgeValidationError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        request.log.error(err, '[ai-knowledge-routes] Failed to create rule');
        return reply.status(500).send({ error: 'Không thể tạo quy tắc tri thức' });
      }
    },
  );

  // ── 3. Update Knowledge Rule ────────────────────────────────────────────────
  app.put(
    '/api/v1/ai-reports/knowledge-rules/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = (request.body || {}) as UpdateKnowledgeRuleInput;

      try {
        const rule = await updateKnowledgeRule(user.orgId, id, body);
        return reply.send({ rule });
      } catch (err: any) {
        if (err instanceof KnowledgeValidationError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        request.log.error(err, '[ai-knowledge-routes] Failed to update rule');
        return reply.status(500).send({ error: 'Không thể cập nhật quy tắc tri thức' });
      }
    },
  );

  // ── 4. Delete Knowledge Rule ────────────────────────────────────────────────
  app.delete(
    '/api/v1/ai-reports/knowledge-rules/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      try {
        const result = await deleteKnowledgeRule(user.orgId, id);
        return reply.send(result);
      } catch (err: any) {
        if (err instanceof KnowledgeValidationError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        request.log.error(err, '[ai-knowledge-routes] Failed to delete rule');
        return reply.status(500).send({ error: 'Không thể xóa quy tắc tri thức' });
      }
    },
  );

  // ── 5. Toggle Knowledge Rule ────────────────────────────────────────────────
  app.patch(
    '/api/v1/ai-reports/knowledge-rules/:id/toggle',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { isActive } = (request.body || {}) as { isActive?: boolean };

      if (typeof isActive !== 'boolean') {
        return reply.status(400).send({ error: 'Trường isActive phải là boolean' });
      }

      try {
        const rule = await toggleKnowledgeRule(user.orgId, id, isActive);
        return reply.send({ rule });
      } catch (err: any) {
        if (err instanceof KnowledgeValidationError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        request.log.error(err, '[ai-knowledge-routes] Failed to toggle rule');
        return reply.status(500).send({ error: 'Không thể thay đổi trạng thái quy tắc' });
      }
    },
  );

  // ── 6. Get Available Branches ───────────────────────────────────────────────
  app.get(
    '/api/v1/ai-reports/knowledge-branches',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;

      try {
        const branches = await getDistinctBranchTags(user.orgId);
        return reply.send({ branches });
      } catch (err: any) {
        request.log.error(err, '[ai-knowledge-routes] Failed to get branches');
        return reply.status(500).send({ error: 'Không thể tải danh sách chi nhánh' });
      }
    },
  );
}
