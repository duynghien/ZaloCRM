import type { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { zaloPool } from './zalo-pool.js';
import { zaloRateLimiter } from './zalo-rate-limiter.js';
import { emitAccountEvent } from '../../shared/realtime/socket-event-delivery.js';
import { emitWebhook } from '../api/webhook-service.js';
import { chatTurnDebouncer } from '../chat/copilot/chat-turn-debouncer.js';
import { resolveByEntity } from '../notifications/notification-service.js';
import { logger } from '../../shared/utils/logger.js';

export interface SendMessageParams {
  orgId: string;
  zaloAccountId: string;
  threadId: string;
  threadType?: 'user' | 'group' | number;
  content: string;
  source: 'chat_ui' | 'public_api' | 'ai_copilot';
  senderUserId?: string;
  senderName?: string;
  force?: boolean;
}

export interface DeliveryResult {
  message: any;
  conversationId: string;
  zaloMsgId: string | null;
}

export class MessageDeliveryService {
  private io: Server | null = null;

  setIO(io: Server): void {
    this.io = io;
  }

  getIO(): Server | null {
    return this.io || zaloPool.getIO();
  }

  async sendText(params: SendMessageParams): Promise<DeliveryResult> {
    if (!params.content || !params.content.trim()) {
      throw Object.assign(new Error('Nội dung tin nhắn là bắt buộc'), { statusCode: 400 });
    }

    if (!params.zaloAccountId || !params.threadId) {
      throw Object.assign(new Error('zaloAccountId và threadId là bắt buộc'), { statusCode: 400 });
    }

    // 1. Verify account connected & belongs to org
    const account = await prisma.zaloAccount.findFirst({
      where: { id: params.zaloAccountId, orgId: params.orgId },
      select: { id: true, orgId: true, status: true, zaloUid: true },
    });
    if (!account) {
      throw Object.assign(new Error('Zalo account not found'), { statusCode: 404 });
    }
    if (account.status !== 'connected') {
      throw Object.assign(new Error('Zalo account is not connected'), { statusCode: 422 });
    }

    const instance = zaloPool.getInstance(params.zaloAccountId);
    if (!instance?.api) {
      throw Object.assign(new Error('Zalo account not active in pool'), { statusCode: 422 });
    }

    const normalizedThreadType: 'user' | 'group' =
      (params.threadType === 'group' || params.threadType === 1) ? 'group' : 'user';
    const zcaThreadType = normalizedThreadType === 'group' ? 1 : 0;

    // 2. Resolve or upsert Conversation record before remote send
    let conversation = await prisma.conversation.findFirst({
      where: {
        zaloAccountId: params.zaloAccountId,
        externalThreadId: params.threadId,
        orgId: params.orgId,
      },
      include: { zaloAccount: true },
    });

    if (!conversation) {
      let contact = await prisma.contact.findFirst({
        where: { zaloUid: params.threadId, orgId: params.orgId },
        select: { id: true },
      });
      if (!contact) {
        contact = await prisma.contact.create({
          data: {
            id: randomUUID(),
            orgId: params.orgId,
            zaloUid: params.threadId,
            fullName: normalizedThreadType === 'group' ? 'Nhóm' : 'Khách Zalo',
            metadata: normalizedThreadType === 'group' ? { isGroup: true } : undefined,
          },
          select: { id: true },
        });
      }

      conversation = await prisma.conversation.upsert({
        where: {
          zaloAccountId_externalThreadId: {
            zaloAccountId: params.zaloAccountId,
            externalThreadId: params.threadId,
          },
        },
        create: {
          id: randomUUID(),
          orgId: params.orgId,
          zaloAccountId: params.zaloAccountId,
          contactId: contact.id,
          threadType: normalizedThreadType,
          externalThreadId: params.threadId,
          lastMessageAt: new Date(),
          unreadCount: 0,
          isReplied: true,
        },
        update: {},
        include: { zaloAccount: true },
      });
    }

    // 3. Check rate limits via zaloRateLimiter
    const weight = 1;
    const limits = zaloRateLimiter.checkLimits(params.zaloAccountId, weight);
    if (!limits.allowed && !params.force) {
      throw Object.assign(new Error(limits.reason || 'Zalo rate limit exceeded'), {
        statusCode: 429,
        canForce: limits.canForce,
      });
    }

    // 4. Send message via Zalo API
    const content = params.content.trim();
    let res: any;
    try {
      res = await instance.api.sendMessage(
        { msg: content },
        params.threadId,
        zcaThreadType,
      );
    } catch (sendErr: any) {
      logger.error(`[message-delivery] Send error to thread ${params.threadId}:`, sendErr);
      throw Object.assign(
        new Error(`Failed to send message to Zalo: ${sendErr?.message || sendErr}`),
        { statusCode: 502 },
      );
    }

    if (res?.error || (typeof res?.code === 'number' && res.code !== 0)) {
      throw Object.assign(
        new Error(res.message || res.error || 'Zalo rejected message delivery'),
        { statusCode: 502 },
      );
    }

    // 5. Register anti-echo tracking
    const allMsgIds: string[] = [];
    if (res?.message?.msgId) allMsgIds.push(String(res.message.msgId));
    if (res?.data?.msgId) allMsgIds.push(String(res.data.msgId));
    if (res?.msgId) allMsgIds.push(String(res.msgId));
    const primaryZaloMsgId = allMsgIds[0] || null;

    zaloRateLimiter.recordSend(
      params.zaloAccountId,
      allMsgIds.length > 0 ? allMsgIds : primaryZaloMsgId,
      false,
      weight,
    );

    // 6. Persist message in Prisma (linked to resolved conversationId)
    const senderName = params.senderName || (params.source === 'public_api' ? 'API' : (params.source === 'ai_copilot' ? 'AI Copilot' : 'Staff'));
    const sentAt = new Date();
    let message;
    try {
      message = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: conversation.id,
          zaloMsgId: primaryZaloMsgId,
          senderType: 'self',
          senderUid: account.zaloUid || '',
          senderName,
          content,
          contentType: 'text',
          attachments: [],
          sentAt,
          repliedByUserId: params.senderUserId || null,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002' && primaryZaloMsgId) {
        message = await prisma.message.update({
          where: {
            conversationId_zaloMsgId: {
              conversationId: conversation.id,
              zaloMsgId: primaryZaloMsgId,
            },
          },
          data: {
            repliedByUserId: params.senderUserId || null,
            senderName,
          },
        });
      } else {
        throw err;
      }
    }

    // 7. Update conversation (lastMessageAt, isReplied, unreadCount)
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: sentAt, isReplied: true, unreadCount: 0 },
    });

    // 8. Emit Socket.IO event 'chat:message' (matching use-chat.ts:244)
    const io = this.getIO();
    if (io) {
      await emitAccountEvent(io, params.zaloAccountId, 'chat:message', {
        accountId: params.zaloAccountId,
        message,
        conversationId: conversation.id,
      });
    }

    // 9. Side-effects: notifications, copilot turn, webhook
    void resolveByEntity(params.orgId, 'conversation', conversation.id).catch(() => {});

    chatTurnDebouncer.handleMessageTurn({
      conversationId: conversation.id,
      accountId: params.zaloAccountId,
      orgId: params.orgId,
      isSelf: true,
      threadType: conversation.threadType as any,
    }).catch(() => {});

    emitWebhook(params.orgId, 'message.sent', {
      messageId: message.id,
      conversationId: conversation.id,
      senderUid: account.zaloUid || '',
      content: message.content,
      contentType: message.contentType,
      sentAt: message.sentAt,
    });

    return {
      message,
      conversationId: conversation.id,
      zaloMsgId: primaryZaloMsgId,
    };
  }
}

export const messageDeliveryService = new MessageDeliveryService();
