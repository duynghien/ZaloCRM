/**
 * Zalo Outbound Outbox Service
 *
 * Provides durable outbound message claiming, deduplication via idempotency keys,
 * and outbox lifecycle management (preparing -> dispatching -> succeeded | uncertain | failed_before_dispatch).
 */

import crypto, { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
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

export class OutboxRequestConflictError extends Error {
  statusCode = 409;
  code = 'outbox_request_conflict';
  constructor(message = 'Idempotency key reused with different request payload') {
    super(message);
    this.name = 'OutboxRequestConflictError';
  }
}

export function computeRequestHash(params: {
  orgId: string;
  accountId: string;
  threadId: string;
  content?: string | null;
  attachments?: any;
}): string {
  const normalizedAttachments = Array.isArray(params.attachments) ? params.attachments : [];
  const canonicalObj = {
    accountId: params.accountId,
    attachments: normalizedAttachments,
    content: params.content ?? '',
    orgId: params.orgId,
    threadId: params.threadId,
  };
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalObj))
    .digest('hex');
}

export type ClaimOutboxResult =
  | { status: 'succeeded'; messageId: string; idempotencyKey: string; outboxId: string }
  | { status: 'claimed'; outboxId: string; idempotencyKey: string; leaseVersion: number };

export async function claimOutboxSlot(
  tx: Prisma.TransactionClient,
  params: ClaimOutboxParams
): Promise<ClaimOutboxResult> {
  const idempotencyKey = params.idempotencyKey?.trim();
  if (!idempotencyKey) {
    throw Object.assign(new Error('Idempotency-Key is required'), { statusCode: 400 });
  }

  const requestHash = computeRequestHash({
    orgId: params.orgId,
    accountId: params.accountId,
    threadId: params.threadId,
    content: params.content,
    attachments: params.attachments,
  });

  const workerId = randomUUID();
  const leaseExpiresAt = new Date(Date.now() + 30_000);
  const outboxId = randomUUID();

  // 1. Try atomic insert with ON CONFLICT DO NOTHING if raw query is available
  let inserted = false;
  let createdId = outboxId;
  let createdLeaseVersion = 1;

  if (typeof (tx as any).$queryRaw === 'function') {
    try {
      const rows = await tx.$queryRaw<any[]>`
        INSERT INTO "zalo_outbound_messages" (
          "id", "org_id", "account_id", "thread_id", "conversation_id",
          "idempotency_key", "request_hash", "content", "attachments", "state",
          "lease_owner", "lease_version", "lease_expires_at", "created_at", "updated_at"
        ) VALUES (
          ${outboxId}, ${params.orgId}, ${params.accountId}, ${params.threadId}, ${params.conversationId || null},
          ${idempotencyKey}, ${requestHash}, ${params.content || null},
          ${params.attachments ? JSON.stringify(params.attachments) : null}::jsonb,
          'preparing',
          ${workerId}, 1, ${leaseExpiresAt}, NOW(), NOW()
        )
        ON CONFLICT ("org_id", "account_id", "thread_id", "idempotency_key") DO NOTHING
        RETURNING "id", "lease_version" AS "leaseVersion";
      `;
      if (rows && rows.length > 0) {
        inserted = true;
        createdId = rows[0].id;
        createdLeaseVersion = rows[0].leaseVersion ?? rows[0].lease_version ?? 1;
      }
    } catch {
      // Fall through to existing check
    }
  }

  if (inserted) {
    return {
      status: 'claimed',
      outboxId: createdId,
      idempotencyKey,
      leaseVersion: createdLeaseVersion,
    };
  }

  // 2. Select existing row if raw insert was not performed or encountered conflict
  const existing = await tx.zaloOutboundMessage.findUnique({
    where: {
      orgId_accountId_threadId_idempotencyKey: {
        orgId: params.orgId,
        accountId: params.accountId,
        threadId: params.threadId,
        idempotencyKey,
      },
    },
  });

  if (existing) {
    if (existing.requestHash && existing.requestHash !== requestHash) {
      throw new OutboxRequestConflictError();
    }

    if (existing.state === 'succeeded' && existing.messageId) {
      return {
        status: 'succeeded',
        messageId: existing.messageId,
        idempotencyKey,
        outboxId: existing.id,
      };
    }

    if (existing.state === 'uncertain') {
      throw new OutboxUncertainError();
    }

    if (existing.state === 'dispatching') {
      throw new OutboxConflictError('Tin nhắn đang trong quá trình chuyển tiếp tới Zalo SDK. Vui lòng không gửi lại');
    }

    if (existing.state === 'preparing') {
      const isLeaseActive = existing.leaseExpiresAt && new Date(existing.leaseExpiresAt) > new Date();
      if (isLeaseActive) {
        throw new OutboxConflictError('Tin nhắn đang trong quá trình chuẩn bị gửi. Vui lòng không gửi lặp lại');
      }
    }

    if (existing.state === 'failed_before_dispatch' || existing.state === 'preparing') {
      const updated = await tx.zaloOutboundMessage.updateMany({
        where: {
          id: existing.id,
          leaseVersion: existing.leaseVersion,
        },
        data: {
          state: 'preparing',
          conversationId: params.conversationId ?? existing.conversationId,
          content: params.content ?? existing.content,
          attachments: params.attachments ?? existing.attachments,
          lastError: null,
          leaseOwner: workerId,
          leaseExpiresAt,
          requestStartedAt: null,
          leaseVersion: { increment: 1 },
        },
      });

      if (updated.count !== 1) {
        throw new OutboxConflictError();
      }

      return {
        status: 'claimed',
        outboxId: existing.id,
        idempotencyKey,
        leaseVersion: existing.leaseVersion + 1,
      };
    }

    throw new OutboxConflictError();
  }

  // 3. Fallback insert via Prisma create (for test mocks where $queryRaw is not mocked)
  const created = await tx.zaloOutboundMessage.create({
    data: {
      id: outboxId,
      orgId: params.orgId,
      accountId: params.accountId,
      threadId: params.threadId,
      conversationId: params.conversationId || null,
      idempotencyKey,
      requestHash,
      content: params.content || null,
      attachments: params.attachments || null,
      state: 'preparing',
      leaseOwner: workerId,
      leaseExpiresAt,
      leaseVersion: 1,
    },
  });

  return {
    status: 'claimed',
    outboxId: created.id,
    idempotencyKey,
    leaseVersion: created.leaseVersion ?? 1,
  };
}

/**
 * Atomically acquires a dispatch lease on a 'preparing' outbox row right before calling the Zalo SDK.
 * Only the winning worker may invoke the remote SDK.
 */
export async function claimDispatchSlot(
  tx: Prisma.TransactionClient,
  params: {
    outboxId: string;
    workerId: string;
    leaseVersion: number;
    durationMs?: number;
  }
): Promise<{ leaseVersion: number }> {
  const durationMs = params.durationMs ?? 30_000;
  const leaseExpiresAt = new Date(Date.now() + durationMs);

  const dispatch = await tx.zaloOutboundMessage.updateMany({
    where: {
      id: params.outboxId,
      state: 'preparing',
      leaseVersion: params.leaseVersion,
    },
    data: {
      state: 'dispatching',
      leaseOwner: params.workerId,
      leaseExpiresAt,
      requestStartedAt: new Date(),
      leaseVersion: { increment: 1 },
    },
  });

  if (dispatch.count !== 1) {
    throw new OutboxConflictError('Failed to acquire dispatch lease for outbound message');
  }

  return { leaseVersion: params.leaseVersion + 1 };
}

export interface CommitOutboxSuccessOptions {
  outboxId: string;
  messageId: string;
  remoteMsgIds: string[];
  leaseOwner?: string | null;
  leaseVersion?: number;
}

export async function commitOutboxSuccess(
  tx: Prisma.TransactionClient,
  outboxIdOrOptions: string | CommitOutboxSuccessOptions,
  messageIdCompat?: string,
  remoteMsgIdsCompat?: string[]
): Promise<boolean> {
  const outboxId = typeof outboxIdOrOptions === 'string' ? outboxIdOrOptions : outboxIdOrOptions.outboxId;
  const messageId = typeof outboxIdOrOptions === 'string' ? messageIdCompat! : outboxIdOrOptions.messageId;
  const remoteMsgIds = typeof outboxIdOrOptions === 'string' ? (remoteMsgIdsCompat || []) : outboxIdOrOptions.remoteMsgIds;
  const leaseOwner = typeof outboxIdOrOptions === 'object' ? outboxIdOrOptions.leaseOwner : undefined;
  const leaseVersion = typeof outboxIdOrOptions === 'object' ? outboxIdOrOptions.leaseVersion : undefined;

  const where: Prisma.ZaloOutboundMessageWhereInput = {
    id: outboxId,
    state: 'dispatching',
  };
  if (leaseOwner !== undefined) where.leaseOwner = leaseOwner;
  if (leaseVersion !== undefined) where.leaseVersion = leaseVersion;

  const result = await tx.zaloOutboundMessage.updateMany({
    where,
    data: {
      state: 'succeeded',
      messageId,
      remoteMsgIds,
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      leaseVersion: { increment: 1 },
    },
  });

  return result.count === 1;
}

export interface CommitOutboxUncertainOptions {
  outboxId: string;
  lastError: string;
  remoteMsgIds?: string[];
  leaseOwner?: string | null;
  leaseVersion?: number;
}

export async function commitOutboxUncertain(
  outboxIdOrOptions: string | CommitOutboxUncertainOptions,
  lastErrorCompat?: string,
  remoteMsgIdsCompat?: string[]
): Promise<boolean> {
  const outboxId = typeof outboxIdOrOptions === 'string' ? outboxIdOrOptions : outboxIdOrOptions.outboxId;
  const lastError = typeof outboxIdOrOptions === 'string' ? (lastErrorCompat || '') : outboxIdOrOptions.lastError;
  const remoteMsgIds = typeof outboxIdOrOptions === 'string' ? (remoteMsgIdsCompat || []) : (outboxIdOrOptions.remoteMsgIds || []);
  const leaseOwner = typeof outboxIdOrOptions === 'object' ? outboxIdOrOptions.leaseOwner : undefined;
  const leaseVersion = typeof outboxIdOrOptions === 'object' ? outboxIdOrOptions.leaseVersion : undefined;

  const where: Prisma.ZaloOutboundMessageWhereInput = {
    id: outboxId,
    state: 'dispatching',
  };
  if (leaseOwner !== undefined) where.leaseOwner = leaseOwner;
  if (leaseVersion !== undefined) where.leaseVersion = leaseVersion;

  try {
    const result = await prisma.zaloOutboundMessage.updateMany({
      where,
      data: {
        state: 'uncertain',
        lastError: (lastError || '').slice(0, 500),
        remoteMsgIds,
        leaseOwner: null,
        leaseExpiresAt: null,
        leaseVersion: { increment: 1 },
      },
    });
    return result.count === 1;
  } catch {
    return false;
  }
}

export interface CommitOutboxFailedOptions {
  outboxId: string;
  lastError: string;
  leaseVersion?: number;
}

export async function commitOutboxFailedBeforeDispatch(
  outboxIdOrOptions: string | CommitOutboxFailedOptions,
  lastErrorCompat?: string
): Promise<boolean> {
  const outboxId = typeof outboxIdOrOptions === 'string' ? outboxIdOrOptions : outboxIdOrOptions.outboxId;
  const lastError = typeof outboxIdOrOptions === 'string' ? (lastErrorCompat || '') : outboxIdOrOptions.lastError;
  const leaseVersion = typeof outboxIdOrOptions === 'object' ? outboxIdOrOptions.leaseVersion : undefined;

  const where: Prisma.ZaloOutboundMessageWhereInput = {
    id: outboxId,
    state: { in: ['preparing', 'failed_before_dispatch'] },
  };
  if (leaseVersion !== undefined) where.leaseVersion = leaseVersion;

  try {
    const result = await prisma.zaloOutboundMessage.updateMany({
      where,
      data: {
        state: 'failed_before_dispatch',
        lastError: (lastError || '').slice(0, 500),
        leaseOwner: null,
        leaseExpiresAt: null,
        leaseVersion: { increment: 1 },
      },
    });
    return result.count === 1;
  } catch {
    return false;
  }
}

/**
 * Periodically transitions expired 'dispatching' messages to 'uncertain'.
 * Never automatically reclaims or retries remote dispatching.
 */
export async function recoverExpiredOutboundDispatches(
  now = new Date(),
  client: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<number> {
  const result = await (client as any).zaloOutboundMessage.updateMany({
    where: {
      state: 'dispatching',
      leaseExpiresAt: { lt: now },
    },
    data: {
      state: 'uncertain',
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: 'Lease expired during dispatch; moved to uncertain for manual reconciliation',
      leaseVersion: { increment: 1 },
    },
  });
  return result.count;
}
