/**
 * quick-reply-service.ts — Service layer for QuickReply templates management.
 */
import type { Server } from 'socket.io';
import { prisma } from '../../../shared/database/prisma-client.js';
import { RequestValidationError } from '../../../shared/http/request-schemas.js';
import { emitOrganizationEvent } from '../../../shared/realtime/socket-event-delivery.js';

export const VALID_CATEGORIES = ['payment', 'address', 'pricing', 'policy', 'general'] as const;
export type QuickReplyCategory = (typeof VALID_CATEGORIES)[number];

export class QuickReplyConflictError extends Error {
  statusCode = 409;
  code = 'shortcut_already_exists';
  constructor(message = 'Phím tắt này đã tồn tại trong tổ chức') {
    super(message);
    this.name = 'QuickReplyConflictError';
  }
}

export function sanitizeShortcut(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/^\/+/, '');
  if (!normalized) {
    throw new RequestValidationError('Shortcut không được để trống');
  }
  if (!/^[a-z0-9_-]{1,50}$/.test(normalized)) {
    throw new RequestValidationError(
      'Shortcut chỉ được chứa chữ cái, số, dấu gạch dưới hoặc gạch ngang (tối đa 50 ký tự), không chứa khoảng trắng'
    );
  }
  return normalized;
}

export function validateQuickReplyInput(data: {
  title?: string;
  content?: string;
  category?: string;
}) {
  if (data.title !== undefined) {
    const trimmed = data.title.trim();
    if (!trimmed || trimmed.length > 100) {
      throw new RequestValidationError('Tiêu đề mẫu tin nhắn bắt buộc (1 - 100 ký tự)');
    }
  }

  if (data.content !== undefined) {
    const trimmed = data.content.trim();
    if (!trimmed || trimmed.length > 2000) {
      throw new RequestValidationError('Nội dung mẫu tin nhắn bắt buộc (1 - 2.000 ký tự)');
    }
  }

  if (data.category !== undefined) {
    if (!VALID_CATEGORIES.includes(data.category as QuickReplyCategory)) {
      throw new RequestValidationError(`Danh mục không hợp lệ. Cho phép: ${VALID_CATEGORIES.join(', ')}`);
    }
  }
}

export async function listQuickReplies(
  orgId: string,
  filter?: { category?: string; search?: string }
) {
  const where: any = { orgId };

  if (filter?.category && filter.category !== 'all') {
    where.category = filter.category;
  }

  if (filter?.search) {
    const query = filter.search.trim();
    where.OR = [
      { shortcut: { contains: query, mode: 'insensitive' } },
      { title: { contains: query, mode: 'insensitive' } },
      { content: { contains: query, mode: 'insensitive' } },
    ];
  }

  return prisma.quickReply.findMany({
    where,
    orderBy: [{ category: 'asc' }, { shortcut: 'asc' }],
    include: {
      createdBy: { select: { id: true, fullName: true } },
    },
  });
}

export async function getQuickReplyById(orgId: string, id: string) {
  return prisma.quickReply.findFirst({
    where: { id, orgId },
    include: {
      createdBy: { select: { id: true, fullName: true } },
    },
  });
}

export async function createQuickReply(
  orgId: string,
  userId: string,
  data: { shortcut: string; title: string; content: string; category?: string },
  io?: Server
) {
  const shortcut = sanitizeShortcut(data.shortcut);
  validateQuickReplyInput(data);

  try {
    const quickReply = await prisma.quickReply.create({
      data: {
        orgId,
        shortcut,
        title: data.title.trim(),
        content: data.content.trim(),
        category: (data.category as QuickReplyCategory) || 'general',
        createdById: userId,
      },
      include: {
        createdBy: { select: { id: true, fullName: true } },
      },
    });

    if (io) {
      await emitOrganizationEvent(io, orgId, 'quick-reply:updated', { quickReply });
    }

    return quickReply;
  } catch (err: any) {
    if (err?.code === 'P2002') {
      throw new QuickReplyConflictError();
    }
    throw err;
  }
}

export async function updateQuickReply(
  orgId: string,
  id: string,
  data: { shortcut?: string; title?: string; content?: string; category?: string },
  io?: Server
) {
  const existing = await prisma.quickReply.findFirst({
    where: { id, orgId },
  });
  if (!existing) return null;

  validateQuickReplyInput(data);

  const updateData: any = {};
  if (data.shortcut !== undefined) {
    updateData.shortcut = sanitizeShortcut(data.shortcut);
  }
  if (data.title !== undefined) {
    updateData.title = data.title.trim();
  }
  if (data.content !== undefined) {
    updateData.content = data.content.trim();
  }
  if (data.category !== undefined) {
    updateData.category = data.category as QuickReplyCategory;
  }

  try {
    const updated = await prisma.quickReply.update({
      where: { id },
      data: updateData,
      include: {
        createdBy: { select: { id: true, fullName: true } },
      },
    });

    if (io) {
      await emitOrganizationEvent(io, orgId, 'quick-reply:updated', { quickReply: updated });
    }

    return updated;
  } catch (err: any) {
    if (err?.code === 'P2002') {
      throw new QuickReplyConflictError();
    }
    throw err;
  }
}

export async function deleteQuickReply(orgId: string, id: string, io?: Server): Promise<boolean> {
  const existing = await prisma.quickReply.findFirst({
    where: { id, orgId },
  });
  if (!existing) return false;

  await prisma.quickReply.delete({
    where: { id },
  });

  if (io) {
    await emitOrganizationEvent(io, orgId, 'quick-reply:deleted', { id });
  }

  return true;
}
