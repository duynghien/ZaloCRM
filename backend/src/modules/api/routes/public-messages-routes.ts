/**
 * public-messages-routes.ts — Public REST API for outbound Zalo message delivery.
 * Enforces messages:send scope, idempotency-key header, and message bounds.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../../shared/utils/logger.js';
import { validateIdempotencyKey } from '../../../shared/http/idempotency-key.js';
import { messageDeliveryService } from '../../zalo/message-delivery-service.js';
import { requireApiKeyScope } from '../middleware/scope-guard.js';

export async function publicMessagesRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/public/messages/send',
    { preHandler: [requireApiKeyScope('messages:send')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const orgId = (request as any).orgId as string;
        const body = request.body as Record<string, any>;

        if (!body?.zaloAccountId || !body?.threadId || !body?.content) {
          return reply.status(400).send({ error: 'zaloAccountId, threadId, and content are required' });
        }

        if (typeof body.content === 'string' && body.content.length > 10_000) {
          return reply.status(400).send({ error: 'Nội dung tin nhắn không được vượt quá 10,000 ký tự' });
        }

        let idempotencyKey: string;
        try {
          idempotencyKey = validateIdempotencyKey(request.headers['idempotency-key']);
        } catch {
          return reply.status(400).send({
            error: 'Header Idempotency-Key là bắt buộc (1-256 ký tự, chỉ chứa chữ cái, số, ., _, :, -)',
          });
        }

        const result = await messageDeliveryService.sendMessage({
          orgId,
          zaloAccountId: body.zaloAccountId,
          threadId: body.threadId,
          threadType: body.threadType,
          content: body.content,
          source: 'public_api',
          idempotencyKey,
        });

        return {
          success: true,
          messageId: result.message.id,
          conversationId: result.conversationId,
          zaloMsgId: result.zaloMsgId,
        };
      } catch (err: any) {
        logger.error('[public-api] POST /messages/send error:', err);
        const statusCode = err?.statusCode || (err?.message?.includes('not found') ? 404 : 500);
        if (statusCode >= 500) {
          return reply.status(500).send({
            error: 'Internal server error',
            canForce: err?.canForce,
            code: err?.code,
          });
        }
        return reply.status(statusCode).send({
          error: err?.message || 'Failed to send message',
          canForce: err?.canForce,
          code: err?.code,
        });
      }
    }
  );
}
