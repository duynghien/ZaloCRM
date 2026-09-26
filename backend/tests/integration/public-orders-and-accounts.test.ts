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
    apiKey: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    apiKeyRateLimitBucket: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    $queryRaw: vi.fn().mockResolvedValue([{ request_count: 1 }]),
    zaloAccount: { findMany: vi.fn(), count: vi.fn() },
    order: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
    contact: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
  };
  return { prisma: mockPrisma };
});

describe('Public Orders & Zalo Accounts Endpoint Integration Tests', () => {
  const orgId = 'org-public-orders-test';
  const rawKey = 'zcrm_public_test_key_1234567890';
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ request_count: 1, last_value: 1n }] as any);
    app = Fastify();
    await app.register(publicApiRoutes);
    await app.ready();
  });

  it('GET /api/public/zalo-accounts returns accounts and ABSOLUTELY conceals sessionData', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce({
      id: 'key-zalo',
      orgId,
      keyHash,
      scopes: ['zalo_accounts:read'],
      rateLimit: 60,
      isActive: true,
      expiresAt: null,
      revokedAt: null,
    } as any);

    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValueOnce([
      {
        id: 'acc-1',
        orgId,
        displayName: 'Shop Zalo Official',
        status: 'connected',
        sessionData: 'sensitive-encrypted-cookie-data-that-must-never-leak',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/public/zalo-accounts',
      headers: { 'x-api-key': rawKey },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].name).toBe('Shop Zalo Official');
    expect(body.accounts[0].sessionData).toBeUndefined();
    expect(res.body).not.toContain('sensitive-encrypted-cookie-data');
  });

  it('POST /api/public/orders creates order with generic items and sets createdByKeyId without user', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce({
      id: 'key-orders',
      orgId,
      keyHash,
      scopes: ['orders:write', 'contacts:read'],
      rateLimit: 60,
      isActive: true,
      expiresAt: null,
      revokedAt: null,
    } as any);

    vi.mocked(prisma.contact.findFirst).mockResolvedValueOnce({ id: 'c-1' } as any);

    vi.mocked(prisma.order.create).mockResolvedValueOnce({
      id: 'ord-gen-1',
      orgId,
      orderCode: 'ORD-20260926-001',
      totalAmount: 250000,
      createdByKeyId: 'key-orders',
      createdByUserId: null,
      status: 'pending',
      items: [
        {
          id: 'item-1',
          productName: 'Custom Generic Product',
          productCode: 'GEN-CUSTOM',
          unitPrice: 250000,
          quantity: 1,
          amount: 250000,
          canSync: false,
          kiotvietProductId: null,
        },
      ],
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/public/orders',
      headers: { 'x-api-key': rawKey },
      payload: {
        contactId: 'c-1',
        totalAmount: 250000,
        items: [
          {
            productName: 'Custom Generic Product',
            quantity: 1,
            price: 250000,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.orderCode).toBe('ORD-20260926-001');
    expect(body.createdByKeyId).toBe('key-orders');
    expect(body.createdByUserId).toBeNull();
  });

  it('POST /api/public/orders requires contacts:write scope when passing contact phone or fullName', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce({
      id: 'key-orders-no-contacts-write',
      orgId,
      keyHash,
      scopes: ['orders:write'], // Missing contacts:write!
      rateLimit: 60,
      isActive: true,
      expiresAt: null,
      revokedAt: null,
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/public/orders',
      headers: { 'x-api-key': rawKey },
      payload: {
        totalAmount: 100000,
        phone: '0988888888',
        fullName: 'Khách Hàng Mới',
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Creating new contacts via order requires 'contacts:write' scope");
  });

  it('GET /api/public/contacts?page=2&limit=5 returns pagination metadata', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce({
      id: 'key-contacts',
      orgId,
      keyHash,
      scopes: ['contacts:read'],
      rateLimit: 60,
      isActive: true,
      expiresAt: null,
      revokedAt: null,
    } as any);

    vi.mocked(prisma.contact.findMany).mockResolvedValueOnce([
      { id: 'c-1', fullName: 'Contact 1' },
      { id: 'c-2', fullName: 'Contact 2' },
    ] as any);
    vi.mocked(prisma.contact.count).mockResolvedValueOnce(12);

    const res = await app.inject({
      method: 'GET',
      url: '/api/public/contacts?page=2&limit=5',
      headers: { 'x-api-key': rawKey },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.contacts).toHaveLength(2);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.limit).toBe(5);
    expect(body.pagination.total).toBe(12);
  });
});
