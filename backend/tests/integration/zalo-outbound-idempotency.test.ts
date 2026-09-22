process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  claimOutboxSlot,
  commitOutboxSuccess,
  commitOutboxUncertain,
  computeOutboundIdempotencyKey,
  OutboxUncertainError,
  OutboxConflictError,
} from '../../src/modules/zalo/zalo-outbound-outbox.js';
import { messageDeliveryService } from '../../src/modules/zalo/message-delivery-service.js';
import { zaloPool } from '../../src/modules/zalo/zalo-pool.js';
import { prisma } from '../../src/shared/database/prisma-client.js';

vi.mock('../../src/shared/database/prisma-client.js', () => {
  const mockPrisma: any = {
    zaloAccount: {
      findFirst: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
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
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    zaloAccountRateState: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
    getIO: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('../../src/shared/realtime/socket-event-delivery.js', () => ({
  emitAccountEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/modules/api/webhook-service.js', () => ({
  emitWebhook: vi.fn(),
}));

describe('Zalo Outbound Outbox & Idempotency Integration Tests', () => {
  const orgId = 'org-idem-1';
  const accountId = 'acc-idem-1';
  const threadId = 'thread-idem-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Outbox Claim & Idempotency Key Semantics', () => {
    it('returns claimed for a new idempotency key', async () => {
      const mockTx = {
        zaloOutboundMessage: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'outbox-uuid-1', state: 'dispatching' }),
        },
      } as any;

      const res = await claimOutboxSlot(mockTx, {
        orgId,
        accountId,
        threadId,
        idempotencyKey: 'key-123',
        content: 'Hello',
      });

      expect(res.status).toBe('claimed');
      expect(res.outboxId).toBe('outbox-uuid-1');
      expect(mockTx.zaloOutboundMessage.create).toHaveBeenCalled();
    });

    it('returns succeeded and messageId if idempotency key was already completed', async () => {
      const mockTx = {
        zaloOutboundMessage: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'outbox-completed-1',
            state: 'succeeded',
            messageId: 'msg-completed-123',
          }),
        },
      } as any;

      const res = await claimOutboxSlot(mockTx, {
        orgId,
        accountId,
        threadId,
        idempotencyKey: 'key-123',
        content: 'Hello',
      });

      expect(res.status).toBe('succeeded');
      if (res.status === 'succeeded') {
        expect(res.messageId).toBe('msg-completed-123');
      }
    });

    it('throws OutboxUncertainError if prior dispatch ended in uncertain state', async () => {
      const mockTx = {
        zaloOutboundMessage: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'outbox-uncertain-1',
            state: 'uncertain',
            updatedAt: new Date(),
          }),
        },
      } as any;

      await expect(
        claimOutboxSlot(mockTx, {
          orgId,
          accountId,
          threadId,
          idempotencyKey: 'key-123',
          content: 'Hello',
        })
      ).rejects.toThrow(OutboxUncertainError);
    });

    it('throws OutboxConflictError if request with same key is currently dispatching (<15s)', async () => {
      const mockTx = {
        zaloOutboundMessage: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'outbox-active-1',
            state: 'dispatching',
            updatedAt: new Date(Date.now() - 2000), // 2 seconds ago
          }),
        },
      } as any;

      await expect(
        claimOutboxSlot(mockTx, {
          orgId,
          accountId,
          threadId,
          idempotencyKey: 'key-123',
          content: 'Hello',
        })
      ).rejects.toThrow(OutboxConflictError);
    });
  });

  describe('Fallback Hash Generation for Multi-Media Dispatches', () => {
    it('computes distinct fallback keys for distinct media sets with no text content', () => {
      const key1 = computeOutboundIdempotencyKey({
        accountId,
        threadId,
        content: null,
        mediaFiles: [{ filename: 'photo1.jpg', size: 1024 }],
      });

      const key2 = computeOutboundIdempotencyKey({
        accountId,
        threadId,
        content: null,
        mediaFiles: [{ filename: 'photo2.jpg', size: 2048 }],
      });

      expect(key1).not.toBe(key2);
    });

    it('computes identical fallback keys within the same time window for identical content', () => {
      const key1 = computeOutboundIdempotencyKey({
        accountId,
        threadId,
        content: 'Same text',
        timeWindowMs: 10_000,
      });

      const key2 = computeOutboundIdempotencyKey({
        accountId,
        threadId,
        content: 'Same text',
        timeWindowMs: 10_000,
      });

      expect(key1).toBe(key2);
    });
  });

  describe('End-to-End Idempotent Delivery via MessageDeliveryService', () => {
    it('returns cached message without invoking Zalo API on duplicate succeeded key', async () => {
      const idempotencyKey = 'client-key-succeeded-888';
      const cachedMsg = {
        id: 'msg-cached-888',
        conversationId: 'conv-1',
        content: 'Cached message',
        zaloMsgId: 'zalo-msg-888',
      };

      vi.mocked(prisma.zaloAccount.findFirst).mockResolvedValue({
        id: accountId,
        orgId,
        status: 'connected',
        zaloUid: 'uid-1',
      } as any);

      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: 'conv-1',
        orgId,
        zaloAccountId: accountId,
        externalThreadId: threadId,
      } as any);

      const mockSendMessage = vi.fn();
      vi.mocked(zaloPool.getInstance).mockReturnValue({
        api: { sendMessage: mockSendMessage },
      } as any);

      // Outbox already has succeeded state
      vi.mocked(prisma.zaloOutboundMessage.findUnique).mockResolvedValue({
        id: 'outbox-888',
        orgId,
        accountId,
        threadId,
        idempotencyKey,
        state: 'succeeded',
        messageId: cachedMsg.id,
      } as any);

      vi.mocked(prisma.message.findUnique).mockResolvedValue(cachedMsg as any);

      const result = await messageDeliveryService.sendMessage({
        orgId,
        zaloAccountId: accountId,
        threadId,
        content: 'Hello cached',
        source: 'public_api',
        idempotencyKey,
      });

      expect(result.message.id).toBe(cachedMsg.id);
      expect(result.zaloMsgId).toBe(cachedMsg.zaloMsgId);
      // Crucial: remote dispatch must NOT have been called
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });
});
