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

    const contactId = await upsertContact(msg, account.orgId);

    const conversation = await findOrCreateConversation(msg, account.orgId, contactId);

    const sentAt = new Date(msg.timestamp);
    const zaloMsgId = msg.msgId || null;
    if (zaloMsgId) {
      const replay = await prisma.message.findUnique({
        where: { conversationId_zaloMsgId: { conversationId: conversation.id, zaloMsgId } },
        select: { id: true },
      });
      if (replay) {
        logger.info(`[message-handler] Suppressed replay ${zaloMsgId} in conversation ${conversation.id}`);
        return null;
      }
    }

    let message;
    try {
      message = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: conversation.id,
          zaloMsgId,
          senderType: msg.isSelf ? 'self' : 'contact',
          senderUid: msg.senderUid,
          senderName: msg.senderName || null,
          content: msg.content || '',
          contentType: msg.contentType || 'text',
          attachments: msg.attachments ?? [],
          sentAt,
        },
      });
    } catch (err: any) {
      // The unique index is the race-safe replay gate for concurrent listeners.
      if (err?.code === 'P2002' && zaloMsgId) {
        logger.info(`[message-handler] Suppressed concurrent replay ${zaloMsgId} in conversation ${conversation.id}`);
        return null;
      }
      throw err;
    }

    await updateConversationAfterMessage(conversation.id, sentAt, msg.isSelf);

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
async function upsertContact(msg: IncomingMessage, orgId: string): Promise<string | null> {
  // Group messages: create/update a "contact" record representing the group
  if (msg.threadType === 'group') {
    const groupUid = msg.threadId;
    let groupContact = await prisma.contact.findFirst({
      where: { zaloUid: groupUid, orgId },
      select: { id: true, fullName: true },
    });

    if (!groupContact) {
      groupContact = await prisma.contact.create({
        data: {
          id: randomUUID(),
          orgId,
          zaloUid: groupUid,
          fullName: msg.groupName || 'Nhóm',
          metadata: { isGroup: true },
        },
        select: { id: true, fullName: true },
      });
      // Emit webhook for new contact created
      emitWebhook(orgId, 'contact.created', { contactId: groupContact.id, fullName: groupContact.fullName });
    } else if (msg.groupName && groupContact.fullName !== msg.groupName) {
      await prisma.contact.update({
        where: { id: groupContact.id },
        data: { fullName: msg.groupName },
      });
    }
    return groupContact.id;
  }

  // User messages: self messages don't create a contact
  if (msg.isSelf) return null;

  let contact = await prisma.contact.findFirst({
    where: { zaloUid: msg.senderUid, orgId },
    select: { id: true, fullName: true },
  });

  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        id: randomUUID(),
        orgId,
        zaloUid: msg.senderUid,
        fullName: msg.senderName || 'Unknown',
      },
      select: { id: true, fullName: true },
    });
    // Emit webhook for new contact created
    emitWebhook(orgId, 'contact.created', { contactId: contact.id, fullName: contact.fullName });
  } else if (msg.senderName && contact.fullName !== msg.senderName) {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { fullName: msg.senderName },
    });
  }

  return contact.id;
}

// Find or create conversation — externalThreadId = threadId for both user and group
async function findOrCreateConversation(
  msg: IncomingMessage,
  orgId: string,
  contactId: string | null,
) {
  const externalThreadId = msg.threadId;

  const existing = await prisma.conversation.findFirst({
    where: { zaloAccountId: msg.accountId, externalThreadId },
    select: { id: true },
  });

  if (existing) return existing;

  try {
    return await prisma.conversation.create({
      data: {
        id: randomUUID(),
        orgId,
        zaloAccountId: msg.accountId,
        contactId,
        threadType: msg.threadType,
        externalThreadId,
        lastMessageAt: new Date(msg.timestamp),
        unreadCount: msg.isSelf ? 0 : 1,
        isReplied: msg.isSelf,
      },
      select: { id: true },
    });
  } catch (err: any) {
    // Concurrent listener callbacks may create the same conversation first.
    if (err?.code !== 'P2002') throw err;
    const concurrent = await prisma.conversation.findUnique({
      where: { zaloAccountId_externalThreadId: { zaloAccountId: msg.accountId, externalThreadId } },
      select: { id: true },
    });
    if (concurrent) return concurrent;
    throw err;
  }
}

// Update conversation metadata after a new message
async function updateConversationAfterMessage(
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
  await prisma.conversation.update({ where: { id: conversationId }, data: updateData });
}

// Soft-delete a message by its Zalo message ID
export async function handleMessageUndo(accountId: string, zaloMsgId: string): Promise<void> {
  try {
    await prisma.message.updateMany({
      where: {
        zaloMsgId: String(zaloMsgId),
        conversation: { zaloAccountId: accountId },
      },
      data: { isDeleted: true, deletedAt: new Date() },
    });
    logger.info(`[message-handler] Undo message ${zaloMsgId} for account ${accountId}`);
  } catch (err) {
    logger.error('[message-handler] handleMessageUndo error:', err);
  }
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
