/**
 * chat-routes.ts — REST API for conversations and messages.
 * All routes require JWT auth and are scoped to the user's org.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireZaloAccess } from '../zalo/zalo-access-middleware.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';
import { emitAccountEvent } from '../../shared/realtime/socket-event-delivery.js';
import { boundedPositiveInt, boundedString } from '../../shared/http/request-bounds.js';
import { emitWebhook } from '../api/webhook-service.js';

type QueryParams = Record<string, string>;

export async function chatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // ── List conversations (paginated) ──────────────────────────────────────
  app.get('/api/v1/conversations', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { page = '1', limit = '50', search = '', accountId = '' } = request.query as QueryParams;
    const pageNum = boundedPositiveInt(page, 1, 10_000);
    const limitNum = boundedPositiveInt(limit, 50, 100);
    const safeSearch = boundedString(search, 200);
    const safeAccountId = boundedString(accountId, 128);

    const where: any = { orgId: user.orgId };
    if (safeAccountId) where.zaloAccountId = safeAccountId;
    if (safeSearch) {
      where.contact = {
        OR: [
          { fullName: { contains: safeSearch, mode: 'insensitive' } },
          { phone: { contains: safeSearch } },
        ],
      };
    }

    // Members can only see conversations from Zalo accounts they have access to
    if (user.role === 'member') {
      const accessibleAccounts = await prisma.zaloAccountAccess.findMany({
        where: { userId: user.id },
        select: { zaloAccountId: true },
      });
      const accessibleIds = accessibleAccounts.map((a) => a.zaloAccountId);
      if (safeAccountId) {
        where.zaloAccountId = accessibleIds.includes(safeAccountId) ? safeAccountId : '__none__';
      } else {
        where.zaloAccountId = { in: accessibleIds };
      }
    }

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          contact: { select: { id: true, fullName: true, phone: true, avatarUrl: true, zaloUid: true } },
          zaloAccount: { select: { id: true, displayName: true, zaloUid: true, branchTag: true, colorTag: true } },
          messages: {
            take: 1,
            orderBy: { sentAt: 'desc' },
            select: { content: true, contentType: true, senderType: true, sentAt: true, isDeleted: true },
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.conversation.count({ where }),
    ]);

    return { conversations, total, page: pageNum, limit: limitNum };
  });

  // ── Get single conversation ──────────────────────────────────────────────
  app.get('/api/v1/conversations/:id', { preHandler: requireZaloAccess('read') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        contact: true,
        zaloAccount: { select: { id: true, displayName: true, zaloUid: true, status: true, branchTag: true, colorTag: true } },
      },
    });
    if (!conversation) return reply.status(404).send({ error: 'Not found' });

    return conversation;
  });

  // ── List messages for a conversation (paginated, newest first) ──────────
  app.get('/api/v1/conversations/:id/messages', { preHandler: requireZaloAccess('read') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { page = '1', limit = '50' } = request.query as QueryParams;
    const pageNum = boundedPositiveInt(page, 1, 10_000);
    const limitNum = boundedPositiveInt(limit, 50, 100);

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: id },
        orderBy: { sentAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.message.count({ where: { conversationId: id } }),
    ]);

    return { messages: messages.reverse(), total, page: pageNum, limit: limitNum };
  });

  // ── Send message ─────────────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/messages', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { content, force } = (request.body || {}) as { content?: string; force?: boolean };

    if (!content?.trim()) return reply.status(400).send({ error: 'Content required' });

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    // Rate limit check — prevent account blocking
    const limits = zaloRateLimiter.checkLimits(conversation.zaloAccountId);
    if (!limits.allowed && !force) {
      return reply.status(429).send({ error: limits.reason, canForce: limits.canForce });
    }

    try {
      const threadId = conversation.externalThreadId || '';
      // zca-js sendMessage(message, threadId, type) — type: 0=User, 1=Group
      const threadType = conversation.threadType === 'group' ? 1 : 0;

      const res = await instance.api.sendMessage({ msg: content }, threadId, threadType);
      const rawId = (res as any)?.message?.msgId ?? (res as any)?.data?.msgId ?? (res as any)?.msgId;
      const zaloMsgId = rawId ? String(rawId) : null;
      zaloRateLimiter.recordSend(conversation.zaloAccountId, zaloMsgId, false);

      const senderName = user.fullName || 'Staff';
      let message;
      try {
        message = await prisma.message.create({
          data: {
            id: randomUUID(), conversationId: id, zaloMsgId, senderType: 'self',
            senderUid: conversation.zaloAccount.zaloUid || '', senderName, content,
            contentType: 'text', sentAt: new Date(), repliedByUserId: user.id,
          },
        });
      } catch (err: any) {
        if (err?.code === 'P2002' && zaloMsgId) {
          message = await prisma.message.update({
            where: { conversationId_zaloMsgId: { conversationId: id, zaloMsgId } },
            data: { repliedByUserId: user.id, senderName },
          });
        } else throw err;
      }

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
      });

      await emitAccountEvent(app.io, conversation.zaloAccountId, 'chat:message', { accountId: conversation.zaloAccountId, message, conversationId: id });
      emitWebhook(conversation.zaloAccount.orgId, 'message.sent', {
        messageId: message.id, conversationId: id, senderUid: conversation.zaloAccount.zaloUid || '',
        content: message.content, contentType: message.contentType, sentAt: message.sentAt,
      });

      return message;
    } catch (err) {
      logger.error('[chat] Send message error:', err);
      return reply.status(500).send({ error: 'Failed to send message' });
    }
  });

  // ── Mark conversation as read ────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/mark-read', { preHandler: requireZaloAccess('read') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    await prisma.conversation.updateMany({
      where: { id, orgId: user.orgId },
      data: { unreadCount: 0 },
    });

    return { success: true };
  });
}
