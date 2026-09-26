process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import { apiKeyManagementRoutes } from '../../src/modules/api/routes/api-key-management-routes.js';
import { webhookSubscriptionRoutes } from '../../src/modules/api/routes/webhook-subscription-routes.js';
import { webhookLogRoutes } from '../../src/modules/api/routes/webhook-log-routes.js';
import { prisma } from '../../src/shared/database/prisma-client.js';

// Mock auth middleware so requests have an authenticated admin user
vi.mock('../../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: async (req: any) => {
    req.user = { id: 'admin-user-1', orgId: 'org-test-dlq', role: 'admin' };
  },
}));

// Mock DNS lookup to resolve public IP offline
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));

vi.mock('../../src/shared/database/prisma-client.js', () => {
  const mockPrisma: any = {
    apiKey: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    webhookSubscription: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    webhookOutbox: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
  };
  return { prisma: mockPrisma };
});

describe('Webhook Settings & Outbox DLQ Integration Tests', () => {
  const orgId = 'org-test-dlq';
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(apiKeyManagementRoutes);
    await app.register(webhookSubscriptionRoutes);
    await app.register(webhookLogRoutes);
    await app.ready();
  });

  it('POST /api/v1/settings/webhooks rejects SSRF payloads (http, loopback, metadata IP)', async () => {
    const maliciousUrls = [
      'http://example.com/webhook',
      'https://localhost/webhook',
      'https://127.0.0.1/webhook',
      'https://169.254.169.254/latest/meta-data',
    ];

    for (const targetUrl of maliciousUrls) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/settings/webhooks',
        payload: { name: 'Malicious Webhook', targetUrl, events: ['order.*'] },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain('URL không hợp lệ hoặc không an toàn');
    }
  });

  it('POST /api/v1/settings/api-keys generates single-reveal key, SHA-256 hash, and no-store headers', async () => {
    let capturedCreateData: any = null;
    vi.mocked(prisma.apiKey.create).mockImplementationOnce(async ({ data }: any) => {
      capturedCreateData = data;
      return {
        id: 'key-gen-1',
        name: data.name,
        keyPrefix: data.keyPrefix,
        scopes: data.scopes,
        rateLimit: data.rateLimit,
        expiresAt: data.expiresAt,
        isActive: true,
        createdAt: new Date(),
      } as any;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/api-keys',
      payload: { name: 'ERP Integration Key', scopes: ['orders:read', 'orders:write'] },
    });

    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toContain('no-store');
    const body = JSON.parse(res.body);
    expect(body.apiKey).toMatch(/^zcrm_[a-f0-9]{48}$/);
    expect(body.keyPrefix).toBe(body.apiKey.slice(0, 12));

    const expectedHash = crypto.createHash('sha256').update(body.apiKey).digest('hex');
    expect(capturedCreateData.keyHash).toBe(expectedHash);
    expect(capturedCreateData.orgId).toBe(orgId);
  });

  it('POST /api/v1/settings/webhooks/logs/:id/retry resets attemptCount and status to pending', async () => {
    vi.mocked(prisma.webhookOutbox.findFirst).mockResolvedValueOnce({
      id: 'outbox-failed-1',
      orgId,
      status: 'dead_letter',
    } as any);

    let capturedUpdateData: any = null;
    vi.mocked(prisma.webhookOutbox.update).mockImplementationOnce(async ({ data }: any) => {
      capturedUpdateData = data;
      return { id: 'outbox-failed-1', ...data } as any;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/webhooks/logs/outbox-failed-1/retry',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(capturedUpdateData.status).toBe('pending');
    expect(capturedUpdateData.attemptCount).toBe(0);
    expect(capturedUpdateData.lastError).toBeNull();
    expect(capturedUpdateData.responseStatus).toBeNull();
    expect(capturedUpdateData.nextAttemptAt).toBeInstanceOf(Date);
  });

  it('POST /api/v1/settings/webhooks/logs/:id/retry enforces IDOR protection across tenants', async () => {
    vi.mocked(prisma.webhookOutbox.findFirst).mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/webhooks/logs/foreign-org-item/retry',
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Không tìm thấy bản ghi webhook outbox hoặc không thuộc tổ chức');
    expect(prisma.webhookOutbox.update).not.toHaveBeenCalled();
  });

  it('POST /api/v1/settings/webhooks creates subscription with encrypted secret and public URL', async () => {
    let capturedSubscription: any = null;
    vi.mocked(prisma.webhookSubscription.create).mockImplementationOnce(async ({ data }: any) => {
      capturedSubscription = data;
      return {
        id: 'sub-new-1',
        orgId,
        name: data.name,
        targetUrl: data.targetUrl,
        events: data.events,
        isActive: true,
        consecutiveFails: 0,
        createdAt: new Date(),
      } as any;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/webhooks',
      payload: {
        name: 'ERP Production Webhook',
        targetUrl: 'https://example.com/webhook',
        events: ['contact.*', 'order.created'],
        secret: 'my-custom-shared-secret-12345',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(capturedSubscription.name).toBe('ERP Production Webhook');
    expect(capturedSubscription.targetUrl).toBe('https://example.com/webhook');
    expect(capturedSubscription.secretEncrypted).toBeDefined();
    expect(capturedSubscription.secretEncrypted).not.toBe('my-custom-shared-secret-12345');
  });

  it('GET /api/v1/settings/webhooks/logs accepts limit=50 and returns logs with stats', async () => {
    vi.mocked(prisma.webhookOutbox.findMany).mockResolvedValueOnce([{ id: 'log-1', status: 'delivered' }] as any);
    vi.mocked(prisma.webhookOutbox.count).mockResolvedValueOnce(1);
    vi.mocked(prisma.webhookOutbox.groupBy).mockResolvedValueOnce([{ status: 'delivered', _count: { id: 1 } }] as any);

    const res = await app.inject({ method: 'GET', url: '/api/v1/settings/webhooks/logs?limit=50' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.logs).toHaveLength(1);
    expect(body.pagination.limit).toBe(50);
    expect(body.pagination.page).toBe(1);
    expect(body.stats.delivered).toBe(1);
  });
});
