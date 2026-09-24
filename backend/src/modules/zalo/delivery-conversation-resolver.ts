import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';

export interface ResolveConversationParams {
  orgId: string;
  zaloAccountId: string;
  threadId: string;
  threadType?: 'user' | 'group' | number;
  conversationId?: string | null;
}

export async function resolveOrCreateDeliveryConversation(params: ResolveConversationParams) {
  const normalizedThreadType: 'user' | 'group' =
    params.threadType === 'group' || params.threadType === 1 ? 'group' : 'user';

  if (params.conversationId) {
    const conv = await prisma.conversation.findFirst({
      where: {
        id: params.conversationId,
        orgId: params.orgId,
        zaloAccountId: params.zaloAccountId,
        externalThreadId: params.threadId,
      },
      include: { zaloAccount: true },
    });
    if (!conv) {
      throw Object.assign(new Error('Conversation does not match account/thread'), {
        statusCode: 409,
        code: 'conversation_mismatch',
      });
    }
    return conv;
  }

  let conversation = await prisma.conversation.findFirst({
    where: {
      zaloAccountId: params.zaloAccountId,
      externalThreadId: params.threadId,
      orgId: params.orgId,
    },
    include: { zaloAccount: true },
  });

  if (!conversation) {
    const targetZaloUid =
      normalizedThreadType === 'group'
        ? (params.threadId.startsWith('group_') ? params.threadId : `group_${params.threadId}`)
        : params.threadId;

    const contact = await prisma.contact.upsert({
      where: {
        orgId_zaloUid: {
          orgId: params.orgId,
          zaloUid: targetZaloUid,
        },
      },
      create: {
        id: randomUUID(),
        orgId: params.orgId,
        zaloUid: targetZaloUid,
        fullName: normalizedThreadType === 'group' ? 'Nhóm' : 'Khách Zalo',
        metadata: normalizedThreadType === 'group' ? { isGroup: true } : undefined,
      },
      update: {},
      select: { id: true },
    });

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

  return conversation;
}
