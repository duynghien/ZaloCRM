/**
 * conversation-tag-service.ts — Service layer for Conversation Tags & Assignments.
 */
import type { Server } from 'socket.io';
import { prisma } from '../../../shared/database/prisma-client.js';
import { RequestValidationError } from '../../../shared/http/request-schemas.js';
import { emitOrganizationEvent } from '../../../shared/realtime/socket-event-delivery.js';

export {
  MAX_TAGS_PER_CONVERSATION,
  ConversationTagLimitError,
  assignTagToConversation,
  unassignTagFromConversation,
} from './conversation-tag-assignment-service.js';

export class ConversationTagConflictError extends Error {
  statusCode = 409;
  code = 'tag_name_already_exists';
  constructor(message = 'Tên nhãn này đã tồn tại trong tổ chức') {
    super(message);
    this.name = 'ConversationTagConflictError';
  }
}

export function validateTagInput(data: { name?: string; color?: string; description?: string }) {
  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed || trimmed.length > 50) {
      throw new RequestValidationError('Tên nhãn bắt buộc (1 - 50 ký tự)');
    }
  }
  if (data.color !== undefined) {
    const trimmed = data.color.trim();
    if (!trimmed || trimmed.length > 30) {
      throw new RequestValidationError('Mã màu bắt buộc (tối đa 30 ký tự)');
    }
  }
  if (data.description !== undefined && data.description !== null) {
    if (data.description.length > 200) {
      throw new RequestValidationError('Mô tả nhãn tối đa 200 ký tự');
    }
  }
}

export async function listConversationTags(orgId: string) {
  return prisma.conversationTag.findMany({
    where: { orgId },
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: { assignments: true },
      },
    },
  });
}

export async function getConversationTagById(orgId: string, id: string) {
  return prisma.conversationTag.findFirst({
    where: { id, orgId },
    include: {
      _count: {
        select: { assignments: true },
      },
    },
  });
}

export async function createConversationTag(
  orgId: string,
  data: { name: string; color: string; description?: string }
) {
  validateTagInput(data);
  try {
    return await prisma.conversationTag.create({
      data: {
        orgId,
        name: data.name.trim(),
        color: data.color.trim(),
        description: data.description?.trim() || null,
      },
      include: {
        _count: {
          select: { assignments: true },
        },
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      throw new ConversationTagConflictError();
    }
    throw err;
  }
}

export async function updateConversationTag(
  orgId: string,
  id: string,
  data: { name?: string; color?: string; description?: string }
) {
  const existing = await prisma.conversationTag.findFirst({ where: { id, orgId } });
  if (!existing) return null;

  validateTagInput(data);
  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.color !== undefined) updateData.color = data.color.trim();
  if (data.description !== undefined) updateData.description = data.description?.trim() || null;

  try {
    return await prisma.conversationTag.update({
      where: { id },
      data: updateData,
      include: {
        _count: {
          select: { assignments: true },
        },
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      throw new ConversationTagConflictError();
    }
    throw err;
  }
}

export async function deleteConversationTag(orgId: string, id: string, io?: Server): Promise<boolean> {
  const existing = await prisma.conversationTag.findFirst({ where: { id, orgId } });
  if (!existing) return false;

  await prisma.conversationTag.delete({ where: { id } });

  if (io) {
    await emitOrganizationEvent(io, orgId, 'conversation:tag-deleted', { tagId: id });
  }

  return true;
}
