/**
 * order-kiotviet-routes.ts — Routes for KiotViet manual sync and invoice reconciliation.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../../shared/utils/logger.js';
import { serializeOrderResponse } from '../order-response-serializer.js';
import { enqueueInvoice } from '../../integrations/kiotviet/kiotviet-invoice-service.js';
import { reconcileInvoice } from '../../integrations/kiotviet/kiotviet-invoice-reconciliation.js';
import { KiotvietConflictError } from '../../integrations/kiotviet/kiotviet-settings-service.js';
import { RequestValidationError } from '../../../shared/http/request-schemas.js';

export async function orderKiotvietRoutes(app: FastifyInstance): Promise<void> {
  // ── Manual sync order to KiotViet ─────────────────────────────────────────
  app.post('/api/v1/orders/:id/sync-kiotviet', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as Record<string, any>;

    try {
      const result = await enqueueInvoice({
        orderId: id,
        orgId: user.orgId,
        mode: 'manual',
        expectedRevision: body.expectedRevision ? Number(body.expectedRevision) : undefined,
        actorId: user.id,
      });

      return reply.status(202).send(serializeOrderResponse(result));
    } catch (err: any) {
      if (err instanceof KiotvietConflictError) {
        return reply.status(409).send({ error: err.message, code: err.code });
      }
      logger.error('[orders] Manual invoice sync error:', err);
      return reply.status(500).send({ error: 'Failed to sync invoice with KiotViet' });
    }
  });

  // ── Admin reconciliation for KiotViet invoice ─────────────────────────────
  app.post('/api/v1/orders/:id/reconcile-kiotviet', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    if (!['owner', 'admin'].includes(user.role)) {
      return reply.status(403).send({ error: 'Forbidden: Admin access required for invoice reconciliation' });
    }

    const { id } = request.params as { id: string };
    const body = (request.body || {}) as Record<string, any>;

    try {
      const result = await reconcileInvoice({
        orgId: user.orgId,
        orderId: id,
        action: body.action,
        remoteInvoiceId: body.remoteInvoiceId,
        reason: body.reason,
        actorId: user.id,
      });

      return serializeOrderResponse(result);
    } catch (err: any) {
      if (err instanceof KiotvietConflictError) {
        return reply.status(409).send({ error: err.message, code: err.code });
      }
      if (err instanceof RequestValidationError) {
        return reply.status(400).send({ error: err.message });
      }
      logger.error('[orders] Reconcile error:', err);
      return reply.status(500).send({ error: 'Failed to reconcile invoice' });
    }
  });
}
