/**
 * Zalo Outbound Outbox Service
 *
 * Provides durable outbound message claiming, deduplication via idempotency keys,
 * and outbox lifecycle management (preparing -> dispatching -> succeeded | uncertain | failed_before_dispatch).
 */

import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';

export interface StagedMediaFile {
  id: string;
  filename: string;
  stagedPath: string;
  originalName: string;
  size: number;
  mimeType: string;
  fileType: 'image' | 'file';
}

export interface ClaimOutboxParams {
  orgId: string;
  accountId: string;
  threadId: string;
  conversationId?: string | null;
  content?: string | null;
  attachments?: any;
  idempotencyKey?: string | null;
  mediaFiles?: StagedMediaFile[];
}

export class OutboxUncertainError extends Error {
  statusCode = 409;
  code = 'outbox_uncertain';
  constructor(message = 'Tin nhắn đang chờ xác thực gửi từ Zalo. Vui lòng không gửi lại') {
    super(message);
    this.name = 'OutboxUncertainError';
  }
}

export class OutboxConflictError extends Error {
  statusCode = 409;
  code = 'outbox_conflict';
  constructor(message = 'Tin nhắn đang được gửi xử lý. Vui lòng không gửi lặp lại') {
    super(message);
    this.name = 'OutboxConflictError';
  }
}

export function computeOutboundIdempotencyKey(params: {
  accountId: string;
  threadId: string;
  content?: string | null;
  mediaFiles?: Array<{ filename: string; size: number }>;
  timeWindowMs?: number;
}): string {
  const mediaSig = (params.mediaFiles || []).map((f) => `${f.filename}:${f.size}`).join(';');
  const timeWindow = Math.floor(Date.now() / (params.timeWindowMs ?? 2000));
  return crypto
    .createHash('sha256')
    .update(`${params.accountId}:${params.threadId}:${params.content || ''}:${mediaSig}:${timeWindow}`)
    .digest('hex');
}

export async function claimOutboxSlot(
  tx: Prisma.TransactionClient,
  params: ClaimOutboxParams
): Promise<
  | { status: 'succeeded'; messageId: string; idempotencyKey: string; outboxId: string }
  | { status: 'claimed'; outboxId: string; idempotencyKey: string }
> {
  const effectiveKey =
    params.idempotencyKey ||
    computeOutboundIdempotencyKey({
      accountId: params.accountId,
      threadId: params.threadId,
      content: params.content,
      mediaFiles: params.mediaFiles,
    });

  const existing = await tx.zaloOutboundMessage.findUnique({
    where: {
      orgId_accountId_threadId_idempotencyKey: {
        orgId: params.orgId,
        accountId: params.accountId,
        threadId: params.threadId,
        idempotencyKey: effectiveKey,
      },
    },
  });

  if (existing) {
    if (existing.state === 'succeeded' && existing.messageId) {
      return {
        status: 'succeeded',
        messageId: existing.messageId,
        idempotencyKey: effectiveKey,
        outboxId: existing.id,
      };
    }

    if (existing.state === 'uncertain') {
      throw new OutboxUncertainError();
    }

    const isRecentDispatch = Date.now() - existing.updatedAt.getTime() < 15_000;
    if (existing.state === 'dispatching' && isRecentDispatch) {
      throw new OutboxConflictError();
    }

    // Reclaim stale dispatching or previously failed attempt
    const updated = await tx.zaloOutboundMessage.update({
      where: { id: existing.id },
      data: {
        state: 'dispatching',
        conversationId: params.conversationId ?? existing.conversationId,
        content: params.content ?? existing.content,
        attachments: params.attachments ?? existing.attachments,
        lastError: null,
      },
    });

    return {
      status: 'claimed',
      outboxId: updated.id,
      idempotencyKey: effectiveKey,
    };
  }

  // Create new outbox record
  const created = await tx.zaloOutboundMessage.create({
    data: {
      orgId: params.orgId,
      accountId: params.accountId,
      threadId: params.threadId,
      conversationId: params.conversationId || null,
      idempotencyKey: effectiveKey,
      content: params.content || null,
      attachments: params.attachments || null,
      state: 'dispatching',
    },
  });

  return {
    status: 'claimed',
    outboxId: created.id,
    idempotencyKey: effectiveKey,
  };
}

export async function commitOutboxSuccess(
  tx: Prisma.TransactionClient,
  outboxId: string,
  messageId: string,
  remoteMsgIds: string[]
): Promise<void> {
  await tx.zaloOutboundMessage.update({
    where: { id: outboxId },
    data: {
      state: 'succeeded',
      messageId,
      remoteMsgIds,
      lastError: null,
    },
  });
}

export async function commitOutboxUncertain(
  outboxId: string,
  lastError: string,
  remoteMsgIds?: string[]
): Promise<void> {
  try {
    await prisma.zaloOutboundMessage.update({
      where: { id: outboxId },
      data: {
        state: 'uncertain',
        lastError: lastError.slice(0, 500),
        remoteMsgIds: remoteMsgIds || [],
      },
    });
  } catch {}
}

export async function commitOutboxFailedBeforeDispatch(
  outboxId: string,
  lastError: string
): Promise<void> {
  try {
    await prisma.zaloOutboundMessage.update({
      where: { id: outboxId },
      data: {
        state: 'failed_before_dispatch',
        lastError: lastError.slice(0, 500),
      },
    });
  } catch {}
}
