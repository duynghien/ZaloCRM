/**
 * chat-routes.ts — REST API for conversations and messages.
 * All routes require JWT auth and are scoped to the user's org.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
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
import { chatTurnDebouncer } from './copilot/chat-turn-debouncer.js';
import { getAttachmentsBaseDir, getOrgAttachmentsDir } from '../attachments/attachment-routes.js';
import { resolveByEntity } from '../notifications/notification-service.js';

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
    const { content, attachmentIds, force } = (request.body || {}) as {
      content?: string;
      attachmentIds?: string[];
      force?: boolean;
    };

    const hasText = Boolean(content && content.trim());
    const hasAttachments = Boolean(attachmentIds && attachmentIds.length > 0);

    if (!hasText && !hasAttachments) {
      return reply.status(400).send({ error: 'Nội dung tin nhắn hoặc tệp đính kèm là bắt buộc' });
    }

    if (attachmentIds && attachmentIds.length > 5) {
      return reply.status(400).send({ error: 'Chỉ được gửi tối đa 5 tệp mỗi lần' });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    // Resolve staged files if attachments are present
    const baseDir = getAttachmentsBaseDir();
    const stagedDir = path.join(baseDir, 'staged');
    const orgDir = getOrgAttachmentsDir(user.orgId);

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

        // Fallback for legacy clients passing only fileId
        if (!matched) {
          const allStaged = await fs.promises.readdir(stagedDir).catch(() => []);
          matched = allStaged.find(
            (f) => f.startsWith(`${user.orgId}-`) && (f.includes(cleanId) || f === cleanId),
          ) || null;
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

    // Rate limit check — media has higher weight (2x) to prevent account blocking
    const weight = resolvedStagedFiles.length > 0 ? resolvedStagedFiles.length * 2 : 1;
    const limits = zaloRateLimiter.checkLimits(conversation.zaloAccountId, weight);
    if (!limits.allowed && !force) {
      return reply.status(429).send({ error: limits.reason, canForce: limits.canForce });
    }

    try {
      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;

      // Atomic send to Zalo API
      let res: any;
      if (resolvedStagedFiles.length > 0) {
        res = await instance.api.sendMessage(
          {
            msg: content?.trim() || '',
            attachments: resolvedStagedFiles.map((f) => f.stagedPath),
          },
          threadId,
          threadType,
        );
      } else {
        res = await instance.api.sendMessage({ msg: content!.trim() }, threadId, threadType);
      }

      // Check for explicit Zalo error response
      if (res?.error || (typeof res?.code === 'number' && res.code !== 0)) {
        throw new Error(res.message || res.error || 'Zalo rejected message delivery');
      }

      // Move staged files to permanent org attachments folder
      const movedAttachments: Array<{
        url: string;
        filename: string;
        originalName: string;
        size: number;
        mimeType: string;
      }> = [];

      for (const file of resolvedStagedFiles) {
        const destPath = path.join(orgDir, file.filename);
        try {
          await fs.promises.rename(file.stagedPath, destPath);
        } catch {
          await fs.promises.copyFile(file.stagedPath, destPath);
          await fs.promises.unlink(file.stagedPath).catch(() => {});
        }

        movedAttachments.push({
          url: `/api/v1/attachments/${file.filename}`,
          filename: file.filename,
          originalName: file.originalName,
          size: file.size,
          mimeType: file.mimeType,
        });
      }

      // Collect all msgIds (text + all media parts) for anti-echo deduplication
      const allMsgIds: string[] = [];
      if (res?.message?.msgId) allMsgIds.push(String(res.message.msgId));
      if (Array.isArray(res?.attachment)) {
        for (const att of res.attachment) {
          if (att?.msgId) allMsgIds.push(String(att.msgId));
        }
      }
      if (res?.data?.msgId) allMsgIds.push(String(res.data.msgId));
      if (res?.msgId) allMsgIds.push(String(res.msgId));

      const primaryZaloMsgId =
        res?.message?.msgId ? String(res.message.msgId) :
        (res?.attachment && res.attachment[0]?.msgId) ? String(res.attachment[0].msgId) :
        (allMsgIds[0] || null);

      zaloRateLimiter.recordSend(
        conversation.zaloAccountId,
        allMsgIds.length > 0 ? allMsgIds : primaryZaloMsgId,
        false,
        weight,
      );

      let contentType = 'text';
      if (movedAttachments.length > 0) {
        contentType = resolvedStagedFiles.every((f) => f.fileType === 'image') ? 'image' : 'file';
      }

      const senderName = user.fullName || 'Staff';
      let message;
      try {
        message = await prisma.message.create({
          data: {
            id: randomUUID(),
            conversationId: id,
            zaloMsgId: primaryZaloMsgId,
            senderType: 'self',
            senderUid: conversation.zaloAccount.zaloUid || '',
            senderName,
            content: content?.trim() || (movedAttachments.length > 0 ? null : ''),
            contentType,
            attachments: movedAttachments,
            sentAt: new Date(),
            repliedByUserId: user.id,
          },
        });
      } catch (err: any) {
        if (err?.code === 'P2002' && primaryZaloMsgId) {
          message = await prisma.message.update({
            where: { conversationId_zaloMsgId: { conversationId: id, zaloMsgId: primaryZaloMsgId } },
            data: { repliedByUserId: user.id, senderName, attachments: movedAttachments },
          });
        } else throw err;
      }

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
      });

      void resolveByEntity(user.orgId, 'conversation', id).catch(() => {});

      chatTurnDebouncer.handleMessageTurn({
        conversationId: id,
        accountId: conversation.zaloAccountId,
        orgId: user.orgId,
        isSelf: true,
        threadType: conversation.threadType as any,
      }).catch(() => {});

      await emitAccountEvent(app.io, conversation.zaloAccountId, 'chat:message', {
        accountId: conversation.zaloAccountId,
        message,
        conversationId: id,
      });

      emitWebhook(conversation.zaloAccount.orgId, 'message.sent', {
        messageId: message.id,
        conversationId: id,
        senderUid: conversation.zaloAccount.zaloUid || '',
        content: message.content,
        contentType: message.contentType,
        sentAt: message.sentAt,
      });

      return message;
    } catch (err: any) {
      logger.error('[chat] Send message error:', err);
      return reply.status(502).send({
        error: 'Gửi tin nhắn hoặc tệp đính kèm sang Zalo thất bại',
        details: err?.message || String(err),
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
