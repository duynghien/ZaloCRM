import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetCronLeases } from '../../scripts/reset-cron-leases.js';

describe('Operator Cron Lease Reset Script & Audit Logging', () => {
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn(),
      cronJobLease: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      cronJobLeaseReset: {
        createMany: vi.fn(),
      },
    };
  });

  it('rejects without a valid operator email', async () => {
    await expect(
      resetCronLeases({ actor: 'not-an-email', reason: 'Emergency maintenance', lockId: 100 }, mockPrisma)
    ).rejects.toThrow('Valid operator email');
  });

  it('rejects without a sufficient reason', async () => {
    await expect(
      resetCronLeases({ actor: 'admin@example.com', reason: 'fix', lockId: 100 }, mockPrisma)
    ).rejects.toThrow('detailed reason');
  });

  it('rejects when neither lockId nor all is provided', async () => {
    await expect(
      resetCronLeases({ actor: 'admin@example.com', reason: 'Emergency maintenance' }, mockPrisma)
    ).rejects.toThrow('Either --lock-id <id> or (--all and --confirm-all) must be specified');
  });

  it('rejects --all without --confirm-all', async () => {
    await expect(
      resetCronLeases({ actor: 'admin@example.com', reason: 'Emergency maintenance', all: true }, mockPrisma)
    ).rejects.toThrow('--confirm-all is mandatory');
  });

  it('resets a specific lock and writes an audit log in the same transaction', async () => {
    const lockId = 1001n;
    const expiresAt = new Date(Date.now() + 60_000);
    mockPrisma.cronJobLease.findUnique.mockResolvedValueOnce({
      lockId,
      jobName: 'orphan_attachment_cleanup',
      leaseOwner: 'worker-dead-1',
      leaseExpiresAt: expiresAt,
    });

    const res = await resetCronLeases(
      {
        actor: 'operator@internal.corp',
        reason: 'Worker crashed during node restart',
        lockId: 1001,
      },
      mockPrisma
    );

    expect(res.resetCount).toBe(1);
    expect(res.leases[0].lockId).toBe('1001');
    expect(res.leases[0].priorOwner).toBe('worker-dead-1');

    // Audit log was recorded
    expect(mockPrisma.cronJobLeaseReset.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          lockId,
          jobName: 'orphan_attachment_cleanup',
          priorOwner: 'worker-dead-1',
          actor: 'operator@internal.corp',
          reason: 'Worker crashed during node restart',
        }),
      ],
    });

    // Lease was cleared
    expect(mockPrisma.cronJobLease.update).toHaveBeenCalledWith({
      where: { lockId },
      data: { leaseOwner: null, leaseExpiresAt: null },
    });
  });

  it('resets all locks when --all --confirm-all are supplied', async () => {
    mockPrisma.cronJobLease.findMany.mockResolvedValueOnce([
      { lockId: 1001n, jobName: 'job1', leaseOwner: 'w1', leaseExpiresAt: new Date() },
      { lockId: 1002n, jobName: 'job2', leaseOwner: 'w2', leaseExpiresAt: new Date() },
    ]);

    const res = await resetCronLeases(
      {
        actor: 'lead-devops@internal.corp',
        reason: 'Cluster disaster recovery failover',
        all: true,
        confirmAll: true,
      },
      mockPrisma
    );

    expect(res.resetCount).toBe(2);
    expect(mockPrisma.cronJobLeaseReset.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ lockId: 1001n, jobName: 'job1', actor: 'lead-devops@internal.corp' }),
        expect.objectContaining({ lockId: 1002n, jobName: 'job2', actor: 'lead-devops@internal.corp' }),
      ]),
    });
    expect(mockPrisma.cronJobLease.updateMany).toHaveBeenCalledWith({
      data: { leaseOwner: null, leaseExpiresAt: null },
    });
  });
});
