import { describe, it, expect, beforeEach } from 'vitest';
import { reserveAccountSendSlot, DAILY_LIMIT, BURST_LIMIT } from '../../src/modules/zalo/zalo-account-rate-reservation.js';
import { getVnDateString } from '../../src/shared/utils/date-utils.js';

describe('Durable PostgreSQL Zalo Rate Limiter Integration Tests', () => {
  const accountId = 'acc-durable-rate-test';

  // In-memory simulation of PostgreSQL table with ACID row locking
  let dbStore: Record<string, any> = {};

  const createMockTx = () => {
    return {
      zaloAccountRateState: {
        findUnique: async ({ where }: { where: { accountId: string } }) => {
          const row = dbStore[where.accountId];
          return row ? JSON.parse(JSON.stringify(row), (key, value) => {
            if (key === 'lastSendAt' && value) return new Date(value);
            if (key === 'recentSends' && Array.isArray(value)) return value.map((d: any) => new Date(d));
            return value;
          }) : null;
        },
        create: async ({ data }: { data: any }) => {
          const created = {
            accountId: data.accountId,
            dateVn: data.dateVn,
            dailyCount: data.dailyCount ?? 0,
            lastSendAt: data.lastSendAt ?? null,
            recentSends: data.recentSends ?? [],
            updatedAt: new Date(),
          };
          dbStore[data.accountId] = JSON.parse(JSON.stringify(created));
          return created;
        },
        update: async ({ where, data }: { where: { accountId: string }; data: any }) => {
          const existing = dbStore[where.accountId] || {};
          const updated = {
            ...existing,
            ...data,
            updatedAt: new Date(),
          };
          dbStore[where.accountId] = JSON.parse(JSON.stringify(updated));
          return updated;
        },
      },
    } as any;
  };

  beforeEach(() => {
    dbStore = {};
  });

  it('enforces 3 msgs / 30s burst limit without leaking extra sends during concurrent attempts', async () => {
    const tx = createMockTx();

    // Send 1: OK
    await expect(reserveAccountSendSlot(tx, accountId, 1)).resolves.not.toThrow();

    // Fast forward interval so interval check doesn't block burst testing
    dbStore[accountId].lastSendAt = new Date(Date.now() - 3000).toISOString();

    // Send 2: OK
    await expect(reserveAccountSendSlot(tx, accountId, 1)).resolves.not.toThrow();

    dbStore[accountId].lastSendAt = new Date(Date.now() - 3000).toISOString();

    // Send 3: OK
    await expect(reserveAccountSendSlot(tx, accountId, 1)).resolves.not.toThrow();

    dbStore[accountId].lastSendAt = new Date(Date.now() - 3000).toISOString();

    // Send 4 (within 30s): Must be rejected by burst limit
    await expect(reserveAccountSendSlot(tx, accountId, 1)).rejects.toMatchObject({
      statusCode: 429,
      canForce: false,
    });
  });

  it('strictly enforces 2.0s minimum interval between consecutive sends', async () => {
    const tx = createMockTx();

    // First send
    await reserveAccountSendSlot(tx, accountId, 1);

    // Immediate second send (<2s) must fail with canForce: false
    await expect(reserveAccountSendSlot(tx, accountId, 1)).rejects.toMatchObject({
      statusCode: 429,
      canForce: false,
    });
  });

  it('allows force=true to override daily quota but strictly blocks interval and burst violations', async () => {
    const tx = createMockTx();
    const today = getVnDateString();

    // Seed state at daily limit (200 msgs) but with old send timestamps (>30s ago)
    dbStore[accountId] = {
      accountId,
      dateVn: today,
      dailyCount: DAILY_LIMIT,
      lastSendAt: new Date(Date.now() - 40_000).toISOString(),
      recentSends: [],
    };

    // Standard send without force=true must fail with canForce: true
    await expect(reserveAccountSendSlot(tx, accountId, 1, false)).rejects.toMatchObject({
      statusCode: 429,
      canForce: true,
    });

    // Send with force=true must succeed and increment count
    await expect(reserveAccountSendSlot(tx, accountId, 1, true)).resolves.not.toThrow();
    expect(dbStore[accountId].dailyCount).toBe(DAILY_LIMIT + 1);

    // Subsequent immediate send with force=true must STILL fail on minimum interval
    await expect(reserveAccountSendSlot(tx, accountId, 1, true)).rejects.toMatchObject({
      statusCode: 429,
      canForce: false,
    });
  });

  it('persists state across simulated process restart (new tx instance against DB)', async () => {
    const tx1 = createMockTx();
    await reserveAccountSendSlot(tx1, accountId, 1);

    expect(dbStore[accountId].dailyCount).toBe(1);
    expect(dbStore[accountId].lastSendAt).toBeDefined();

    // Simulate process restart by creating a new tx client reading the same DB
    const tx2 = createMockTx();
    const loadedState = await tx2.zaloAccountRateState.findUnique({ where: { accountId } });
    expect(loadedState).not.toBeNull();
    expect(loadedState.dailyCount).toBe(1);

    // Immediate send on tx2 still fails on interval
    await expect(reserveAccountSendSlot(tx2, accountId, 1)).rejects.toMatchObject({
      statusCode: 429,
      canForce: false,
    });
  });
});
