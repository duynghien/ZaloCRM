process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { zaloRateLimiter } from '../../src/modules/zalo/zalo-rate-limiter.js';
import { messageDeliveryService } from '../../src/modules/zalo/message-delivery-service.js';
import { zaloPool } from '../../src/modules/zalo/zalo-pool.js';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { validatePublicRequest } from '../../src/modules/api/public-api-schemas.js';
import { RequestValidationError } from '../../src/shared/http/request-schemas.js';

vi.mock('../../src/shared/database/prisma-client.js', () => {
  const mockPrisma: any = {
    zaloAccount: {
      findFirst: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    message: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    zaloOutboundMessage: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
      update: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
    },
    zaloAccountRateState: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ accountId: 'acc-test-1', dateVn: '2026-09-22', dailyCount: 0, recentSends: [] }),
      update: vi.fn().mockResolvedValue({ accountId: 'acc-test-1' }),
    },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
  };
  return { prisma: mockPrisma };
});

vi.mock('../../src/modules/zalo/zalo-pool.js', () => ({
  zaloPool: {
    getApi: vi.fn(),
    getInstance: vi.fn(),
  },
}));

describe('Zalo Rate Limiter & Force Policy Integration Tests', () => {
  const accountId = 'acc-test-1';
  const threadId1 = 'thread-1';
  const threadId2 = 'thread-2';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Anti-Echo Deduplication Cache Scoping', () => {
    it('preserves same msgId across distinct threads without dropping as echo', () => {
      const msgId = 'msg-shared-999';

      // Record send on threadId1
      zaloRateLimiter.recordSend(accountId, threadId1, msgId, false, 1);

      // Thread 1 query is recognized as recent send (echo)
      expect(zaloRateLimiter.isRecentMsgId(accountId, threadId1, msgId)).toBe(true);

      // Thread 2 query with the same msgId is NOT recognized as recent send (not an echo for thread 2)
      expect(zaloRateLimiter.isRecentMsgId(accountId, threadId2, msgId)).toBe(false);
    });

    it('supports backward-compatible 2-argument call for legacy tests', () => {
      const msgId = 'msg-legacy-123';
      zaloRateLimiter.recordSend(accountId, msgId, false, 1);
      expect(zaloRateLimiter.isRecentMsgId(accountId, msgId)).toBe(true);
    });
  });

  describe('Force Policy Enforcement in MessageDeliveryService', () => {
    const orgId = 'org-1';

    it('rejects force=true during minimum interval violations (<2s) with canForce: false', async () => {
      vi.mocked(prisma.zaloAccount.findFirst).mockResolvedValue({
        id: accountId,
        orgId,
        status: 'connected',
        zaloUid: 'uid-1',
      } as any);

      vi.mocked(zaloPool.getInstance).mockReturnValue({
        api: { sendMessage: vi.fn() },
      } as any);

      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: 'conv-1',
        orgId,
        zaloAccountId: accountId,
        externalThreadId: threadId1,
      } as any);

      // Simulate recent send just now
      zaloRateLimiter.recordSend(accountId, threadId1, 'msg-1', false, 1);

      // Immediate subsequent send with force=true must fail because interval cannot be forced
      await expect(
        messageDeliveryService.sendText({
          orgId,
          zaloAccountId: accountId,
          threadId: threadId1,
          content: 'Hello rapid',
          source: 'chat_ui',
          force: true,
          idempotencyKey: 'idem-rapid-key',
        })
      ).rejects.toMatchObject({
        statusCode: 429,
        canForce: false,
      });
    });

    it('rejects any force field in public api schema with RequestValidationError', async () => {
      for (const forceVal of ['false', true, false]) {
        const req = {
          routeOptions: { url: '/api/public/messages/send' },
          method: 'POST',
          params: {},
          body: {
            zaloAccountId: 'acc-1',
            threadId: 'thread-1',
            content: 'test',
            force: forceVal,
          },
        } as any;

        await expect(validatePublicRequest(req)).rejects.toThrow(RequestValidationError);
      }
    });
  });
});
