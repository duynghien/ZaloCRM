process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import { publicApiRoutes } from '../../src/modules/api/public-api-routes.js';
import { prisma } from '../../src/shared/database/prisma-client.js';

vi.mock('../../src/shared/database/prisma-client.js', () => {
  const mockPrisma: any = {
    apiKey: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    apiKeyRateLimitBucket: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ request_count: 1 }]),
    contact: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    order: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), create: vi.fn() },
    $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
  };
  return { prisma: mockPrisma };
});

describe('Multi-Key API Authentication & Scope Guard Integration Tests', () => {
  const orgId = 'org-multi-key-test';
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ request_count: 1 }] as any);
    app = Fastify();
    await app.register(publicApiRoutes);
    await app.ready();
  });

  it('rejects requests with missing or invalid API key with 401', async () => {
    const noKeyRes = await app.inject({ method: 'GET', url: '/api/public/contacts' });
    expect(noKeyRes.statusCode).toBe(401);
    expect(JSON.parse(noKeyRes.body).error).toBe('API key required');

    vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce(null);

    const badKeyRes = await app.inject({
      method: 'GET',
      url: '/api/public/contacts',
      headers: { 'x-api-key': 'zcrm_invalid_key_value_123' },
    });
    expect(badKeyRes.statusCode).toBe(401);
    expect(JSON.parse(badKeyRes.body).error).toBe('Invalid API key');
  });

  it('allows access when API key has required scope', async () => {
    const rawKey = 'zcrm_valid_orders_key_1234567890';
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce({
      id: 'key-1',
      orgId,
      keyHash,
      keyPrefix: rawKey.slice(0, 12),
      scopes: ['orders:read'],
      rateLimit: 60,
      isActive: true,
      expiresAt: null,
      revokedAt: null,
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/public/orders',
      headers: { 'x-api-key': rawKey },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.orders).toBeDefined();
  });

  it('rejects with 403 when API key lacks required scope', async () => {
    const rawKey = 'zcrm_contacts_only_key_1234567890';
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce({
      id: 'key-2',
      orgId,
      keyHash,
      keyPrefix: rawKey.slice(0, 12),
      scopes: ['contacts:read'], // Missing orders:read
      rateLimit: 60,
      isActive: true,
      expiresAt: null,
      revokedAt: null,
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/public/orders',
      headers: { 'x-api-key': rawKey },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Insufficient API key permissions');
    expect(body.requiredScope).toBe('orders:read');
  });

  it('rejects expired API key with 403', async () => {
    const rawKey = 'zcrm_expired_key_1234567890';
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce({
      id: 'key-3',
      orgId,
      keyHash,
      keyPrefix: rawKey.slice(0, 12),
      scopes: ['*'],
      rateLimit: 60,
      isActive: true,
      expiresAt: new Date(Date.now() - 10000), // Expired in past
      revokedAt: null,
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/public/contacts',
      headers: { 'x-api-key': rawKey },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('API key has expired');
  });

  it('rejects disabled or revoked API key with 403', async () => {
    const rawKey = 'zcrm_revoked_key_1234567890';
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce({
      id: 'key-4',
      orgId,
      keyHash,
      keyPrefix: rawKey.slice(0, 12),
      scopes: ['*'],
      rateLimit: 60,
      isActive: false, // Disabled
      expiresAt: null,
      revokedAt: new Date(),
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/public/contacts',
      headers: { 'x-api-key': rawKey },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('API key has been disabled');
  });

  it('enforces shared PostgreSQL rate limit bucket with 429 and Retry-After', async () => {
    const rawKey = 'zcrm_rate_limit_key_1234567890';
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce({
      id: 'key-5',
      orgId,
      keyHash,
      keyPrefix: rawKey.slice(0, 12),
      scopes: ['contacts:read'],
      rateLimit: 10,
      isActive: true,
      expiresAt: null,
      revokedAt: null,
    } as any);

    // Mock $queryRaw returns request_count exceeding limit
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ request_count: 11 }] as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/public/contacts',
      headers: { 'x-api-key': rawKey },
    });

    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(JSON.parse(res.body).error).toBe('Too Many Requests');
  });
});
