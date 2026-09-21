import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { zaloPool } from '../../src/modules/zalo/zalo-pool.js';
import { zaloRateLimiter } from '../../src/modules/zalo/zalo-rate-limiter.js';
import {
  MessageDeliveryService,
  messageDeliveryService,
} from '../../src/modules/zalo/message-delivery-service.js';
import { publicApiRoutes } from '../../src/modules/api/public-api-routes.js';

describe('Public Zalo Delivery Policy & Conversation Resolution (Phase 5: F-07)', () => {
  let app: FastifyInstance;
  let testOrgId: string;
  let testAccountId: string;
  let testThreadId: string;
  let mockApi: any;

  beforeEach(async () => {
    testOrgId = `org-${randomUUID()}`;
    testAccountId = `acc-${randomUUID()}`;
    testThreadId = `thread-${randomUUID()}`;

    mockApi = {
      sendMessage: vi.fn().mockResolvedValue({
        message: { msgId: 'zalo-msg-9999' },
      }),
    };

    vi.spyOn(zaloPool, 'getInstance').mockReturnValue({
      api: mockApi,
    } as any);

    vi.spyOn(prisma.notification, 'updateMany').mockResolvedValue({ count: 0 });
    vi.spyOn(prisma.appSetting, 'findFirst').mockResolvedValue(null);
    vi.spyOn(prisma.zaloAccount, 'findUnique').mockResolvedValue(null);

    app = Fastify();
    await app.register(publicApiRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('resolves conversation and contact before remote send, persists message row, and updates conversation', async () => {
    const existingConversationId = `conv-${randomUUID()}`;

    // Mock Prisma calls
    const findAccountSpy = vi.spyOn(prisma.zaloAccount, 'findFirst').mockResolvedValue({
      id: testAccountId,
      orgId: testOrgId,
      status: 'connected',
      zaloUid: 'bot-uid-1',
    } as any);

    // Initial check: conversation not found
    const findConvSpy = vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue(null);

    // Contact upsert / find
    const findContactSpy = vi.spyOn(prisma.contact, 'findFirst').mockResolvedValue(null);
    const createContactSpy = vi.spyOn(prisma.contact, 'create').mockResolvedValue({
      id: `contact-${randomUUID()}`,
      orgId: testOrgId,
      zaloUid: testThreadId,
      fullName: 'Khách Zalo',
    } as any);

    // Conversation upsert
    const upsertConvSpy = vi.spyOn(prisma.conversation, 'upsert').mockResolvedValue({
      id: existingConversationId,
      orgId: testOrgId,
      zaloAccountId: testAccountId,
      externalThreadId: testThreadId,
      threadType: 'user',
      zaloAccount: { id: testAccountId, zaloUid: 'bot-uid-1', orgId: testOrgId },
    } as any);

    // Message creation
    const createdMessageId = `msg-${randomUUID()}`;
    const createMsgSpy = vi.spyOn(prisma.message, 'create').mockResolvedValue({
      id: createdMessageId,
      conversationId: existingConversationId,
      zaloMsgId: 'zalo-msg-9999',
      senderType: 'self',
      content: 'Xin chào từ Public API',
      contentType: 'text',
      sentAt: new Date(),
    } as any);

    // Conversation update after message
    const updateConvSpy = vi.spyOn(prisma.conversation, 'update').mockResolvedValue({} as any);

    // Mock IO event delivery
    const mockIo: any = {};
    const deliveryService = new MessageDeliveryService();
    deliveryService.setIO(mockIo);

    const result = await deliveryService.sendText({
      orgId: testOrgId,
      zaloAccountId: testAccountId,
      threadId: testThreadId,
      threadType: 'user',
      content: 'Xin chào từ Public API',
      source: 'public_api',
    });

    expect(result.conversationId).toBe(existingConversationId);
    expect(result.zaloMsgId).toBe('zalo-msg-9999');
    expect(result.message.id).toBe(createdMessageId);

    // Verify order of operations:
    // 1. Contact & Conversation resolved before remote send
    expect(findAccountSpy).toHaveBeenCalled();
    expect(upsertConvSpy).toHaveBeenCalled();
    expect(mockApi.sendMessage).toHaveBeenCalledWith(
      { msg: 'Xin chào từ Public API' },
      testThreadId,
      0,
    );

    // 2. Message persisted linked to conversation
    expect(createMsgSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: existingConversationId,
          zaloMsgId: 'zalo-msg-9999',
          senderType: 'self',
          content: 'Xin chào từ Public API',
        }),
      }),
    );

    // 3. Conversation updated
    expect(updateConvSpy).toHaveBeenCalledWith({
      where: { id: existingConversationId },
      data: expect.objectContaining({
        isReplied: true,
        unreadCount: 0,
      }),
    });
  });

  it('enforces Zalo rate limits across all outbound sources including public API', async () => {
    vi.spyOn(prisma.zaloAccount, 'findFirst').mockResolvedValue({
      id: testAccountId,
      orgId: testOrgId,
      status: 'connected',
      zaloUid: 'bot-uid-1',
    } as any);

    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({
      id: 'conv-123',
      zaloAccountId: testAccountId,
      externalThreadId: testThreadId,
      orgId: testOrgId,
      threadType: 'user',
      zaloAccount: { id: testAccountId, zaloUid: 'bot-uid-1', orgId: testOrgId },
    } as any);

    // Force rate limiter to reject
    vi.spyOn(zaloRateLimiter, 'checkLimits').mockReturnValue({
      allowed: false,
      reason: 'Gửi tin nhắn quá nhanh, vui lòng đợi 10 giây',
      canForce: false,
    });

    await expect(
      messageDeliveryService.sendText({
        orgId: testOrgId,
        zaloAccountId: testAccountId,
        threadId: testThreadId,
        content: 'Test rate limit message',
        source: 'public_api',
      }),
    ).rejects.toThrow(/Gửi tin nhắn quá nhanh/);

    // Remote send must never be reached
    expect(mockApi.sendMessage).not.toHaveBeenCalled();
  });

  it('registers anti-echo tracking so remote message ID is not processed as inbound echo', async () => {
    vi.spyOn(prisma.zaloAccount, 'findFirst').mockResolvedValue({
      id: testAccountId,
      orgId: testOrgId,
      status: 'connected',
      zaloUid: 'bot-uid-1',
    } as any);

    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({
      id: 'conv-123',
      zaloAccountId: testAccountId,
      externalThreadId: testThreadId,
      orgId: testOrgId,
      threadType: 'user',
      zaloAccount: { id: testAccountId, zaloUid: 'bot-uid-1', orgId: testOrgId },
    } as any);

    vi.spyOn(zaloRateLimiter, 'checkLimits').mockReturnValue({ allowed: true });
    const recordSendSpy = vi.spyOn(zaloRateLimiter, 'recordSend');

    vi.spyOn(prisma.message, 'create').mockResolvedValue({
      id: 'msg-1',
      conversationId: 'conv-123',
      zaloMsgId: 'zalo-msg-9999',
    } as any);
    vi.spyOn(prisma.conversation, 'update').mockResolvedValue({} as any);

    await messageDeliveryService.sendText({
      orgId: testOrgId,
      zaloAccountId: testAccountId,
      threadId: testThreadId,
      content: 'Hello anti-echo test',
      source: 'public_api',
    });

    expect(recordSendSpy).toHaveBeenCalledWith(
      testAccountId,
      ['zalo-msg-9999'],
      false,
      1,
    );
  });
});
