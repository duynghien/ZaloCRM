import type { Prisma } from '@prisma/client';
/**
 * message-handler.ts — persists incoming Zalo messages to the database.
 * Called from zalo-pool's startListener on every 'message' / 'undo' event.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';
import { emitWebhook } from '../api/webhook-service.js';
import { downloadAttachment } from '../attachments/attachment-downloader.js';
import { extractAttachmentContent } from '../attachments/attachment-parser.js';

export interface IncomingMessage {
  accountId: string;
  senderUid: string;
  senderName: string;       // zaloName (from cache or dName fallback)
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

    const persisted = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inbound-thread:${msg.accountId}:${msg.threadId}`}));`;
      const contactUid = msg.threadType === 'group' ? msg.threadId : msg.senderUid;
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
      await updateConversationAfterMessage(tx, conversation.id, sentAt, msg.isSelf);
      return { message, conversation, contactId, createdContact };
    });
    if (!persisted) return null;
    const { message, conversation, contactId } = persisted;

    // External notifications must describe committed rows, including contacts
    // created in the same transaction as the incoming message.
    if (persisted.createdContact) {
      emitWebhook(account.orgId, 'contact.created', persisted.createdContact);
    }

    // Process attachments asynchronously in the background (fire-and-forget)
    if (msg.attachments && msg.attachments.length > 0) {
      processMessageAttachmentsAsync(message.id, msg.attachments).catch((err) => {
        logger.warn(`[message-handler] Failed to process attachments for message ${message.id}:`, err);
      });
    }

    // Track first outbound contact date — set once when agent sends first message
    if (msg.isSelf && contactId) {
      prisma.contact.updateMany({
        where: { id: contactId, firstContactDate: null },
        data: { firstContactDate: new Date(msg.timestamp) },
      }).catch(() => {});
    }

    // Emit webhook for message event (fire-and-forget)
    emitWebhook(account.orgId, msg.isSelf ? 'message.sent' : 'message.received', {
      messageId: message.id,
      conversationId: conversation.id,
      senderUid: msg.senderUid,
      content: msg.content,
      contentType: msg.contentType,
      sentAt: message.sentAt,
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
    const groupUid = msg.threadId;
    let groupContact = await db.contact.findFirst({
      where: { zaloUid: groupUid, orgId },
      select: { id: true, fullName: true },
    });

    if (!groupContact) {
      groupContact = await db.contact.create({
        data: {
          id: randomUUID(),
          orgId,
          zaloUid: groupUid,
          fullName: msg.groupName || 'Nhóm',
          metadata: { isGroup: true },
        },
        select: { id: true, fullName: true },
      });
      createdContact = { contactId: groupContact.id, fullName: groupContact.fullName };
    } else if (msg.groupName && groupContact.fullName !== msg.groupName) {
      await db.contact.update({
        where: { id: groupContact.id },
        data: { fullName: msg.groupName },
      });
    }
    return { contactId: groupContact.id, createdContact };
  }

  // User messages: self messages don't create a contact
  if (msg.isSelf) return { contactId: null, createdContact: null };

  let contact = await db.contact.findFirst({
    where: { zaloUid: msg.senderUid, orgId },
    select: { id: true, fullName: true },
  });

  if (!contact) {
    contact = await db.contact.create({
      data: {
        id: randomUUID(),
        orgId,
        zaloUid: msg.senderUid,
        fullName: msg.senderName || 'Unknown',
      },
      select: { id: true, fullName: true },
    });
    createdContact = { contactId: contact.id, fullName: contact.fullName };
  } else if (msg.senderName && contact.fullName !== msg.senderName) {
    await db.contact.update({
      where: { id: contact.id },
      data: { fullName: msg.senderName },
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
    update: {}, select: { id: true },
  });
}

// Update conversation metadata after a new message
async function updateConversationAfterMessage(
  db: Prisma.TransactionClient,
  conversationId: string,
  sentAt: Date,
  isSelf: boolean,
): Promise<void> {
  const updateData: any = { lastMessageAt: sentAt };
  if (isSelf) {
    updateData.isReplied = true;
    updateData.unreadCount = 0;
  } else {
    updateData.unreadCount = { increment: 1 };
    updateData.isReplied = false;
  }
  await db.conversation.update({ where: { id: conversationId }, data: updateData });
}

// Soft-delete a message by its Zalo message ID
export async function handleMessageUndo(accountId: string, zaloMsgId: string, threadId: string): Promise<string | null> {
  if (!accountId || !zaloMsgId || !threadId) return null;
  const conversation = await prisma.conversation.findUnique({ where: { zaloAccountId_externalThreadId: { zaloAccountId: accountId, externalThreadId: threadId } }, select: { id: true } });
  if (!conversation) return null;
  const updated = await prisma.message.updateMany({ where: { conversationId: conversation.id, zaloMsgId }, data: { isDeleted: true, deletedAt: new Date() } });
  return updated.count ? conversation.id : null;
}

/**
 * Asynchronously download and extract text/tables from message attachments.
 */
async function extractAttachmentSafely(params: Parameters<typeof extractAttachmentContent>[0]) {
  try {
    return await extractAttachmentContent(params);
  } catch (error) {
    logger.warn('[message-handler] Attachment parsing failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

export async function processMessageAttachmentsAsync(
  messageId: string,
  attachments: any[],
): Promise<void> {
  if (!attachments || attachments.length === 0) return;

  const updatedAttachments: any[] = [];

  for (const att of attachments) {
    let localPath = att.localPath;
    let filename = att.filename;
    let extractedText = att.extractedText;
    let isScanned = att.isScanned;
    let sheetNames = att.sheetNames;

    if (att.url && !localPath) {
      const downloadRes = await downloadAttachment(att.url, {
        originalFilename: att.title || att.name,
      });
      if (downloadRes) {
        localPath = downloadRes.localPath;
        filename = downloadRes.filename;

        const parseRes = await extractAttachmentSafely({
          filename: downloadRes.originalName,
          localPath: downloadRes.localPath,
          mimeType: downloadRes.mimeType,
        });

        if (parseRes) {
          extractedText = parseRes.text;
          isScanned = parseRes.isScanned;
          sheetNames = parseRes.sheetNames;
        }
      }
    } else if (localPath && !extractedText) {
      const parseRes = await extractAttachmentSafely({
        filename: att.title || filename,
        localPath,
        mimeType: att.mimeType,
      });
      if (parseRes) {
        extractedText = parseRes.text;
        isScanned = parseRes.isScanned;
        sheetNames = parseRes.sheetNames;
      }
    }

    updatedAttachments.push({
      ...att,
      localPath,
      filename,
      extractedText,
      isScanned,
      sheetNames,
    });
  }

  await prisma.message.update({
    where: { id: messageId },
    data: { attachments: updatedAttachments },
  });
}
