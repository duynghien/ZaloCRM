/**
 * quick-reply-routes.ts — REST endpoints for organization QuickReply templates.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { requireRole } from '../../auth/role-middleware.js';
import { identifierInput, objectInput, RequestValidationError } from '../../../shared/http/request-schemas.js';
import {
  listQuickReplies,
  getQuickReplyById,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  QuickReplyConflictError,
} from './quick-reply-service.js';

export async function quickReplyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/quick-replies ─────────────────────────────────────────────
  app.get('/api/v1/quick-replies', async (request: FastifyRequest) => {
    const user = request.user!;
    const { category, search } = request.query as Record<string, string>;
    const list = await listQuickReplies(user.orgId, { category, search });
    return { quickReplies: list };
  });

  // ── GET /api/v1/quick-replies/:id ─────────────────────────────────────────
  app.get('/api/v1/quick-replies/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    identifierInput(id);

    const quickReply = await getQuickReplyById(user.orgId, id);
    if (!quickReply) return reply.status(404).send({ error: 'Mẫu tin nhắn không tồn tại' });
    return quickReply;
  });

  // ── POST /api/v1/quick-replies ────────────────────────────────────────────
  app.post(
    '/api/v1/quick-replies',
    { preHandler: [requireRole('owner', 'admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const body = objectInput(request.body);

      try {
        const quickReply = await createQuickReply(
          user.orgId,
          user.id,
          {
            shortcut: body.shortcut as string,
            title: body.title as string,
            content: body.content as string,
            category: body.category as string | undefined,
          },
          app.io
        );
        return reply.status(201).send(quickReply);
      } catch (err: any) {
        if (err instanceof QuickReplyConflictError) {
          return reply.status(409).send({ error: err.message, code: err.code });
        }
        if (err instanceof RequestValidationError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  // ── PUT /api/v1/quick-replies/:id ─────────────────────────────────────────
  app.put(
    '/api/v1/quick-replies/:id',
    { preHandler: [requireRole('owner', 'admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      identifierInput(id);
      const body = objectInput(request.body);

      try {
        const updated = await updateQuickReply(
          user.orgId,
          id,
          {
            shortcut: body.shortcut as string | undefined,
            title: body.title as string | undefined,
            content: body.content as string | undefined,
            category: body.category as string | undefined,
          },
          app.io
        );

        if (!updated) return reply.status(404).send({ error: 'Mẫu tin nhắn không tồn tại' });
        return updated;
      } catch (err: any) {
        if (err instanceof QuickReplyConflictError) {
          return reply.status(409).send({ error: err.message, code: err.code });
        }
        if (err instanceof RequestValidationError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  // ── DELETE /api/v1/quick-replies/:id ──────────────────────────────────────
  app.delete(
    '/api/v1/quick-replies/:id',
    { preHandler: [requireRole('owner', 'admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      identifierInput(id);

      const deleted = await deleteQuickReply(user.orgId, id, app.io);
      if (!deleted) return reply.status(404).send({ error: 'Mẫu tin nhắn không tồn tại' });
      return { success: true };
    }
  );
}
