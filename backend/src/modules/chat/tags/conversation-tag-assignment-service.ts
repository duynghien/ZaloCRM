/**
 * conversation-tag-assignment-service.ts — Service layer for Conversation Tag Assignments.
 */
import type { Server } from 'socket.io';
import { prisma } from '../../../shared/database/prisma-client.js';
import { RequestValidationError } from '../../../shared/http/request-schemas.js';
import { emitOrganizationEvent } from '../../../shared/realtime/socket-event-delivery.js';

export const MAX_TAGS_PER_CONVERSATION = 6;

export class ConversationTagLimitError extends Error {
  statusCode = 400;
  code = 'max_tags_exceeded';
  constructor(message = 'Tối đa 6 nhãn cho mỗi cuộc hội thoại') {
    super(message);
    this.name = 'ConversationTagLimitError';
  }
}

export async function assignTagToConversation(
  orgId: string,
  conversationId: string,
  tagId: string,
  userId: string,
  io?: Server
) {
  const conv = await prisma.conversation.findFirst({ where: { id: conversationId, orgId } });
  if (!conv) return null;

  const tag = await prisma.conversationTag.findFirst({ where: { id: tagId, orgId } });
  if (!tag) {
    throw new RequestValidationError('Nhãn không tồn tại hoặc không thuộc tổ chức');
  }

  const existingAssignments = await prisma.conversationTagAssignment.findMany({
    where: { orgId, conversationId },
    include: { tag: true },
    orderBy: { assignedAt: 'asc' },
  });

  const alreadyAssigned = existingAssignments.some((a) => a.tagId === tagId);
  if (alreadyAssigned) {
    return existingAssignments;
  }

  if (existingAssignments.length >= MAX_TAGS_PER_CONVERSATION) {
    throw new ConversationTagLimitError();
  }

  await prisma.conversationTagAssignment.create({
    data: {
      orgId,
      conversationId,
      tagId,
      assignedById: userId,
    },
  });

  const updatedAssignments = await prisma.conversationTagAssignment.findMany({
    where: { orgId, conversationId },
    include: { tag: true },
    orderBy: { assignedAt: 'asc' },
  });

  if (io) {
    await emitOrganizationEvent(io, orgId, 'conversation:tags-updated', {
      conversationId,
      tags: updatedAssignments,
    });
  }

  return updatedAssignments;
}

export async function unassignTagFromConversation(
  orgId: string,
  conversationId: string,
  tagId: string,
  io?: Server
) {
  const conv = await prisma.conversation.findFirst({ where: { id: conversationId, orgId } });
  if (!conv) return null;

  await prisma.conversationTagAssignment.deleteMany({
    where: { orgId, conversationId, tagId },
  });

  const updatedAssignments = await prisma.conversationTagAssignment.findMany({
    where: { orgId, conversationId },
    include: { tag: true },
    orderBy: { assignedAt: 'asc' },
  });

  if (io) {
    await emitOrganizationEvent(io, orgId, 'conversation:tags-updated', {
      conversationId,
      tags: updatedAssignments,
    });
  }

  return updatedAssignments;
}
