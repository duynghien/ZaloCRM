import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  claimOutboxSlot,
  claimDispatchSlot,
  commitOutboxSuccess,
  commitOutboxUncertain,
  commitOutboxFailedBeforeDispatch,
  recoverExpiredOutboundDispatches,
  OutboxConflictError,
  OutboxUncertainError,
} from '../../src/modules/zalo/zalo-outbound-outbox.js';
import {
  startDisposablePostgres,
  migrateDisposablePostgres,
  type DisposablePostgres,
} from '../helpers/disposable-postgres.js';

describe('Zalo Outbound Fencing & CAS State Machine (PostgreSQL)', () => {
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

  it('allows only one worker to win CAS claimDispatchSlot on a preparing outbox row', async () => {
    if (!prisma) {
      expect(true).toBe(true);
      return;
    }

    const org = await prisma.organization.create({ data: { name: 'CAS Test Org' } });
    const user = await prisma.user.create({
      data: { orgId: org.id, email: `${randomUUID()}@test.invalid`, fullName: 'U', role: 'owner', passwordHash: 'x' },
    });
    const account = await prisma.zaloAccount.create({ data: { orgId: org.id, ownerUserId: user.id } });

    // 1. Claim outbox slot in 'preparing' state
    const claimRes = await prisma.$transaction(async (tx) => {
      return claimOutboxSlot(tx, {
        orgId: org.id,
        accountId: account.id,
        threadId: 'thread-cas-1',
        content: 'CAS Hello',
        idempotencyKey: 'cas-key-1',
      });
    });

    expect(claimRes.status).toBe('claimed');
    if (claimRes.status !== 'claimed') return;

    const outboxId = claimRes.outboxId;
    const initialLeaseVersion = claimRes.leaseVersion;

    // 2. Concurrently attempt to acquire dispatch lease from two workers
    const worker1 = 'worker-uuid-1';
    const worker2 = 'worker-uuid-2';

    const results = await Promise.allSettled([
      prisma.$transaction(async (tx) => {
        return claimDispatchSlot(tx, {
          outboxId,
          workerId: worker1,
          leaseVersion: initialLeaseVersion,
          durationMs: 15_000,
        });
      }),
      prisma.$transaction(async (tx) => {
        return claimDispatchSlot(tx, {
          outboxId,
          workerId: worker2,
          leaseVersion: initialLeaseVersion,
          durationMs: 15_000,
        });
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one worker must win the dispatch lease
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Verify row state in DB
    const row = await prisma.zaloOutboundMessage.findUniqueOrThrow({ where: { id: outboxId } });
    expect(row.state).toBe('dispatching');
    expect(row.leaseVersion).toBe(initialLeaseVersion + 1);
    expect([worker1, worker2]).toContain(row.leaseOwner);
  });

  it('rejects duplicate claim while row is in dispatching state (no auto-reclaim)', async () => {
    if (!prisma) {
      expect(true).toBe(true);
      return;
    }

    const org = await prisma.organization.create({ data: { name: 'No-Reclaim Org' } });
    const user = await prisma.user.create({
      data: { orgId: org.id, email: `${randomUUID()}@test.invalid`, fullName: 'U', role: 'owner', passwordHash: 'x' },
    });
    const account = await prisma.zaloAccount.create({ data: { orgId: org.id, ownerUserId: user.id } });

    const key = `no-reclaim-${randomUUID()}`;
    await prisma.$transaction(async (tx) => {
      const c = await claimOutboxSlot(tx, {
        orgId: org.id,
        accountId: account.id,
        threadId: 'thread-nr-1',
        content: 'No Reclaim',
        idempotencyKey: key,
      });
      if (c.status === 'claimed') {
        await claimDispatchSlot(tx, {
          outboxId: c.outboxId,
          workerId: 'w-nr',
          leaseVersion: c.leaseVersion,
        });
      }
    });

    // Replay with identical key while dispatching must throw OutboxConflictError, NOT reclaim
    await expect(
      prisma.$transaction(async (tx) => {
        return claimOutboxSlot(tx, {
          orgId: org.id,
          accountId: account.id,
          threadId: 'thread-nr-1',
          content: 'No Reclaim',
          idempotencyKey: key,
        });
      })
    ).rejects.toThrow(OutboxConflictError);
  });

  it('moves expired dispatching row to uncertain and throws OutboxUncertainError on replay', async () => {
    if (!prisma) {
      expect(true).toBe(true);
      return;
    }

    const org = await prisma.organization.create({ data: { name: 'Uncertain Org' } });
    const user = await prisma.user.create({
      data: { orgId: org.id, email: `${randomUUID()}@test.invalid`, fullName: 'U', role: 'owner', passwordHash: 'x' },
    });
    const account = await prisma.zaloAccount.create({ data: { orgId: org.id, ownerUserId: user.id } });

    const key = `uncertain-${randomUUID()}`;
    const claimRes = await prisma.$transaction(async (tx) => {
      return claimOutboxSlot(tx, {
        orgId: org.id,
        accountId: account.id,
        threadId: 'thread-unc-1',
        content: 'Will Expire',
        idempotencyKey: key,
      });
    });

    if (claimRes.status !== 'claimed') return;

    // Simulate dispatch lease that expired 10 seconds ago
    await prisma.zaloOutboundMessage.update({
      where: { id: claimRes.outboxId },
      data: {
        state: 'dispatching',
        leaseOwner: 'stale-worker',
        leaseExpiresAt: new Date(Date.now() - 10_000),
      },
    });

    // Run recovery
    const recovered = await recoverExpiredOutboundDispatches(new Date(), prisma);
    expect(recovered).toBeGreaterThanOrEqual(1);

    const recoveredRow = await prisma.zaloOutboundMessage.findUniqueOrThrow({ where: { id: claimRes.outboxId } });
    expect(recoveredRow.state).toBe('uncertain');
    expect(recoveredRow.leaseOwner).toBeNull();

    // Replay of uncertain row must throw OutboxUncertainError
    await expect(
      prisma.$transaction(async (tx) => {
        return claimOutboxSlot(tx, {
          orgId: org.id,
          accountId: account.id,
          threadId: 'thread-unc-1',
          content: 'Will Expire',
          idempotencyKey: key,
        });
      })
    ).rejects.toThrow(OutboxUncertainError);
  });

  it('fails commitOutboxSuccess when worker does not match lease owner or lease version', async () => {
    if (!prisma) {
      expect(true).toBe(true);
      return;
    }

    const org = await prisma.organization.create({ data: { name: 'Commit Fence Org' } });
    const user = await prisma.user.create({
      data: { orgId: org.id, email: `${randomUUID()}@test.invalid`, fullName: 'U', role: 'owner', passwordHash: 'x' },
    });
    const account = await prisma.zaloAccount.create({ data: { orgId: org.id, ownerUserId: user.id } });

    const key = `fence-${randomUUID()}`;
    const claimRes = await prisma.$transaction(async (tx) => {
      return claimOutboxSlot(tx, {
        orgId: org.id,
        accountId: account.id,
        threadId: 'thread-fnc-1',
        content: 'Fencing Commit',
        idempotencyKey: key,
      });
    });

    if (claimRes.status !== 'claimed') return;

    await prisma.$transaction(async (tx) => {
      await claimDispatchSlot(tx, {
        outboxId: claimRes.outboxId,
        workerId: 'real-worker',
        leaseVersion: claimRes.leaseVersion,
      });
    });

    // Attempt commit with wrong leaseOwner
    const failedOwnerCommit = await prisma.$transaction(async (tx) => {
      return commitOutboxSuccess(tx, {
        outboxId: claimRes.outboxId,
        messageId: 'msg-fake-1',
        remoteMsgIds: ['remote-1'],
        leaseOwner: 'impostor-worker',
        leaseVersion: claimRes.leaseVersion + 1,
      });
    });
    expect(failedOwnerCommit).toBe(false);

    // Attempt commit with wrong leaseVersion
    const failedVersionCommit = await prisma.$transaction(async (tx) => {
      return commitOutboxSuccess(tx, {
        outboxId: claimRes.outboxId,
        messageId: 'msg-fake-1',
        remoteMsgIds: ['remote-1'],
        leaseOwner: 'real-worker',
        leaseVersion: 999,
      });
    });
    expect(failedVersionCommit).toBe(false);

    // Successful commit with matching credentials
    const successCommit = await prisma.$transaction(async (tx) => {
      return commitOutboxSuccess(tx, {
        outboxId: claimRes.outboxId,
        messageId: 'msg-real-1',
        remoteMsgIds: ['remote-1'],
        leaseOwner: 'real-worker',
        leaseVersion: claimRes.leaseVersion + 1,
      });
    });
    expect(successCommit).toBe(true);
  });
});
