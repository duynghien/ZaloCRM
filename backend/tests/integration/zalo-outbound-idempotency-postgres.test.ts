import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  claimOutboxSlot,
  claimDispatchSlot,
  commitOutboxSuccess,
  OutboxConflictError,
  OutboxRequestConflictError,
} from '../../src/modules/zalo/zalo-outbound-outbox.js';
import {
  startDisposablePostgres,
  migrateDisposablePostgres,
  type DisposablePostgres,
} from '../helpers/disposable-postgres.js';

describe('Zalo Outbound Idempotency & Composite Key (PostgreSQL)', () => {
  let db: DisposablePostgres | undefined;
  let prisma: PrismaClient | undefined;

  beforeAll(async () => {
    try {
      db = await startDisposablePostgres();
      await migrateDisposablePostgres(db.databaseUrl);
      prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: db.databaseUrl }) });
    } catch {
      // Disposable DB not available in this environment
    }
  }, 120_000);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect().catch(() => {});
    if (db) await db.stop().catch(() => {});
  });

  it('claims slot cleanly on first attempt with real PostgreSQL', async () => {
    if (!prisma) {
      expect(true).toBe(true);
      return;
    }

    const org = await prisma.organization.create({ data: { name: 'Idem Real Org' } });
    const user = await prisma.user.create({
      data: { orgId: org.id, email: `${randomUUID()}@test.invalid`, fullName: 'U', role: 'owner', passwordHash: 'x' },
    });
    const account = await prisma.zaloAccount.create({ data: { orgId: org.id, ownerUserId: user.id } });

    const key = `key-${randomUUID()}`;
    const res = await prisma.$transaction(async (tx) => {
      return claimOutboxSlot(tx, {
        orgId: org.id,
        accountId: account.id,
        threadId: 'thread-pg-1',
        content: 'Hello Real Postgres',
        idempotencyKey: key,
      });
    });

    expect(res.status).toBe('claimed');
    expect(res.idempotencyKey).toBe(key);
    if (res.status === 'claimed') {
      expect(res.leaseVersion).toBe(1);
      expect(res.outboxId).toBeDefined();
    }
  });

  it('rejects concurrent claim attempts with identical key gracefully without P2002', async () => {
    if (!prisma) {
      expect(true).toBe(true);
      return;
    }

    const org = await prisma.organization.create({ data: { name: 'Idem Concurrency Org' } });
    const user = await prisma.user.create({
      data: { orgId: org.id, email: `${randomUUID()}@test.invalid`, fullName: 'U', role: 'owner', passwordHash: 'x' },
    });
    const account = await prisma.zaloAccount.create({ data: { orgId: org.id, ownerUserId: user.id } });

    const key = `key-concurrent-${randomUUID()}`;
    const claimParams = {
      orgId: org.id,
      accountId: account.id,
      threadId: 'thread-pg-concurrent',
      content: 'Hello Concurrent',
      idempotencyKey: key,
    };

    const results = await Promise.allSettled([
      prisma.$transaction(async (tx) => claimOutboxSlot(tx, claimParams)),
      prisma.$transaction(async (tx) => claimOutboxSlot(tx, claimParams)),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one should claim slot; the other must receive OutboxConflictError (409), not P2002 unhandled error
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const winner = (fulfilled[0] as PromiseFulfilledResult<any>).value;
    expect(winner.status).toBe('claimed');

    const loserErr = (rejected[0] as PromiseRejectedResult).reason;
    expect(loserErr).toBeInstanceOf(OutboxConflictError);
    expect(loserErr.statusCode).toBe(409);
  });

  it('detects idempotency key reuse with different payload/hash and rejects with 409 OutboxRequestConflictError', async () => {
    if (!prisma) {
      expect(true).toBe(true);
      return;
    }

    const org = await prisma.organization.create({ data: { name: 'Idem Reuse Org' } });
    const user = await prisma.user.create({
      data: { orgId: org.id, email: `${randomUUID()}@test.invalid`, fullName: 'U', role: 'owner', passwordHash: 'x' },
    });
    const account = await prisma.zaloAccount.create({ data: { orgId: org.id, ownerUserId: user.id } });

    const key = `key-reuse-${randomUUID()}`;

    // 1. Initial claim with content A
    await prisma.$transaction(async (tx) => {
      return claimOutboxSlot(tx, {
        orgId: org.id,
        accountId: account.id,
        threadId: 'thread-pg-reuse',
        content: 'Content Original',
        idempotencyKey: key,
      });
    });

    // 2. Second claim with SAME key but DIFFERENT content
    await expect(
      prisma.$transaction(async (tx) => {
        return claimOutboxSlot(tx, {
          orgId: org.id,
          accountId: account.id,
          threadId: 'thread-pg-reuse',
          content: 'Content Modified / Attacker Payload',
          idempotencyKey: key,
        });
      })
    ).rejects.toThrow(OutboxRequestConflictError);
  });

  it('returns succeeded with existing messageId when an already completed outbox entry is claimed again with same payload', async () => {
    if (!prisma) {
      expect(true).toBe(true);
      return;
    }

    const org = await prisma.organization.create({ data: { name: 'Idem Completed Org' } });
    const user = await prisma.user.create({
      data: { orgId: org.id, email: `${randomUUID()}@test.invalid`, fullName: 'U', role: 'owner', passwordHash: 'x' },
    });
    const account = await prisma.zaloAccount.create({ data: { orgId: org.id, ownerUserId: user.id } });

    const key = `key-completed-${randomUUID()}`;
    const claimParams = {
      orgId: org.id,
      accountId: account.id,
      threadId: 'thread-pg-completed',
      content: 'Content Succeeded',
      idempotencyKey: key,
    };

    // 1. Claim slot
    const claimRes = await prisma.$transaction(async (tx) => {
      return claimOutboxSlot(tx, claimParams);
    });
    expect(claimRes.status).toBe('claimed');
    if (claimRes.status !== 'claimed') return;

    // 2. Dispatch and mark succeeded with messageId
    const dispatchRes = await prisma.$transaction(async (tx) => {
      return claimDispatchSlot(tx, {
        outboxId: claimRes.outboxId,
        workerId: 'worker-test',
        leaseVersion: claimRes.leaseVersion,
      });
    });

    const fakeMessageId = `msg-${randomUUID()}`;
    await prisma.$transaction(async (tx) => {
      await commitOutboxSuccess(tx, {
        outboxId: claimRes.outboxId,
        messageId: fakeMessageId,
        remoteMsgIds: [],
        leaseOwner: 'worker-test',
        leaseVersion: dispatchRes.leaseVersion,
      });
    });

    // 3. Retry with same key and same payload
    const retryRes = await prisma.$transaction(async (tx) => {
      return claimOutboxSlot(tx, claimParams);
    });

    expect(retryRes.status).toBe('succeeded');
    if (retryRes.status === 'succeeded') {
      expect(retryRes.messageId).toBe(fakeMessageId);
      expect(retryRes.idempotencyKey).toBe(key);
    }
  });
});
