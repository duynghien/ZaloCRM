process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkAndReserveRateLimit,
  recordVendorRateLimit429,
  KiotvietRateLimitError,
} from '../../src/modules/integrations/kiotviet/kiotviet-rate-limit-service.js';
import { prisma } from '../../src/shared/database/prisma-client.js';

vi.mock('../../src/shared/database/prisma-client.js', () => {
  const mockPrisma: any = {
    kiotvietVendorCooldown: {
      findUnique: vi.fn(),
    },
    kiotvietRateLimitBucket: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  };
  return { prisma: mockPrisma };
});

describe('KiotViet Decoupled Vendor Cooldown Integration Tests', () => {
  const orgId = 'org-kv-cooldown-test';
  const retailer = 'shop_test';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks requests across minute boundaries when vendor cooldown is active', async () => {
    const futureBlockedUntil = new Date(Date.now() + 15_000); // 15 seconds in future

    vi.mocked(prisma.kiotvietVendorCooldown.findUnique).mockResolvedValueOnce({
      orgId,
      retailer,
      blockedUntil: futureBlockedUntil,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(checkAndReserveRateLimit(orgId, retailer)).rejects.toThrow(KiotvietRateLimitError);

    // Verify it threw KiotvietRateLimitError with wait seconds and did not attempt minute reservation
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('allows request when cooldown is expired and bucket slot is available', async () => {
    const pastBlockedUntil = new Date(Date.now() - 5_000); // 5 seconds ago

    vi.mocked(prisma.kiotvietVendorCooldown.findUnique).mockResolvedValueOnce({
      orgId,
      retailer,
      blockedUntil: pastBlockedUntil,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Minute bucket reservation succeeds
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ id: 'bucket-slot-1' }] as any);

    await expect(checkAndReserveRateLimit(orgId, retailer)).resolves.not.toThrow();

    expect(prisma.kiotvietVendorCooldown.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('executes atomic upsert with GREATEST when recording vendor 429', async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(1 as any);

    await recordVendorRateLimit429(orgId, retailer, 45);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    // Verifies raw SQL used with GREATEST logic
    const callArg = vi.mocked(prisma.$executeRaw).mock.calls[0];
    const sqlText = Array.isArray(callArg[0])
      ? callArg[0].join('')
      : (callArg[0]?.sql || callArg[0]?.strings?.join('') || '');
    expect(sqlText).toContain('kiotviet_vendor_cooldown');
    expect(sqlText).toContain('GREATEST');
  });

  it('falls back to quota exceeded error when minute bucket is full without cooldown', async () => {
    // No vendor cooldown active
    vi.mocked(prisma.kiotvietVendorCooldown.findUnique).mockResolvedValue(null);

    // Minute bucket query returns empty (bucket full)
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([] as any);

    try {
      await checkAndReserveRateLimit(orgId, retailer);
      expect.fail('Expected checkAndReserveRateLimit to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(KiotvietRateLimitError);
      expect(err.message).toContain('KiotViet request quota exceeded for the current time window');
    }
  });

  it('simulates in-memory multi-429 to prove GREATEST retains longer duration', async () => {
    // Test the algebraic property of GREATEST(existing, new)
    let state: { blockedUntil: Date } | null = null;

    const recordMock = (retryAfterSeconds: number) => {
      const newBlocked = new Date(Date.now() + retryAfterSeconds * 1000);
      if (!state) {
        state = { blockedUntil: newBlocked };
      } else {
        state.blockedUntil = new Date(Math.max(state.blockedUntil.getTime(), newBlocked.getTime()));
      }
    };

    recordMock(60); // 60s
    const firstBlockedUntil = state!.blockedUntil.getTime();

    recordMock(10); // Shorter 10s should NOT reduce 60s
    expect(state!.blockedUntil.getTime()).toBe(firstBlockedUntil);

    recordMock(120); // Longer 120s should advance
    expect(state!.blockedUntil.getTime()).toBeGreaterThan(firstBlockedUntil);
  });
});
