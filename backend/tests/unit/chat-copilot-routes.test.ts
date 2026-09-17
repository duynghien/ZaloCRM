/**
 * chat-copilot-routes.test.ts — Unit & route tests for Copilot API endpoints and contact patch.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';

vi.mock('../../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: vi.fn(async (req: any) => {
    req.user = { id: 'u-1', orgId: 'org-1', role: 'owner', email: 'test@example.com' };
  }),
}));

vi.mock('../../src/modules/zalo/zalo-access-middleware.js', () => ({
  requireZaloAccess: () => async (_req: any) => {},
}));

import { prisma } from '../../src/shared/database/prisma-client.js';
import { chatCopilotRoutes } from '../../src/modules/chat/copilot/chat-copilot-routes.js';
import { contactRoutes } from '../../src/modules/contacts/contact-routes.js';
import { chatCopilotService } from '../../src/modules/chat/copilot/chat-copilot-service.js';

describe('chatCopilotRoutes & contact patch', () => {
  let app: any;

  beforeEach(async () => {
    vi.restoreAllMocks();
    app = Fastify({ logger: false });
    await app.register(fastifyCookie);
    await app.register(fastifyJwt, { secret: 'test_jwt_secret_32_characters_long_12345' });

    // Mock auth & zalo access middleware
    app.addHook('onRequest', async (req: any) => {
      req.user = { id: 'u-1', orgId: 'org-1', role: 'owner', email: 'test@example.com' };
    });

    app.io = {
      sockets: {
        adapter: { rooms: new Map() },
        sockets: new Map(),
      },
    };

    await app.register(chatCopilotRoutes);
    await app.register(contactRoutes);
    await app.ready();
  });

  it('POST /api/v1/conversations/:id/copilot/suggest returns 404 when conversation not found', async () => {
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/conv-nonexistent/copilot/suggest',
    });

    expect(res.statusCode).toBe(404);
  });

  it('POST /api/v1/conversations/:id/copilot/suggest generates and returns analysis result', async () => {
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({
      id: 'conv-1',
      orgId: 'org-1',
      contactId: 'c-1',
      threadType: 'user',
      contact: { id: 'c-1', fullName: 'Mai', phone: '0901234567', notes: null, tags: [], metadata: {} },
    } as any);

    vi.spyOn(prisma.message, 'findMany').mockResolvedValue([
      { id: 'm-1', senderType: 'contact', senderName: 'Mai', content: 'Tư vấn giúp em', contentType: 'text', sentAt: new Date() },
    ] as any);

    vi.spyOn(chatCopilotService, 'generateCopilotAnalysis').mockResolvedValue({
      conversationId: 'conv-1',
      analyzedAt: new Date().toISOString(),
      insights: { sentiment: 'curious', sentimentScore: 60, buyingIntent: 'considering', intentConfidence: 0.8, customerSummary: 'Hỏi tư vấn' },
      smartReplies: [{ id: 'r1', label: 'Tư vấn', content: 'Dạ em chào chị Mai!', tone: 'consultative' }],
      quickDraft: { hasActionableData: false },
      anomalyAlert: { triggered: false, severity: 'low' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/conv-1/copilot/suggest',
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.conversationId).toBe('conv-1');
    expect(json.insights.buyingIntent).toBe('considering');
    expect(json.smartReplies.length).toBe(1);
  });

  it('PATCH /api/v1/conversations/:id/resolve-anomaly updates contact metadata to resolved', async () => {
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({
      id: 'conv-1',
      orgId: 'org-1',
      contactId: 'c-1',
      zaloAccountId: 'acc-1',
      contact: { id: 'c-1', metadata: { escalationStatus: 'pending' } },
    } as any);

    const updateContactSpy = vi.spyOn(prisma.contact, 'update').mockResolvedValue({} as any);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/conversations/conv-1/resolve-anomaly',
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.success).toBe(true);
    expect(json.metadata.escalationStatus).toBe('resolved');
    expect(updateContactSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c-1' },
        data: expect.objectContaining({
          metadata: expect.objectContaining({ escalationStatus: 'resolved' }),
        }),
      }),
    );
  });

  it('PATCH /api/v1/contacts/:id deep-merges shippingAddresses into metadata without data loss', async () => {
    vi.spyOn(prisma.contact, 'findFirst').mockResolvedValue({
      id: 'c-1',
      phone: null,
      fullName: 'Mai',
      metadata: { customField: 'preserved', shippingAddresses: ['10 Nguyễn Trãi'] },
    } as any);

    const updateSpy = vi.spyOn(prisma.contact, 'update').mockImplementation(async ({ data }: any) => ({
      id: 'c-1',
      ...data,
    }));

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/contacts/c-1',
      payload: {
        phone: '0988888888',
        shippingAddress: '12 Tràng Thi',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c-1' },
        data: expect.objectContaining({
          phone: '0988888888',
          metadata: {
            customField: 'preserved',
            shippingAddresses: ['10 Nguyễn Trãi', '12 Tràng Thi'],
          },
        }),
      }),
    );
  });
});
