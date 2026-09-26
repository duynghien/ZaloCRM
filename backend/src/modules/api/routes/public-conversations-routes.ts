/**
 * public-conversations-routes.ts — Public REST API for conversations and message history.
 * Supports pagination and backward-compatible response envelopes.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { boundedPositiveInt } from '../../../shared/http/request-bounds.js';
import { requireApiKeyScope } from '../middleware/scope-guard.js';

export async function publicConversationsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/public/conversations
  app.get(
    '/api/public/conversations',
    { preHandler: [requireApiKeyScope('conversations:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const orgId = (request as any).orgId as string;
        const { page = '1', limit = '20' } = request.query as Record<string, string>;
        const pageNum = boundedPositiveInt(page, 1, 10_000);
        const limitNum = boundedPositiveInt(limit, 20, 100);

        const [conversations, total] = await Promise.all([
          prisma.conversation.findMany({
            where: { orgId },
            select: {
              id: true, threadType: true, externalThreadId: true,
              lastMessageAt: true, unreadCount: true, isReplied: true,
              contact: { select: { id: true, fullName: true, phone: true, avatarUrl: true } },
            },
            orderBy: { lastMessageAt: 'desc' },
            skip: (pageNum - 1) * limitNum,
            take: limitNum,
          }),
          prisma.conversation.count({ where: { orgId } }),
        ]);

        const totalPages = Math.ceil(total / limitNum) || 1;
        return {
          conversations,
          data: conversations,
          pagination: { page: pageNum, limit: limitNum, total, totalPages },
        };
      } catch (err) {
        logger.error('[public-api] GET /conversations error:', err);
        return reply.status(500).send({ error: 'Failed to fetch conversations' });
      }
    }
  );

  // GET /api/public/conversations/:id/messages
  app.get(
    '/api/public/conversations/:id/messages',
    { preHandler: [requireApiKeyScope('conversations:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const orgId = (request as any).orgId as string;
        const { id } = request.params as { id: string };
        const { page = '1', limit = '50' } = request.query as Record<string, string>;
        const pageNum = boundedPositiveInt(page, 1, 10_000);
        const limitNum = boundedPositiveInt(limit, 50, 200);

        const conv = await prisma.conversation.findFirst({ where: { id, orgId }, select: { id: true } });
        if (!conv) return reply.status(404).send({ error: 'Conversation not found' });

        const where = { conversationId: id, isDeleted: false };
        const [messages, total] = await Promise.all([
          prisma.message.findMany({
            where,
            orderBy: { sentAt: 'desc' },
            skip: (pageNum - 1) * limitNum,
            take: limitNum,
            select: {
              id: true, senderType: true, senderName: true,
              content: true, contentType: true, sentAt: true, attachments: true,
            },
          }),
          prisma.message.count({ where }),
        ]);

        const totalPages = Math.ceil(total / limitNum) || 1;
        return {
          messages,
          data: messages,
          pagination: { page: pageNum, limit: limitNum, total, totalPages },
        };
      } catch (err) {
        logger.error('[public-api] GET /conversations/:id/messages error:', err);
        return reply.status(500).send({ error: 'Failed to fetch messages' });
      }
    }
  );
}
