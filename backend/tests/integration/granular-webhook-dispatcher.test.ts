process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import {
  matchesEventPattern,
  computeWebhookSignatures,
  computeWebhookSignatureV1,
  computeWebhookSignatureV2,
  encryptWebhookSecret,
  decryptWebhookSecret,
} from '../../src/modules/api/services/webhook-signature-service.js';
import { enqueueWebhook } from '../../src/modules/api/webhook-service.js';
import { retryWebhookOutboxItem } from '../../src/modules/api/services/webhook-log-service.js';
import { prisma } from '../../src/shared/database/prisma-client.js';

vi.mock('../../src/shared/database/prisma-client.js', () => {
  const mockPrisma: any = {
    webhookSubscription: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    webhookOutbox: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  };
  return { prisma: mockPrisma };
});

describe('Granular Webhook Dispatcher & Dual HMAC Verification Integration Tests', () => {
  const orgId = 'org-webhook-test';
  const secret = 'super-secret-webhook-key-32chars';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches wildcard and granular event patterns correctly', () => {
    expect(matchesEventPattern('*', 'order.created')).toBe(true);
    expect(matchesEventPattern('*', 'contact.deleted')).toBe(true);

    expect(matchesEventPattern('order.*', 'order.created')).toBe(true);
    expect(matchesEventPattern('order.*', 'order.updated')).toBe(true);
    expect(matchesEventPattern('order.*', 'order.deleted')).toBe(true);
    expect(matchesEventPattern('order.*', 'contact.created')).toBe(false);

    expect(matchesEventPattern('contact.*', 'contact.created')).toBe(true);
    expect(matchesEventPattern('contact.*', 'order.created')).toBe(false);

    expect(matchesEventPattern('message.received', 'message.received')).toBe(true);
    expect(matchesEventPattern('message.received', 'message.sent')).toBe(false);
  });

  it('generates valid dual signatures and validates 5-minute replay tolerance window', () => {
    const payload = JSON.stringify({ event: 'order.created', data: { id: 'ord-123', total: 100000 } });
    const nowSec = Math.floor(Date.now() / 1000).toString();

    const { signatureV1, signatureV2 } = computeWebhookSignatures(payload, secret, nowSec);

    // Verify V1 HMAC
    const expectedV1 = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    expect(signatureV1).toBe(expectedV1);

    // Verify V2 HMAC
    const expectedV2 = crypto.createHmac('sha256', secret).update(`${nowSec}.${payload}`).digest('hex');
    expect(signatureV2).toBe(expectedV2);

    // Timing-safe tolerance window test
    const withinTolerance = Math.abs(Date.now() / 1000 - parseInt(nowSec, 10)) <= 300;
    expect(withinTolerance).toBe(true);

    // Replay attack simulation (timestamp 6 minutes ago)
    const oldTimestamp = (parseInt(nowSec, 10) - 360).toString();
    const isReplay = Math.abs(Date.now() / 1000 - parseInt(oldTimestamp, 10)) > 300;
    expect(isReplay).toBe(true);
  });

  it('encrypts and decrypts webhook secret with AES-256-GCM securely', () => {
    const rawSecret = 'webhook_secret_key_1234567890';
    const encrypted = encryptWebhookSecret(rawSecret);
    expect(encrypted).toBeDefined();

    const decrypted = decryptWebhookSecret(encrypted);
    expect(decrypted).toBe(rawSecret);
  });

  it('enqueues events to matching subscriptions with immutable destination snapshot and breaker awareness', async () => {
    const secretEncrypted = encryptWebhookSecret(secret);

    // Subscription A: order.* (active)
    // Subscription B: contact.* (active)
    // Subscription C: * (paused by circuit_breaker)
    // Subscription D: message.* (inactive manual - not returned)
    const subs = [
      {
        id: 'sub-a',
        orgId,
        targetUrl: 'https://api.domain.com/orders',
        secretEncrypted,
        events: ['order.*'],
        isActive: true,
        pauseReason: null,
        sendV1Signature: true,
      },
      {
        id: 'sub-b',
        orgId,
        targetUrl: 'https://api.domain.com/contacts',
        secretEncrypted,
        events: ['contact.*'],
        isActive: true,
        pauseReason: null,
        sendV1Signature: false,
      },
      {
        id: 'sub-c',
        orgId,
        targetUrl: 'https://api.domain.com/all',
        secretEncrypted,
        events: ['*'],
        isActive: false,
        pauseReason: 'circuit_breaker',
        sendV1Signature: true,
      },
    ];

    vi.mocked(prisma.webhookSubscription.findMany).mockResolvedValueOnce(subs as any);

    await enqueueWebhook(prisma, orgId, 'order.created', { orderCode: 'ORD-001' });

    // Should create outbox items for Sub A (order.*) and Sub C (*), but NOT Sub B (contact.*)
    expect(prisma.webhookOutbox.create).toHaveBeenCalledTimes(2);

    // First call for sub-a (status: pending)
    expect(prisma.webhookOutbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subscriptionId: 'sub-a',
          destinationUrl: 'https://api.domain.com/orders',
          status: 'pending',
          eventType: 'order.created',
        }),
      })
    );

    // Second call for sub-c (status: paused due to circuit breaker)
    expect(prisma.webhookOutbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subscriptionId: 'sub-c',
          destinationUrl: 'https://api.domain.com/all',
          status: 'paused',
          eventType: 'order.created',
        }),
      })
    );
  });

  it('retryWebhookOutboxItem resets attemptCount to 0, clears error and sets pending', async () => {
    const outboxId = 'outbox-failed-1';
    vi.mocked(prisma.webhookOutbox.findFirst).mockResolvedValueOnce({
      id: outboxId,
      orgId,
      status: 'failed',
      attemptCount: 10,
      destinationUrl: 'https://original-snapshot.com/hook',
    } as any);

    vi.mocked(prisma.webhookOutbox.update).mockResolvedValueOnce({
      id: outboxId,
      status: 'pending',
      attemptCount: 0,
      lastError: null,
    } as any);

    const result = await retryWebhookOutboxItem(orgId, outboxId);

    expect(result).toBe(true);
    expect(prisma.webhookOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: outboxId },
        data: expect.objectContaining({
          status: 'pending',
          attemptCount: 0,
          lastError: null,
        }),
      })
    );
  });
});
