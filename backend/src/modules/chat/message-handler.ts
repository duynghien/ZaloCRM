import type { Prisma } from '@prisma/client';
/**
 * message-handler.ts — persists incoming Zalo messages to the database.
 * Called from zalo-pool's startListener on every 'message' / 'undo' event.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';
import { enqueueWebhook, tickWebhookQueue } from '../api/webhook-service.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { processMessageAttachmentsAsync } from '../attachments/attachment-processor.js';
import { chatTurnDebouncer } from './copilot/chat-turn-debouncer.js';
import { resolveByEntity } from '../notifications/notification-service.js';
export { processMessageAttachmentsAsync } from '../attachments/attachment-processor.js';

export interface IncomingMessage {
  accountId: string;
  senderUid: string;
  senderName: string;       // zaloName (from cache or dName fallback)
  recipientName?: string;   // resolved recipient name when isSelf
  recipientAvatar?: string; // resolved recipient avatar when isSelf
  content: string;
  contentType: string;      // text, image, sticker, video, voice, gif, link, file
  msgId: string;
  timestamp: number;        // epoch ms
  isSelf: boolean;
  threadId: string;         // For user: contact UID. For group: group ID
  threadType: 'user' | 'group'; // user or group conversation
  groupName?: string;       // group name if group message
  attachments?: any[];
}

export interface HandleMessageResult {
  message: {
    id: string;
    conversationId: string;
    zaloMsgId: string | null;
    senderType: string;
    senderUid: string | null;
    senderName: string | null;
    content: string | null;
    contentType: string;
    attachments: any;
    isDeleted: boolean;
    deletedAt: Date | null;
    sentAt: Date;
    repliedByUserId: string | null;
    createdAt: Date;
  };
  conversationId: string;
  orgId: string;
  contactId: string | null;
}

export async function handleIncomingMessage(
  msg: IncomingMessage,
): Promise<HandleMessageResult | null> {
  try {
    const account = await prisma.zaloAccount.findUnique({
      where: { id: msg.accountId },
      select: { orgId: true, ownerUserId: true },
    });
    if (!account) return null;

    if (msg.isSelf) {
      if (msg.msgId && zaloRateLimiter.isRecentMsgId(msg.accountId, msg.threadId, msg.msgId)) {
        logger.info(`[message-handler] Skipping echo of recently sent CRM message ${msg.msgId}`);
        return null;
      }
      zaloRateLimiter.recordSend(msg.accountId, msg.threadId, msg.msgId || null, true);
    }

    const persisted = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inbound-thread:${msg.accountId}:${msg.threadId}`}));`;
      const contactUid = msg.threadId;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inbound-contact:${account.orgId}:${contactUid}`}));`;
      const { contactId, createdContact } = await upsertContact(tx, msg, account.orgId);
      const conversation = await findOrCreateConversation(tx, msg, account.orgId, contactId);
      const zaloMsgId = msg.msgId || null;
      if (zaloMsgId && await tx.message.findUnique({ where: { conversationId_zaloMsgId: { conversationId: conversation.id, zaloMsgId } }, select: { id: true } })) return null;
      const sentAt = new Date(msg.timestamp);
      const message = await tx.message.create({ data: {
        id: randomUUID(), conversationId: conversation.id, zaloMsgId,
        senderType: msg.isSelf ? 'self' : 'contact', senderUid: msg.senderUid,
        senderName: msg.senderName || null, content: msg.content || '', contentType: msg.contentType || 'text',
        attachments: msg.attachments ?? [], sentAt,
      } });
      await updateConversationAfterMessage(tx, conversation.id, account.orgId, sentAt, msg.isSelf);

      if (createdContact) {
        await enqueueWebhook(tx, account.orgId, 'contact.created', createdContact);
      }
      await enqueueWebhook(tx, account.orgId, msg.isSelf ? 'message.sent' : 'message.received', {
        messageId: message.id,
        conversationId: conversation.id,
        senderUid: msg.senderUid,
        content: msg.content,
        contentType: msg.contentType,
        sentAt: message.sentAt,
      });

      return { message, conversation, contactId, createdContact };
    });
    if (!persisted) return null;
    const { message, conversation, contactId } = persisted;

    setImmediate(() => {
      tickWebhookQueue().catch((err) => {
        logger.warn('[message-handler] Outbox trigger error:', err);
      });
    });

    // Process attachments asynchronously in the background (fire-and-forget)
    if (msg.attachments && msg.attachments.length > 0) {
      processMessageAttachmentsAsync(message.id, msg.attachments, 0, account.orgId).catch((err) => {
        logger.warn(`[message-handler] Failed to process attachments for message ${message.id}:`, err);
      });
    }

    // Track first outbound contact date — set once when agent sends first message
    if (msg.isSelf) {
      if (contactId) {
        prisma.contact.updateMany({
          where: { id: contactId, firstContactDate: null },
          data: { firstContactDate: new Date(msg.timestamp) },
        }).catch(() => {});
      }
      void resolveByEntity(account.orgId, 'conversation', conversation.id).catch(() => {});
    }

    // Inbound conversation turn debouncer for Copilot (fire-and-forget)
    chatTurnDebouncer.handleMessageTurn({
      conversationId: conversation.id,
      accountId: msg.accountId,
      orgId: account.orgId,
      isSelf: msg.isSelf,
      threadType: msg.threadType,
    }).catch((err) => {
      logger.warn('[message-handler] Copilot debouncer error:', err);
    });

    return {
      message,
      conversationId: conversation.id,
      orgId: account.orgId,
      contactId,
    };
  } catch (err) {
    logger.error('[message-handler] handleIncomingMessage error:', err);
    return null;
  }
}

// Upsert contact — handles both user and group conversations
async function upsertContact(db: Prisma.TransactionClient, msg: IncomingMessage, orgId: string): Promise<{
  contactId: string | null;
  createdContact: { contactId: string; fullName: string | null } | null;
}> {
  let createdContact: { contactId: string; fullName: string | null } | null = null;

  // Group messages: create/update a "contact" record representing the group
  if (msg.threadType === 'group') {
    const groupUid = msg.threadId.startsWith('group_') ? msg.threadId : `group_${msg.threadId}`;
    const groupName = msg.groupName || 'Nhóm';
    const existingGroup = await db.contact.findUnique({
      where: {
        orgId_zaloUid: {
          orgId,
          zaloUid: groupUid,
        },
      },
      select: { id: true, fullName: true },
    });

    let contactId: string;
    if (!existingGroup) {
      const groupContact = await db.contact.create({
        data: {
          id: randomUUID(),
          orgId,
          zaloUid: groupUid,
          fullName: groupName,
          metadata: { isGroup: true },
        },
        select: { id: true, fullName: true },
      });
      contactId = groupContact.id;
      createdContact = { contactId: groupContact.id, fullName: groupContact.fullName };
    } else {
      contactId = existingGroup.id;
      if (msg.groupName && msg.groupName !== existingGroup.fullName) {
        await db.contact.update({
          where: { id: existingGroup.id },
          data: { fullName: msg.groupName },
        });
      }
    }
    return { contactId, createdContact };
  }

  // User messages (both customer incoming and self outbound from external devices)
  const contactUid = msg.threadId;
  const initialName = (msg.isSelf ? msg.recipientName : msg.senderName) || 'Khách Zalo';
  const initialAvatar = msg.isSelf ? (msg.recipientAvatar || null) : null;

  const existingContact = await db.contact.findUnique({
    where: {
      orgId_zaloUid: {
        orgId,
        zaloUid: contactUid,
      },
    },
    select: { id: true, fullName: true, avatarUrl: true },
  });

  let contact: { id: string; fullName: string | null; avatarUrl: string | null };
  if (!existingContact) {
    contact = await db.contact.create({
      data: {
        id: randomUUID(),
        orgId,
        zaloUid: contactUid,
        fullName: initialName,
        avatarUrl: initialAvatar,
      },
      select: { id: true, fullName: true, avatarUrl: true },
    });
    createdContact = { contactId: contact.id, fullName: contact.fullName };
  } else {
    contact = existingContact;
  }

  // Self-healing: if generic name or customer sent updated name
  const isGeneric = !contact.fullName || contact.fullName === 'Khách Zalo' || contact.fullName === 'Unknown';
  if (!msg.isSelf && msg.senderName && (isGeneric || contact.fullName !== msg.senderName)) {
    await db.contact.update({
      where: { id: contact.id },
      data: { fullName: msg.senderName },
    });
  } else if (msg.isSelf && msg.recipientName && msg.recipientName !== 'Khách Zalo' && isGeneric) {
    await db.contact.update({
      where: { id: contact.id },
      data: {
        fullName: msg.recipientName,
        ...(msg.recipientAvatar && !contact.avatarUrl ? { avatarUrl: msg.recipientAvatar } : {}),
      },
    });
  } else if (msg.isSelf && msg.recipientAvatar && !contact.avatarUrl) {
    await db.contact.update({
      where: { id: contact.id },
      data: { avatarUrl: msg.recipientAvatar },
    });
  }

  return { contactId: contact.id, createdContact };
}

// Find or create conversation — externalThreadId = threadId for both user and group
async function findOrCreateConversation(
  db: Prisma.TransactionClient,
  msg: IncomingMessage,
  orgId: string,
  contactId: string | null,
) {
  const externalThreadId = msg.threadId;

  return db.conversation.upsert({
    where: { zaloAccountId_externalThreadId: { zaloAccountId: msg.accountId, externalThreadId } },
    create: { id: randomUUID(), orgId, zaloAccountId: msg.accountId, contactId,
      threadType: msg.threadType, externalThreadId, lastMessageAt: new Date(msg.timestamp),
      unreadCount: 0, isReplied: msg.isSelf },
    update: contactId ? { contactId } : {}, select: { id: true },
  });
}

// Update conversation metadata after a new message using chronology-aware raw SQL
export async function updateConversationAfterMessage(
  db: Prisma.TransactionClient,
  conversationId: string,
  orgId: string,
  sentAt: Date,
  isSelf: boolean,
): Promise<void> {
  await db.$executeRaw`
    UPDATE conversations
    SET
      last_message_at = GREATEST(COALESCE(last_message_at, ${sentAt}), ${sentAt}),
      is_replied = CASE
        WHEN last_message_at IS NOT NULL AND ${sentAt} < last_message_at THEN is_replied
        WHEN ${isSelf} = true THEN true
        WHEN last_message_at IS NOT NULL AND ${sentAt} = last_message_at AND is_replied = true THEN true
        ELSE false
      END,
      unread_count = CASE
        WHEN last_message_at IS NOT NULL AND ${sentAt} < last_message_at THEN unread_count
        WHEN ${isSelf} = true THEN 0
        WHEN last_message_at IS NOT NULL AND ${sentAt} = last_message_at AND is_replied = true THEN unread_count
        ELSE unread_count + 1
      END,
      updated_at = NOW()
    WHERE id = ${conversationId} AND org_id = ${orgId};
  `;
}

// Soft-delete a message by its Zalo message ID
export async function handleMessageUndo(accountId: string, zaloMsgId: string, threadId: string): Promise<string | null> {
  if (!accountId || !zaloMsgId || !threadId) return null;
  const conversation = await prisma.conversation.findUnique({ where: { zaloAccountId_externalThreadId: { zaloAccountId: accountId, externalThreadId: threadId } }, select: { id: true } });
  if (!conversation) return null;
  const updated = await prisma.message.updateMany({ where: { conversationId: conversation.id, zaloMsgId }, data: { isDeleted: true, deletedAt: new Date() } });
  return updated.count ? conversation.id : null;
}
