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
import {
  claimOutboxSlot,
  commitOutboxSuccess,
  commitOutboxUncertain,
  commitOutboxFailedBeforeDispatch,
  type StagedMediaFile,
} from './zalo-outbound-outbox.js';
import { resolveOrCreateDeliveryConversation } from './delivery-conversation-resolver.js';
import { moveStagedMediaToPermanentStorage } from './delivery-media-stager.js';

export type { StagedMediaFile };

export interface SendMessageParams {
  orgId: string;
  zaloAccountId: string;
  threadId: string;
  threadType?: 'user' | 'group' | number;
  conversationId?: string;
  content?: string;
  source: 'chat_ui' | 'public_api' | 'ai_copilot';
  senderUserId?: string;
  senderName?: string;
  force?: boolean;
  mediaFiles?: StagedMediaFile[];
  idempotencyKey?: string;
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
    return this.sendMessage(params);
  }

  async sendMessage(params: SendMessageParams): Promise<DeliveryResult> {
    const hasContent = Boolean(params.content && params.content.trim());
    const hasMedia = Boolean(params.mediaFiles && params.mediaFiles.length > 0);
    if (!hasContent && !hasMedia) {
      throw Object.assign(new Error('Nội dung tin nhắn hoặc tệp đính kèm là bắt buộc'), { statusCode: 400 });
    }
    if (!params.zaloAccountId || !params.threadId) {
      throw Object.assign(new Error('zaloAccountId và threadId là bắt buộc'), { statusCode: 400 });
    }

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

    const conversation = await resolveOrCreateDeliveryConversation({
      orgId: params.orgId,
      zaloAccountId: params.zaloAccountId,
      threadId: params.threadId,
      threadType: params.threadType,
      conversationId: params.conversationId,
    });

    const movedAttachments = await moveStagedMediaToPermanentStorage(params.orgId, params.mediaFiles || []);
    const weight = movedAttachments.length > 0 ? movedAttachments.length * 2 : 1;

    const limits = zaloRateLimiter.checkLimits(params.zaloAccountId, weight);
    const canOverride = params.force === true && limits.canForce === true;
    if (!limits.allowed && !canOverride) {
      throw Object.assign(new Error(limits.reason || 'Zalo rate limit exceeded'), {
        statusCode: 429,
        canForce: limits.canForce,
      });
    }

    const claim = await prisma.$transaction(async (tx) => {
      return claimOutboxSlot(tx, {
        orgId: params.orgId,
        accountId: params.zaloAccountId,
        threadId: params.threadId,
        conversationId: conversation.id,
        content: params.content,
        attachments: movedAttachments.length > 0 ? movedAttachments.map((a) => ({
          url: a.url,
          filename: a.filename,
          originalName: a.originalName,
          size: a.size,
          mimeType: a.mimeType,
        })) : undefined,
        idempotencyKey: params.idempotencyKey,
        mediaFiles: params.mediaFiles,
      });
    });

    if (claim.status === 'succeeded') {
      const cachedMessage = await prisma.message.findUnique({
        where: { id: claim.messageId },
      });
      if (cachedMessage) {
        return {
          message: cachedMessage,
          conversationId: conversation.id,
          zaloMsgId: cachedMessage.zaloMsgId,
        };
      }
    }

    try {
      await prisma.$transaction(async (tx) => {
        await zaloRateLimiter.reserveSendSlot(tx, params.zaloAccountId, weight, params.force);
      });
    } catch (rateErr: any) {
      await commitOutboxFailedBeforeDispatch(claim.outboxId, rateErr?.message || String(rateErr));
      throw rateErr;
    }

    if (params.force === true) {
      logger.warn(
        { accountId: params.zaloAccountId, source: params.source },
        'Zalo rate limit overridden via authorized force flag'
      );
    }

    const normalizedThreadType =
      conversation.threadType === 'group' || params.threadType === 'group' || params.threadType === 1 ? 1 : 0;
    const content = params.content?.trim() || '';

    let res: any;
    try {
      if (movedAttachments.length > 0) {
        res = await instance.api.sendMessage(
          {
            msg: content,
            attachments: movedAttachments.map((f) => f.permanentPath),
          },
          params.threadId,
          normalizedThreadType,
        );
      } else {
        res = await instance.api.sendMessage(
          { msg: content },
          params.threadId,
          normalizedThreadType,
        );
      }
    } catch (sendErr: any) {
      logger.error(`[message-delivery] Send error to thread ${params.threadId}:`, sendErr);
      await commitOutboxUncertain(claim.outboxId, sendErr?.message || String(sendErr));
      throw Object.assign(
        new Error(`Failed to send message to Zalo: ${sendErr?.message || sendErr}`),
        { statusCode: 504, code: 'outbox_uncertain' },
      );
    }

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

    if (res?.error || (typeof res?.code === 'number' && res.code !== 0)) {
      const errMsg = res.message || res.error || 'Zalo rejected message delivery';
      await commitOutboxUncertain(claim.outboxId, errMsg, allMsgIds);
      throw Object.assign(new Error(errMsg), { statusCode: 502, code: 'outbox_uncertain' });
    }

    let contentType = 'text';
    if (movedAttachments.length > 0) {
      contentType = movedAttachments.every((f) => f.fileType === 'image') ? 'image' : 'file';
    }
    const senderName =
      params.senderName ||
      (params.source === 'public_api' ? 'API' : params.source === 'ai_copilot' ? 'AI Copilot' : 'Staff');
    const sentAt = new Date();

    const message = await prisma.$transaction(async (tx) => {
      let createdMsg;
      try {
        createdMsg = await tx.message.create({
          data: {
            id: randomUUID(),
            conversationId: conversation.id,
            zaloMsgId: primaryZaloMsgId,
            senderType: 'self',
            senderUid: account.zaloUid || '',
            senderName,
            content: content || (movedAttachments.length > 0 ? null : ''),
            contentType,
            attachments: movedAttachments.length > 0 ? movedAttachments.map((a) => ({
              url: a.url,
              filename: a.filename,
              originalName: a.originalName,
              size: a.size,
              mimeType: a.mimeType,
            })) : [],
            sentAt,
            repliedByUserId: params.senderUserId || null,
          },
        });
      } catch (err: any) {
        if (err?.code === 'P2002' && primaryZaloMsgId) {
          createdMsg = await tx.message.update({
            where: {
              conversationId_zaloMsgId: {
                conversationId: conversation.id,
                zaloMsgId: primaryZaloMsgId,
              },
            },
            data: {
              repliedByUserId: params.senderUserId || null,
              senderName,
              attachments: movedAttachments.length > 0 ? movedAttachments.map((a) => ({
                url: a.url,
                filename: a.filename,
                originalName: a.originalName,
                size: a.size,
                mimeType: a.mimeType,
              })) : undefined,
            },
          });
        } else {
          throw err;
        }
      }

      await commitOutboxSuccess(tx, claim.outboxId, createdMsg.id, allMsgIds);

      await tx.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: sentAt, isReplied: true, unreadCount: 0 },
      });

      return createdMsg;
    });

    zaloRateLimiter.recordSend(
      params.zaloAccountId,
      params.threadId,
      allMsgIds.length > 0 ? allMsgIds : primaryZaloMsgId,
      false,
      weight,
    );

    const io = this.getIO();
    if (io) {
      await emitAccountEvent(io, params.zaloAccountId, 'chat:message', {
        accountId: params.zaloAccountId,
        message,
        conversationId: conversation.id,
      });
    }

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
