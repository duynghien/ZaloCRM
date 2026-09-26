/**
 * conversation-tag-routes.ts — REST endpoints for Conversation Tags & Assignments.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { identifierInput, objectInput, RequestValidationError } from '../../../shared/http/request-schemas.js';
import {
  listConversationTags,
  getConversationTagById,
  createConversationTag,
  updateConversationTag,
  deleteConversationTag,
  assignTagToConversation,
  unassignTagFromConversation,
  ConversationTagConflictError,
  ConversationTagLimitError,
} from './conversation-tag-service.js';

export async function conversationTagRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/conversation-tags ─────────────────────────────────────────
  app.get('/api/v1/conversation-tags', async (request: FastifyRequest) => {
    const user = request.user!;
    const tags = await listConversationTags(user.orgId);
    return { tags };
  });

  // ── GET /api/v1/conversation-tags/:id ─────────────────────────────────────
  app.get('/api/v1/conversation-tags/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    identifierInput(id);

    const tag = await getConversationTagById(user.orgId, id);
    if (!tag) return reply.status(404).send({ error: 'Nhãn không tồn tại' });
    return tag;
  });

  // ── POST /api/v1/conversation-tags ────────────────────────────────────────
  app.post('/api/v1/conversation-tags', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const body = objectInput(request.body);

    try {
      const tag = await createConversationTag(user.orgId, {
        name: body.name as string,
        color: body.color as string,
        description: body.description as string | undefined,
      });
      return reply.status(201).send(tag);
    } catch (err: any) {
      if (err instanceof ConversationTagConflictError) {
        return reply.status(409).send({ error: err.message, code: err.code });
      }
      if (err instanceof RequestValidationError) {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }
  });

  // ── PUT /api/v1/conversation-tags/:id ─────────────────────────────────────
  app.put('/api/v1/conversation-tags/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    identifierInput(id);
    const body = objectInput(request.body);

    try {
      const updated = await updateConversationTag(user.orgId, id, {
        name: body.name as string | undefined,
        color: body.color as string | undefined,
        description: body.description as string | undefined,
      });

      if (!updated) return reply.status(404).send({ error: 'Nhãn không tồn tại' });
      return updated;
    } catch (err: any) {
      if (err instanceof ConversationTagConflictError) {
        return reply.status(409).send({ error: err.message, code: err.code });
      }
      if (err instanceof RequestValidationError) {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }
  });

  // ── DELETE /api/v1/conversation-tags/:id ──────────────────────────────────
  app.delete('/api/v1/conversation-tags/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    identifierInput(id);

    const deleted = await deleteConversationTag(user.orgId, id, app.io);
    if (!deleted) return reply.status(404).send({ error: 'Nhãn không tồn tại' });
    return { success: true };
  });

  // ── POST /api/v1/conversations/:id/tags ───────────────────────────────────
  app.post('/api/v1/conversations/:id/tags', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    identifierInput(id);
    const body = objectInput(request.body);
    const tagId = identifierInput(body.tagId as string);

    try {
      const tags = await assignTagToConversation(user.orgId, id, tagId, user.id, app.io);
      if (!tags) return reply.status(404).send({ error: 'Cuộc hội thoại không tồn tại' });
      return { tags };
    } catch (err: any) {
      if (err instanceof ConversationTagLimitError) {
        return reply.status(400).send({ error: err.message, code: err.code });
      }
      if (err instanceof RequestValidationError) {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }
  });

  // ── DELETE /api/v1/conversations/:id/tags/:tagId ──────────────────────────
  app.delete(
    '/api/v1/conversations/:id/tags/:tagId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id, tagId } = request.params as { id: string; tagId: string };
      identifierInput(id);
      identifierInput(tagId);

      const tags = await unassignTagFromConversation(user.orgId, id, tagId, app.io);
      if (!tags) return reply.status(404).send({ error: 'Cuộc hội thoại không tồn tại' });
      return { tags };
    }
  );
}
