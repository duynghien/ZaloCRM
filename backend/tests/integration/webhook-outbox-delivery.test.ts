process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emitWebhook, deliverWebhook, tickWebhookQueue } from '../../src/modules/api/webhook-service.js';
import { prisma } from '../../src/shared/database/prisma-client.js';
import * as outboundPolicy from '../../src/shared/security/outbound-url-policy.js';

vi.mock('../../src/shared/database/prisma-client.js', () => {
  const mockPrisma: any = {
    appSetting: {
      findFirst: vi.fn(),
    },
    webhookOutbox: {
      create: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  };
  return { prisma: mockPrisma };
});

const getSql = (callArg: any): string => {
  if (!callArg) return '';
  if (typeof callArg === 'string') return callArg;
  if (Array.isArray(callArg)) return callArg.join('');
  if (Array.isArray(callArg[0])) return callArg[0].join('');
  if (callArg[0]?.sql) return callArg[0].sql;
  if (callArg[0]?.strings) return callArg[0].strings.join('');
  return '';
};

describe('Durable Webhook Outbox Delivery Integration Tests', () => {
  const orgId = 'org-webhook-test';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('avoids accumulating orphan outbox records when org has no webhook_url configured', async () => {
    vi.mocked(prisma.appSetting.findFirst).mockResolvedValue(null);

    await emitWebhook(orgId, 'order.created', { orderId: 'ord-123' });

    expect(prisma.webhookOutbox.create).not.toHaveBeenCalled();
  });

  it('enqueues pending outbox row when org has webhook_url configured', async () => {
    vi.mocked(prisma.appSetting.findFirst).mockResolvedValue({
      id: 'set-1',
      orgId,
      settingKey: 'webhook_url',
      valuePlain: 'https://client.example/webhook',
    } as any);

    vi.mocked(prisma.webhookOutbox.create).mockResolvedValue({ id: 'outbox-1' } as any);

    await emitWebhook(orgId, 'order.created', { orderId: 'ord-123' });

    expect(prisma.webhookOutbox.create).toHaveBeenCalledTimes(1);
    const createArg = vi.mocked(prisma.webhookOutbox.create).mock.calls[0][0];
    expect(createArg.data.orgId).toBe(orgId);
    expect(createArg.data.eventType).toBe('order.created');
    expect(createArg.data.status).toBe('pending');
  });

  it('dispatches webhook with X-Webhook-Id header and HMAC signature', async () => {
    vi.mocked(prisma.appSetting.findFirst).mockImplementation(async ({ where }: any) => {
      if (where.settingKey === 'webhook_url') {
        return { id: 's1', orgId, settingKey: 'webhook_url', valuePlain: 'https://client.example/webhook' } as any;
      }
      if (where.settingKey === 'webhook_secret') {
        return { id: 's2', orgId, settingKey: 'webhook_secret', valuePlain: 'supersecret' } as any;
      }
      return null;
    });

    const fetchSpy = vi.spyOn(outboundPolicy, 'fetchPublicHttps').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => 'OK',
      json: async () => ({ status: 'ok' }),
    } as any);

    const res = await deliverWebhook(orgId, 'contact.created', { contactId: 'c-1' }, 'wh-id-999');

    expect(res?.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const fetchArgs = fetchSpy.mock.calls[0];
    expect(fetchArgs[0]).toBe('https://client.example/webhook');
    expect(fetchArgs[1]?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Webhook-Event': 'contact.created',
      'X-Webhook-Id': 'wh-id-999',
    });
    // Verifies HMAC signature was generated
    expect((fetchArgs[1]?.headers as any)['X-Webhook-Signature']).toBeTruthy();
  });

  it('claims pending webhook, delivers successfully, and marks status delivered', async () => {
    const row = {
      id: 'wh-job-1',
      org_id: orgId,
      event_type: 'invoice.paid',
      payload: { invoiceId: 'inv-1' },
      attempt_count: 0,
    };

    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([row] as any);

    vi.mocked(prisma.appSetting.findFirst).mockResolvedValue({
      id: 's1',
      orgId,
      settingKey: 'webhook_url',
      valuePlain: 'https://client.example/webhook',
    } as any);

    vi.spyOn(outboundPolicy, 'fetchPublicHttps').mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => 'OK',
      json: async () => ({ status: 'ok' }),
    } as any);

    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(1 as any);

    await tickWebhookQueue();

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const execCall = vi.mocked(prisma.$executeRaw).mock.calls[0];
    const execSql = getSql(execCall);
    expect(execSql).toContain("SET \"status\" = 'delivered'");
    expect(execSql).toContain('delivered_at');
  });

  it('schedules exponential backoff on transient HTTP 500 error', async () => {
    const row = {
      id: 'wh-job-500',
      org_id: orgId,
      event_type: 'message.sent',
      payload: { messageId: 'm-1' },
      attempt_count: 2, // Next attempt = 3
    };

    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([row] as any);

    vi.mocked(prisma.appSetting.findFirst).mockResolvedValue({
      id: 's1',
      orgId,
      settingKey: 'webhook_url',
      valuePlain: 'https://client.example/webhook',
    } as any);

    vi.spyOn(outboundPolicy, 'fetchPublicHttps').mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers(),
      text: async () => 'Internal Server Error',
      json: async () => ({ error: 'fail' }),
    } as any);

    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(1 as any);

    await tickWebhookQueue();

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const execCall = vi.mocked(prisma.$executeRaw).mock.calls[0];
    const execSql = getSql(execCall);
    expect(execSql).toContain("SET \"status\" = 'pending'");
    expect(execSql).toContain('"attempt_count" =');
    expect(execCall[1]).toBe(3);
    expect(execSql).toContain("INTERVAL '1 minute'");
  });

  it('moves job to dead-letter queue (status failed) after 10 attempts', async () => {
    const row = {
      id: 'wh-job-dlq',
      org_id: orgId,
      event_type: 'message.sent',
      payload: { messageId: 'm-dlq' },
      attempt_count: 9, // Next attempt = 10
    };

    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([row] as any);

    vi.mocked(prisma.appSetting.findFirst).mockResolvedValue({
      id: 's1',
      orgId,
      settingKey: 'webhook_url',
      valuePlain: 'https://client.example/webhook',
    } as any);

    vi.spyOn(outboundPolicy, 'fetchPublicHttps').mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: new Headers(),
      text: async () => 'Unavailable',
      json: async () => ({}),
    } as any);

    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(1 as any);

    await tickWebhookQueue();

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const execCall = vi.mocked(prisma.$executeRaw).mock.calls[0];
    const execSql = getSql(execCall);
    expect(execSql).toContain("SET \"status\" = 'failed'");
    expect(execSql).toContain('"attempt_count" =');
    expect(execCall[1]).toBe(10);
  });
});
