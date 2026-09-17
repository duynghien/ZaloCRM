/**
 * chat-copilot-routes.ts — REST endpoints for On-Demand Copilot suggestions & Anomaly resolution.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { requireZaloAccess } from '../../zalo/zalo-access-middleware.js';
import { chatCopilotService } from './chat-copilot-service.js';
import { emitAccountEvent, emitManagerEvent } from '../../../shared/realtime/socket-event-delivery.js';
import type { CopilotMessageContext, CopilotContactContext } from './chat-copilot-types.js';

export async function chatCopilotRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── POST /api/v1/conversations/:id/copilot/suggest ────────────────────────
  app.post(
    '/api/v1/conversations/:id/copilot/suggest',
    {
      preHandler: [requireZaloAccess('chat')],
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => (req as any).user?.id || req.ip,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const conv = await prisma.conversation.findFirst({
        where: { id, orgId: user.orgId },
        include: { contact: true },
      });
      if (!conv) return reply.status(404).send({ error: 'Conversation not found' });

      const rawMsgs = await prisma.message.findMany({
        where: { conversationId: id, isDeleted: false },
        orderBy: { sentAt: 'desc' },
        take: 12,
        select: { id: true, senderType: true, senderName: true, content: true, contentType: true, sentAt: true },
      });
      const messages: CopilotMessageContext[] = rawMsgs.reverse().map((m) => ({
        id: m.id,
        senderType: m.senderType === 'self' ? 'self' : 'contact',
        senderName: m.senderName,
        content: m.content,
        contentType: m.contentType,
        sentAt: m.sentAt,
      }));

      const contact: CopilotContactContext | null = conv.contact ? {
        id: conv.contact.id,
        fullName: conv.contact.fullName,
        phone: conv.contact.phone,
        notes: conv.contact.notes,
        tags: Array.isArray(conv.contact.tags) ? (conv.contact.tags as string[]) : [],
        metadata: typeof conv.contact.metadata === 'object' && conv.contact.metadata !== null
          ? (conv.contact.metadata as Record<string, any>)
          : {},
      } : null;

      const result = await chatCopilotService.generateCopilotAnalysis(
        user.orgId,
        id,
        messages,
        contact,
        conv.threadType === 'group',
      );

      if (!result) {
        return reply.status(503).send({ error: 'Copilot AI service is temporarily unavailable' });
      }

      return result;
    },
  );

  // ── PATCH /api/v1/conversations/:id/resolve-anomaly ───────────────────────
  app.patch(
    '/api/v1/conversations/:id/resolve-anomaly',
    { preHandler: [requireZaloAccess('chat')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const conv = await prisma.conversation.findFirst({
        where: { id, orgId: user.orgId },
        include: { contact: true },
      });
      if (!conv) return reply.status(404).send({ error: 'Conversation not found' });

      let updatedMeta: Record<string, any> = {};
      if (conv.contactId && conv.contact) {
        const existingMeta = typeof conv.contact.metadata === 'object' && conv.contact.metadata !== null
          ? (conv.contact.metadata as Record<string, any>)
          : {};
        updatedMeta = {
          ...existingMeta,
          escalationStatus: 'resolved',
          escalationResolvedAt: new Date().toISOString(),
          escalationResolvedBy: user.id,
        };

        await prisma.contact.update({
          where: { id: conv.contactId },
          data: { metadata: updatedMeta },
        });
      }

      const payload = { conversationId: id, accountId: conv.zaloAccountId, resolvedBy: user.id };
      await emitAccountEvent(app.io, conv.zaloAccountId, 'chat:anomaly_resolved', payload);
      await emitManagerEvent(app.io, conv.orgId, 'chat:anomaly_resolved', payload);

      return { success: true, conversationId: id, metadata: updatedMeta };
    },
  );
}
