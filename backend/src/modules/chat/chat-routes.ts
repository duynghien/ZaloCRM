/**
 * chat-routes.ts — REST API for conversations and messages.
 * All routes require JWT auth and are scoped to the user's org.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireZaloAccess } from '../zalo/zalo-access-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { boundedPositiveInt, boundedString } from '../../shared/http/request-bounds.js';
import { getAttachmentsBaseDir } from '../attachments/attachment-routes.js';
import { messageDeliveryService } from '../zalo/message-delivery-service.js';
import { validateIdempotencyKey } from '../../shared/http/idempotency-key.js';

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
          contact: { select: { id: true, fullName: true, phone: true, avatarUrl: true, zaloUid: true, metadata: true } },
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

    // Format preview snippet for media-only messages without caption
    for (const conv of conversations) {
      if (conv.messages.length > 0) {
        const lastMsg = conv.messages[0];
        if (!lastMsg.content || lastMsg.content.trim() === '') {
          if (lastMsg.contentType === 'image') {
            lastMsg.content = '[Hình ảnh]';
          } else if (lastMsg.contentType === 'file') {
            lastMsg.content = '[Tệp đính kèm]';
          }
        }
      }
    }

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
    const body = ((request.body as any) || {}) as Record<string, any>;
    const { content, attachmentIds } = body;

    if (body.force !== undefined && typeof body.force !== 'boolean') {
      return reply.status(400).send({ error: 'force must be boolean' });
    }
    if (body.force === true && !['owner', 'admin'].includes(user.role)) {
      return reply.status(403).send({ error: 'force requires owner or admin role' });
    }
    const force = body.force === true;

    const hasText = Boolean(content && content.trim());
    const hasAttachments = Boolean(attachmentIds && attachmentIds.length > 0);

    if (!hasText && !hasAttachments) {
      return reply.status(400).send({ error: 'Nội dung tin nhắn hoặc tệp đính kèm là bắt buộc' });
    }

    if (content && typeof content === 'string' && content.length > 10_000) {
      return reply.status(400).send({ error: 'Nội dung tin nhắn không được vượt quá 10,000 ký tự' });
    }

    if (attachmentIds && attachmentIds.length > 5) {
      return reply.status(400).send({ error: 'Chỉ được gửi tối đa 5 tệp mỗi lần' });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    // Resolve staged files if attachments are present
    const baseDir = getAttachmentsBaseDir();
    const stagedDir = path.join(baseDir, 'staged');

    const resolvedStagedFiles: Array<{
      id: string;
      filename: string;
      stagedPath: string;
      originalName: string;
      size: number;
      mimeType: string;
      fileType: 'image' | 'file';
    }> = [];

    if (hasAttachments && attachmentIds) {
      for (const attId of attachmentIds) {
        const cleanId = path.basename(attId);
        let matched: string | null = cleanId.startsWith(`${user.orgId}-`) && fs.existsSync(path.join(stagedDir, cleanId))
          ? cleanId
          : null;

        // Fallback for legacy clients passing only fileId (exact UUID)
        if (!matched) {
          const allStaged = await fs.promises.readdir(stagedDir).catch(() => []);
          const stagedFileRegex = /^([a-zA-Z0-9_-]+)-([a-f0-9-]{36})-(.+)$/;
          const isUuid = /^[a-f0-9-]{36}$/i.test(cleanId);

          matched = allStaged.find((f) => {
            if (!f.startsWith(`${user.orgId}-`)) return false;
            if (f === cleanId) return true;
            if (isUuid) {
              const match = f.match(stagedFileRegex);
              return match ? match[1] === user.orgId && match[2].toLowerCase() === cleanId.toLowerCase() : false;
            }
            return false;
          }) || null;
        }

        if (!matched) {
          return reply.status(400).send({ error: `Tệp đính kèm không tồn tại hoặc đã hết hạn: ${cleanId}` });
        }
        const stagedPath = path.join(stagedDir, matched);
        const stat = await fs.promises.stat(stagedPath).catch(() => null);
        if (!stat) {
          return reply.status(400).send({ error: `Không thể đọc tệp đính kèm: ${cleanId}` });
        }

        const ext = path.extname(matched).toLowerCase().replace(/^\./, '');
        const isImg = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
        const cleanOriginalName = matched.replace(/^[a-zA-Z0-9_-]+-[a-f0-9-]{36}-/, '');

        resolvedStagedFiles.push({
          id: cleanId,
          filename: matched,
          stagedPath,
          originalName: cleanOriginalName,
          size: stat.size,
          mimeType: isImg ? (ext === 'jpg' ? 'image/jpeg' : `image/${ext}`) : 'application/octet-stream',
          fileType: isImg ? 'image' : 'file',
        });
      }
    }

    let idempotencyKey: string;
    try {
      idempotencyKey = validateIdempotencyKey(body?.clientMessageId);
    } catch {
      return reply.status(400).send({
        error: 'clientMessageId là bắt buộc (1-256 ký tự, chỉ chứa chữ cái, số, ., _, :, -)',
      });
    }

    try {
      const result = await messageDeliveryService.sendMessage({
        orgId: user.orgId,
        zaloAccountId: conversation.zaloAccountId,
        threadId: conversation.externalThreadId || '',
        threadType: conversation.threadType as any,
        conversationId: conversation.id,
        content: content?.trim() || '',
        source: 'chat_ui',
        senderUserId: user.id,
        senderName: user.fullName || 'Staff',
        force,
        mediaFiles: resolvedStagedFiles.length > 0 ? resolvedStagedFiles : undefined,
        idempotencyKey,
      });
      return result.message;
    } catch (err: any) {
      if (err.statusCode === 429) {
        return reply.status(429).send({ error: err.message, canForce: err.canForce });
      }
      if (err.statusCode === 409) {
        return reply.status(409).send({ error: err.message, code: err.code });
      }
      if (err.statusCode && err.statusCode < 500) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      logger.error('[chat] Send message error:', err);
      return reply.status(err.statusCode || 502).send({
        error: 'Gửi tin nhắn hoặc tệp đính kèm sang Zalo thất bại',
      });
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
