/**
 * order-delete-handler.ts — Handler for deleting orders (DELETE /api/v1/orders/:id).
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import {
  isOrderFinancialLocked,
  assertOrderNotLockedForFinancialChanges,
} from '../order-invoice-lock.js';
import { KiotvietConflictError } from '../../integrations/kiotviet/kiotviet-settings-service.js';
import { enqueueWebhook } from '../../api/webhook-service.js';

export async function deleteOrderHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user!;
  const { id } = request.params as { id: string };

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.order.findFirst({
        where: { id, orgId: user.orgId },
        include: { kiotvietJob: true },
      });

      if (!existing) return reply.status(404).send({ error: 'Order not found' });

      if (isOrderFinancialLocked(existing)) {
        assertOrderNotLockedForFinancialChanges(existing, 'delete');
      }

      // If job exists and failed, delete job first so restrict constraint does not block
      if (existing.kiotvietJob) {
        await tx.kiotvietInvoiceJob.deleteMany({ where: { orderId: id, orgId: user.orgId } });
      }

      await tx.orderItem.deleteMany({ where: { orderId: id, orgId: user.orgId } });
      await tx.order.delete({ where: { id } });

      await enqueueWebhook(tx, user.orgId, 'order.deleted', {
        id: existing.id,
        orderCode: existing.orderCode,
      });

      return { success: true };
    });
  } catch (err: any) {
    if (err instanceof KiotvietConflictError) {
      return reply.status(409).send({ error: err.message, code: err.code });
    }
    logger.error('[orders] Delete order error:', err);
    return reply.status(500).send({ error: 'Failed to delete order' });
  }
}
