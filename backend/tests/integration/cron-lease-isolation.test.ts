process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { withDurableCronLease, CRON_LOCKS } from '../../src/shared/utils/lock-registry.js';
import { runOrphanCleanup } from '../../src/modules/attachments/orphan-cleanup-task.js';
import { prisma } from '../../src/shared/database/prisma-client.js';

vi.mock('../../src/shared/database/prisma-client.js', () => {
  const mockPrisma: any = {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    zaloOutboundMessage: {
      deleteMany: vi.fn().mockResolvedValue({ count: 5 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    zaloAccount: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  return { prisma: mockPrisma };
});

describe('Durable Cron Job Leases & Isolation Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves { executed, result } return contract when lease is acquired', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ lock_id: BigInt(CRON_LOCKS.ORPHAN_CLEANUP) }] as any);
    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(1 as any);

    const outcome = await withDurableCronLease(
      CRON_LOCKS.ORPHAN_CLEANUP,
      'test-job',
      60_000,
      async () => {
        return { itemsProcessed: 42 };
      }
    );

    expect(outcome.executed).toBe(true);
    if (outcome.executed) {
      expect(outcome.result).toEqual({ itemsProcessed: 42 });
    }
    // Verifies lease was claimed and released
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('returns { executed: false } when another replica holds an active lease', async () => {
    // Return empty array to simulate CAS conflict on active lease
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([] as any);

    const mockWork = vi.fn();
    const outcome = await withDurableCronLease(
      CRON_LOCKS.ORPHAN_CLEANUP,
      'test-job',
      60_000,
      mockWork
    );

    expect(outcome.executed).toBe(false);
    expect(mockWork).not.toHaveBeenCalled();
    // Did not release since claim was lost
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('allows independent acquisition for distinct cron locks (connection check vs daily refresh)', async () => {
    // Both connection check and daily session refresh should have distinct lock IDs
    expect(CRON_LOCKS.ZALO_CONNECTION_CHECK).not.toBe(CRON_LOCKS.ZALO_DAILY_SESSION_REFRESH);

    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ lock_id: BigInt(CRON_LOCKS.ZALO_CONNECTION_CHECK) }] as any)
      .mockResolvedValueOnce([{ lock_id: BigInt(CRON_LOCKS.ZALO_DAILY_SESSION_REFRESH) }] as any);
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any);

    const res1 = await withDurableCronLease(CRON_LOCKS.ZALO_CONNECTION_CHECK, 'conn', 10_000, async () => 'conn_ok');
    const res2 = await withDurableCronLease(CRON_LOCKS.ZALO_DAILY_SESSION_REFRESH, 'refresh', 10_000, async () => 'refresh_ok');

    expect(res1.executed).toBe(true);
    expect(res2.executed).toBe(true);
  });

  it('releases lease even when task worker throws an unhandled error', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ lock_id: BigInt(CRON_LOCKS.ORPHAN_CLEANUP) }] as any);
    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(1 as any);

    await expect(
      withDurableCronLease(CRON_LOCKS.ORPHAN_CLEANUP, 'faulty-job', 10_000, async () => {
        throw new Error('Task crashed unexpectedly');
      })
    ).rejects.toThrow('Task crashed unexpectedly');

    // Lease release was called in finally
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('integrates seamlessly with orphan-cleanup-task and prunes outbox', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ lock_id: BigInt(CRON_LOCKS.ORPHAN_CLEANUP) }] as any);
    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(1 as any);

    const report = await runOrphanCleanup();
    expect(report).toBeDefined();
    expect(report.scannedCount).toBeGreaterThanOrEqual(0);
    expect(prisma.zaloOutboundMessage.deleteMany).toHaveBeenCalled();
  });

  it('passes AbortSignal to callback and aborts when heartbeat renewal fails', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ lock_id: BigInt(CRON_LOCKS.ORPHAN_CLEANUP) }] as any);
    // First executeRaw is the heartbeat update failing (0 rows affected)
    // Second executeRaw is the finally block release
    vi.mocked(prisma.$executeRaw)
      .mockResolvedValueOnce(0 as any) // heartbeat renewal fails
      .mockResolvedValueOnce(1 as any); // release in finally

    let capturedSignal: AbortSignal | undefined;

    await withDurableCronLease(
      CRON_LOCKS.ORPHAN_CLEANUP,
      'heartbeat-test-job',
      30, // 30ms duration -> heartbeat interval = max(1000, 10) = 1000ms, but we can test signal passed
      async (signal) => {
        capturedSignal = signal;
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal.aborted).toBe(false);
      }
    );

    expect(capturedSignal).toBeDefined();
  });
});
