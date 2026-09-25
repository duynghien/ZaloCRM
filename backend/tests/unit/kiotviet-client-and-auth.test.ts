process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getKiotvietAccessToken,
  invalidateKiotvietToken,
  clearKiotvietTokenCache,
  KiotvietAuthError,
} from '../../src/modules/integrations/kiotviet/kiotviet-auth-service.js';
import {
  checkAndReserveRateLimit,
  recordVendorRateLimit429,
  KiotvietRateLimitError,
} from '../../src/modules/integrations/kiotviet/kiotviet-rate-limit-service.js';
import {
  serializeBigIntAndDecimal,
  sanitizeProductDto,
} from '../../src/modules/integrations/kiotviet/kiotviet-serializer.js';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { Prisma } from '@prisma/client';
import { searchKiotvietCustomersByPhone } from '../../src/modules/integrations/kiotviet/kiotviet-client.js';
import { normalizeVietnamesePhoneNumberVariants } from '../../src/shared/utils/phone-utils.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('../../src/shared/database/prisma-client.js', () => {
  const mockPrisma: any = {
    kiotvietRateLimitBucket: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    kiotvietVendorCooldown: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
    kiotvietSyncState: {
      findUnique: vi.fn(),
    },
    kiotvietProduct: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  return { prisma: mockPrisma };
});

describe('KiotViet Auth Service', () => {
  beforeEach(() => {
    clearKiotvietTokenCache();
    vi.clearAllMocks();
  });

  it('retrieves and caches access token with single-flight deduplication', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'test-token-xyz',
        expires_in: 3600,
      }),
    });

    const config = {
      clientId: 'c1',
      clientSecret: 's1',
      retailer: 'r1',
      branchId: '1',
      autoSync: false,
      soldById: null,
      paymentAccountId: null,
      configRevision: 1,
    };

    // Parallel calls should trigger only 1 fetch call
    const [t1, t2] = await Promise.all([
      getKiotvietAccessToken('org-1', config),
      getKiotvietAccessToken('org-1', config),
    ]);

    expect(t1).toBe('test-token-xyz');
    expect(t2).toBe('test-token-xyz');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Subsequent call should use cache
    const t3 = await getKiotvietAccessToken('org-1', config);
    expect(t3).toBe('test-token-xyz');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes token after invalidation', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'token-1', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'token-2', expires_in: 3600 }),
      });

    const config = {
      clientId: 'c1',
      clientSecret: 's1',
      retailer: 'r1',
      branchId: '1',
      autoSync: false,
      soldById: null,
      paymentAccountId: null,
      configRevision: 1,
    };

    const first = await getKiotvietAccessToken('org-1', config);
    expect(first).toBe('token-1');

    invalidateKiotvietToken('org-1');

    const second = await getKiotvietAccessToken('org-1', config);
    expect(second).toBe('token-2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('handles auth rejection with KiotvietAuthError', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_client', error_description: 'Client not found' }),
    });

    const config = {
      clientId: 'bad-client',
      clientSecret: 's1',
      retailer: 'r1',
      branchId: '1',
      autoSync: false,
      soldById: null,
      paymentAccountId: null,
      configRevision: 1,
    };

    await expect(getKiotvietAccessToken('org-1', config)).rejects.toThrow(KiotvietAuthError);
  });
});

describe('KiotViet Rate Limit Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows reservation when bucket is under quota', async () => {
    (prisma.$queryRaw as any).mockResolvedValueOnce([{ id: '1', request_count: 1 }]);

    await expect(checkAndReserveRateLimit('org-1', 'retailer-1')).resolves.not.toThrow();
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('blocks request if blockedUntil is in the future', async () => {
    (prisma.$queryRaw as any).mockResolvedValueOnce([]);
    const future = new Date(Date.now() + 30_000);
    (prisma.kiotvietRateLimitBucket.findUnique as any).mockResolvedValueOnce({
      blockedUntil: future,
      requestCount: 5,
    });

    await expect(checkAndReserveRateLimit('org-1', 'retailer-1')).rejects.toThrow(KiotvietRateLimitError);
  });

  it('records 429 response and sets blockedUntil', async () => {
    await recordVendorRateLimit429('org-1', 'retailer-1', 45);
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });
});

describe('KiotViet Serializer', () => {
  it('serializes BigInt and Decimal recursively', () => {
    const data = {
      id: 'uuid-1',
      bigId: BigInt(123456789012345),
      nested: {
        price: new Prisma.Decimal('150000.50'),
        quantity: new Prisma.Decimal(3),
        tags: [BigInt(1), BigInt(2)],
      },
      date: new Date('2026-09-21T10:00:00.000Z'),
    };

    const serialized = serializeBigIntAndDecimal(data);
    expect(serialized).toEqual({
      id: 'uuid-1',
      bigId: '123456789012345',
      nested: {
        price: 150000.5,
        quantity: 3,
        tags: ['1', '2'],
      },
      date: '2026-09-21T10:00:00.000Z',
    });
  });

  it('sanitizes product DTO to prevent leaking cost and raw attributes', () => {
    const rawProduct = {
      id: 'p1',
      code: 'SP01',
      name: 'Product 1',
      unit: 'cái',
      price: new Prisma.Decimal('250000'),
      onHand: new Prisma.Decimal('10.5'),
      cost: new Prisma.Decimal('180000'), // wholesale cost
      rawAttributes: { supplier: 'Supplier A', internalNotes: 'secret' },
    };

    const sanitized = sanitizeProductDto(rawProduct);
    expect(sanitized).toEqual({
      id: 'p1',
      code: 'SP01',
      name: 'Product 1',
      unit: 'cái',
      price: 250000,
      onHand: 10.5,
    });
    expect((sanitized as any).cost).toBeUndefined();
    expect((sanitized as any).rawAttributes).toBeUndefined();
  });
});

describe('Phone Normalization & Customer Search', () => {
  it('normalizes Vietnamese phone numbers into dual variants', () => {
    expect(normalizeVietnamesePhoneNumberVariants('0901234567')).toEqual(['0901234567', '84901234567']);
    expect(normalizeVietnamesePhoneNumberVariants('+84901234567')).toEqual(['0901234567', '84901234567']);
    expect(normalizeVietnamesePhoneNumberVariants('84901234567')).toEqual(['0901234567', '84901234567']);
    expect(normalizeVietnamesePhoneNumberVariants('090 123 4567')).toEqual(['0901234567', '84901234567']);
  });

  it('searches customer variants in parallel and deduplicates records by id', async () => {
    clearKiotvietTokenCache();
    (prisma.$queryRaw as any).mockResolvedValue([{ id: '1', request_count: 1 }]);
    mockFetch.mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/connect/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'token-test', expires_in: 3600 }),
        };
      }
      if (urlStr.includes('contactNumber=0901234567')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: 101, code: 'KH01', name: 'Nguyen Van A', contactNumber: '0901234567', address: 'Hanoi' },
            ],
          }),
        };
      }
      if (urlStr.includes('contactNumber=84901234567')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: 101, code: 'KH01', name: 'Nguyen Van A', contactNumber: '84901234567', address: 'Hanoi' },
              { id: 102, code: 'KH02', name: 'Nguyen Van B', contactNumber: '84901234567', address: 'HCMC' },
            ],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      };
    });

    const config = {
      clientId: 'c1',
      clientSecret: 's1',
      retailer: 'r1',
      branchId: '1',
      autoSync: false,
      soldById: null,
      paymentAccountId: null,
      configRevision: 1,
    };

    const customers = await searchKiotvietCustomersByPhone('org-1', config, '0901234567');
    expect(customers).toHaveLength(2);
    expect(customers[0].id).toBe('101');
    expect(customers[1].id).toBe('102');
  });
});

