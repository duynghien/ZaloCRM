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

  it('atomic rollback: when Zalo API rejects a file, nothing is saved and staged files remain', async () => {
    const orgId = 'org-1';
    const convId = 'conv-test-3';
    const stagedDir = path.join(testBaseDir, 'staged');

    const uuidFail = randomUUID();
    const stagedFilename = `${orgId}-${uuidFail}-sample.pdf`;
    const stagedPath = path.join(stagedDir, stagedFilename);
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
      api: {
        sendMessage: vi.fn().mockRejectedValue(new Error('Zalo server timeout or file rejected')),
      },
    } as any);

    const createSpy = vi.spyOn(prisma.message, 'create');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/messages`,
      payload: {
        content: 'File đây',
        attachmentIds: [uuidFail],
      },
    });

    expect(res.statusCode).toBe(502);
    expect(createSpy).not.toHaveBeenCalled();
    // Staged file still exists for retry
    expect(fs.existsSync(stagedPath)).toBe(true);
  });

  it('message-handler skips echo duplicate when selfListen emits a recently sent msgId', async () => {
    zaloRateLimiter.recordSend('acc-echo-test', 'recent-msg-xyz', false);

    vi.spyOn(prisma.zaloAccount, 'findUnique').mockResolvedValue({
      id: 'acc-echo-test',
      orgId: 'org-1',
      ownerUserId: 'u-1',
    } as any);

    const txSpy = vi.spyOn(prisma, '$transaction');

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
