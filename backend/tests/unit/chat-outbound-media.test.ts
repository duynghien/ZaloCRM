/**
 * chat-outbound-media.test.ts — Unit and route tests for outbound media sending,
 * multi-msgId dedup defense, atomic rollback, and conversation media snippets.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('../../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: vi.fn(async (req: any) => {
    req.user = { id: 'u-staff', orgId: 'org-1', role: 'owner', email: 'staff@example.com', fullName: 'Staff Tester' };
  }),
}));

vi.mock('../../src/modules/zalo/zalo-access-middleware.js', () => ({
  requireZaloAccess: () => async (_req: any) => {},
}));

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma: any = {
    conversation: { findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    contact: { findFirst: vi.fn(), create: vi.fn(), upsert: vi.fn() },
    message: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    zaloAccount: { findFirst: vi.fn(), findUnique: vi.fn() },
    zaloOutboundMessage: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'outbox-1', state: 'preparing', leaseVersion: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    zaloAccountRateState: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    appSetting: { findFirst: vi.fn().mockResolvedValue(null) },
    webhookOutbox: { create: vi.fn().mockResolvedValue({}) },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([
      { account_id: 'acc-1', date_vn: '2026-09-22', daily_count: 0, last_send_at: null, recent_sends: [] },
    ]),
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
  };
  return { mockPrisma };
});

vi.mock('../../src/shared/database/prisma-client.js', () => ({
  prisma: mockPrisma,
}));

import { prisma } from '../../src/shared/database/prisma-client.js';
import { chatRoutes } from '../../src/modules/chat/chat-routes.js';
import { zaloPool } from '../../src/modules/zalo/zalo-pool.js';
import { zaloRateLimiter } from '../../src/modules/zalo/zalo-rate-limiter.js';
import { handleIncomingMessage } from '../../src/modules/chat/message-handler.js';
import { getAttachmentsBaseDir } from '../../src/modules/attachments/attachment-routes.js';

describe('Outbound Zalo Media & Dedup Defense', () => {
  let app: any;
  let testBaseDir: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    app = Fastify({ logger: false });
    await app.register(fastifyCookie);
    await app.register(fastifyJwt, { secret: process.env.JWT_SECRET! });

    app.addHook('onRequest', async (req: any) => {
      req.user = { id: 'u-staff', orgId: 'org-1', role: 'owner', email: 'staff@example.com', fullName: 'Staff Tester' };
    });

    app.io = {
      sockets: {
        adapter: { rooms: new Map() },
        sockets: new Map(),
      },
    };

    await app.register(chatRoutes);
    await app.ready();

    testBaseDir = getAttachmentsBaseDir();

    mockPrisma.zaloAccount.findFirst.mockResolvedValue({
      id: 'acc-1',
      orgId: 'org-1',
      status: 'connected',
      zaloUid: 'zalo-staff-1',
    });
    mockPrisma.contact.upsert.mockResolvedValue({
      id: 'contact-1',
      orgId: 'org-1',
      fullName: 'Customer',
    });
    mockPrisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-test-1',
      orgId: 'org-1',
      zaloAccountId: 'acc-1',
      externalThreadId: 'thread-customer',
      threadType: 'user',
      zaloAccount: { id: 'acc-1', orgId: 'org-1', status: 'connected', zaloUid: 'zalo-staff-1' },
    });
    mockPrisma.conversation.update.mockResolvedValue({});
    mockPrisma.zaloOutboundMessage.findUnique.mockResolvedValue(null);
    mockPrisma.zaloOutboundMessage.create.mockResolvedValue({
      id: 'outbox-1',
      state: 'preparing',
      leaseVersion: 1,
    });
    mockPrisma.zaloOutboundMessage.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.message.create.mockImplementation(async ({ data }: any) => ({
      id: 'm-created-1',
      ...data,
    }));
    mockPrisma.$queryRaw.mockImplementation(async (strings: any, ...values: any[]) => {
      const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (sql.includes('zalo_outbound_messages')) {
        const outboxId = values[0] || 'outbox-uuid-1';
        return [{ id: outboxId, leaseVersion: 1 }];
      }
      return [
        {
          account_id: values[0] || 'acc-1',
          date_vn: '2026-09-22',
          daily_count: 0,
          last_send_at: null,
          recent_sends: [],
        },
      ];
    });
    mockPrisma.zaloAccount.findFirst.mockImplementation(async ({ where }: any) => ({
      id: where?.id || 'acc-1',
      orgId: where?.orgId || 'org-1',
      status: 'connected',
      zaloUid: 'zalo-staff-1',
    }));
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects sending empty message without text or attachments', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/conv-1/messages',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('bắt buộc');
  });

  it('sends media with caption and moves staged files to permanent storage', async () => {
    const orgId = 'org-1';
    const convId = 'conv-test-1';
    const stagedDir = path.join(testBaseDir, 'staged');
    const orgDir = path.join(testBaseDir, orgId);

    const uuid1 = randomUUID();
    const stagedFilename = `${orgId}-${uuid1}-baogia.pdf`;
    fs.writeFileSync(path.join(stagedDir, stagedFilename), '%PDF-1.4 test quote content');

    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({
      id: convId,
      orgId,
      zaloAccountId: 'acc-1',
      externalThreadId: 'thread-customer',
      threadType: 'user',
      zaloAccount: { id: 'acc-1', orgId, zaloUid: 'zalo-staff-1' },
    } as any);

    const mockSendMessage = vi.fn().mockResolvedValue({
      message: { msgId: 'zalo-msg-text-1' },
      attachment: [{ msgId: 'zalo-msg-att-1' }],
    });

    vi.spyOn(zaloPool, 'getInstance').mockReturnValue({
      api: { sendMessage: mockSendMessage },
    } as any);

    const createSpy = vi.spyOn(prisma.message, 'create').mockImplementation(async ({ data }: any) => ({
      id: 'm-created-1',
      ...data,
    }));
    vi.spyOn(prisma.conversation, 'update').mockResolvedValue({} as any);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/messages`,
      payload: {
        content: 'Báo giá dịch vụ ạ',
        attachmentIds: [uuid1],
        clientMessageId: 'client-msg-1',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'Báo giá dịch vụ ạ',
        attachments: [expect.stringContaining(stagedFilename)],
      }),
      'thread-customer',
      0,
    );

    // Verify file moved to org directory
    expect(fs.existsSync(path.join(orgDir, stagedFilename))).toBe(true);

    // Verify message created with attachments JSON
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contentType: 'file',
          attachments: expect.arrayContaining([
            expect.objectContaining({
              url: `/api/v1/attachments/${stagedFilename}`,
              filename: stagedFilename,
            }),
          ]),
        }),
      }),
    );

    // Verify both msgIds are registered in dedup
    expect(zaloRateLimiter.isRecentMsgId('acc-1', 'zalo-msg-text-1')).toBe(true);
    expect(zaloRateLimiter.isRecentMsgId('acc-1', 'zalo-msg-att-1')).toBe(true);
  });

  it('sends media-only without caption and extracts msgId from res.attachment[0]', async () => {
    const orgId = 'org-1';
    const convId = 'conv-test-2';
    const stagedDir = path.join(testBaseDir, 'staged');
    const orgDir = path.join(testBaseDir, orgId);

    const uuid2 = randomUUID();
    const stagedFilename = `${orgId}-${uuid2}-screenshot.png`;
    fs.writeFileSync(path.join(stagedDir, stagedFilename), 'fake png');

    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({
      id: convId,
      orgId,
      zaloAccountId: 'acc-2',
      externalThreadId: 'thread-customer-2',
      threadType: 'user',
      zaloAccount: { id: 'acc-2', orgId, zaloUid: 'zalo-staff-1' },
    } as any);

    const mockSendMessage = vi.fn().mockResolvedValue({
      attachment: [{ msgId: 'zalo-att-only-id-999' }],
    });

    vi.spyOn(zaloPool, 'getInstance').mockReturnValue({
      api: { sendMessage: mockSendMessage },
    } as any);

    const createSpy = vi.spyOn(prisma.message, 'create').mockImplementation(async ({ data }: any) => ({
      id: 'm-created-2',
      ...data,
    }));
    vi.spyOn(prisma.conversation, 'update').mockResolvedValue({} as any);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/messages`,
      payload: {
        attachmentIds: [uuid2],
        clientMessageId: 'client-msg-2',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          zaloMsgId: 'zalo-att-only-id-999',
          contentType: 'image',
          content: null,
        }),
      }),
    );
  });

  it('atomic rollback: when pre-dispatch fails, moved media is rolled back to staged', async () => {
    const orgId = 'org-1';
    const convId = 'conv-test-pre';
    const stagedDir = path.join(testBaseDir, 'staged');
    const orgDir = path.join(testBaseDir, orgId);

    const uuidFail = randomUUID();
    const stagedFilename = `${orgId}-${uuidFail}-sample.pdf`;
    const stagedPath = path.join(stagedDir, stagedFilename);
    const permanentPath = path.join(orgDir, stagedFilename);
    fs.writeFileSync(stagedPath, '%PDF-1.4 sample');

    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({
      id: convId,
      orgId,
      zaloAccountId: 'acc-3',
      externalThreadId: 'thread-customer-3',
      threadType: 'user',
      zaloAccount: { id: 'acc-3', orgId, zaloUid: 'zalo-staff-1' },
    } as any);

    vi.spyOn(zaloPool, 'getInstance').mockReturnValue({
      api: { sendMessage: vi.fn() },
    } as any);

    // Rate reservation fails inside transaction (pre-dispatch failure)
    vi.spyOn(zaloRateLimiter, 'reserveSendSlot').mockRejectedValueOnce(new Error('Rate limit DB lock timeout'));

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/messages`,
      payload: {
        content: 'File pre-dispatch error',
        attachmentIds: [uuidFail],
        clientMessageId: 'client-msg-3',
      },
    });

    expect(res.statusCode).toBe(502);
    // Staged file was restored by rollbackMovedMediaToStaged
    expect(fs.existsSync(stagedPath)).toBe(true);
    // Permanent file was removed
    expect(fs.existsSync(permanentPath)).toBe(false);
  });

  it('post-dispatch ambiguous outcome: when SDK throws, permanent media is preserved for reconciliation', async () => {
    const orgId = 'org-1';
    const convId = 'conv-test-post';
    const stagedDir = path.join(testBaseDir, 'staged');
    const orgDir = path.join(testBaseDir, orgId);

    const uuidFail = randomUUID();
    const stagedFilename = `${orgId}-${uuidFail}-sample.pdf`;
    const stagedPath = path.join(stagedDir, stagedFilename);
    const permanentPath = path.join(orgDir, stagedFilename);
    fs.writeFileSync(stagedPath, '%PDF-1.4 sample');

    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({
      id: convId,
      orgId,
      zaloAccountId: 'acc-post',
      externalThreadId: 'thread-customer-post',
      threadType: 'user',
      zaloAccount: { id: 'acc-post', orgId, zaloUid: 'zalo-staff-1' },
    } as any);

    vi.spyOn(zaloPool, 'getInstance').mockReturnValue({
      api: {
        sendMessage: vi.fn().mockRejectedValue(new Error('Zalo server timeout or network issue')),
      },
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/messages`,
      payload: {
        content: 'File post-dispatch error',
        attachmentIds: [uuidFail],
        clientMessageId: 'client-msg-4',
      },
    });

    expect([502, 504]).toContain(res.statusCode);
    // E-05: Permanent file is KEPT for reconciliation
    expect(fs.existsSync(permanentPath)).toBe(true);
  });

  it('message-handler skips echo duplicate when selfListen emits a recently sent msgId', async () => {
    zaloRateLimiter.recordSend('acc-echo-test', 'thread-1', 'recent-msg-xyz', false, 1);

    vi.spyOn(prisma.zaloAccount, 'findUnique').mockResolvedValue({
      id: 'acc-echo-test',
      orgId: 'org-1',
      ownerUserId: 'u-1',
    } as any);

    const txSpy = vi.spyOn(prisma, '$transaction');
    txSpy.mockClear();

    const result = await handleIncomingMessage({
      accountId: 'acc-echo-test',
      msgId: 'recent-msg-xyz',
      isSelf: true,
      content: 'Echo message',
      contentType: 'text',
      senderUid: 'u-1',
      senderName: 'Me',
      timestamp: Date.now(),
      threadId: 'thread-1',
      threadType: 'user',
    });

    expect(result).toBeNull();
    expect(txSpy).not.toHaveBeenCalled();
  });
});
