/**
 * order-update-handler.ts — Handler for updating existing orders (PUT /api/v1/orders/:id).
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { RequestValidationError } from '../../../shared/http/request-schemas.js';
import { boundedFiniteNumber } from '../../../shared/http/request-bounds.js';
import { logger } from '../../../shared/utils/logger.js';
import { serializeOrderResponse } from '../order-response-serializer.js';
import { validateOrderItems, validatePaymentFields } from '../order-item-validation.js';
import {
  isOrderFinancialLocked,
  assertOrderNotLockedForFinancialChanges,
} from '../order-invoice-lock.js';
import { enqueueInvoiceTx } from '../../integrations/kiotviet/kiotviet-invoice-service.js';
import { getKiotvietConfig, KiotvietConflictError } from '../../integrations/kiotviet/kiotviet-settings-service.js';
import { enqueueWebhook } from '../../api/webhook-service.js';
import { orderBody } from './order-route-helpers.js';

export async function updateOrderHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user!;
  const { id } = request.params as { id: string };
  const body = orderBody(request.body, false);

  try {
    const order = await prisma.$transaction(async (tx) => {
      const existing = await tx.order.findFirst({
        where: { id, orgId: user.orgId },
        include: { items: true },
      });
      if (!existing) return null;

      // Check revision fence
      if (body.expectedRevision !== undefined && body.expectedRevision !== null && existing.revision !== Number(body.expectedRevision)) {
        throw new KiotvietConflictError(
          `Order revision mismatch: expected ${body.expectedRevision}, got ${existing.revision}`,
          'order_revision_mismatch'
        );
      }

      // Check financial locks
      if (isOrderFinancialLocked(existing)) {
        if (body.status === 'cancelled') assertOrderNotLockedForFinancialChanges(existing, 'cancel');
        if (body.items !== undefined || body.totalAmount !== undefined || body.paidAmount !== undefined || body.paymentMethod !== undefined) {
          assertOrderNotLockedForFinancialChanges(existing, 'financial_update');
        }
      }

      const updateData: any = {
        revision: { increment: 1 },
      };

      let itemsToCreate: any[] = [];
      let computedTotal: number | undefined;

      if (body.items !== undefined) {
        if (Array.isArray(body.items) && body.items.length > 0) {
          const validated = await validateOrderItems(user.orgId, body.items, user.role, tx);
          itemsToCreate = validated.items;
          computedTotal = validated.totalAmount;
          updateData.totalAmount = computedTotal;
        } else {
          updateData.totalAmount = 0;
        }
      } else if (body.totalAmount !== undefined) {
        const bound = boundedFiniteNumber(body.totalAmount, 0, 100_000_000_000);
        if (bound === undefined) {
          throw new RequestValidationError('totalAmount must be a finite amount between 0 and 100000000000');
        }
        updateData.totalAmount = bound;
      }

      const effectiveTotal = updateData.totalAmount ?? existing.totalAmount;

      if (body.paidAmount !== undefined || body.paymentMethod !== undefined || body.paymentAccountId !== undefined) {
        const payment = validatePaymentFields(
          body.paidAmount !== undefined ? (body.paidAmount as number | null) : (existing.paidAmount ? Number(existing.paidAmount) : null),
          body.paymentMethod !== undefined ? (body.paymentMethod as string | null) : existing.paymentMethod,
          body.paymentAccountId !== undefined ? (body.paymentAccountId as string | null) : (existing.paymentAccountId ? existing.paymentAccountId.toString() : null),
          effectiveTotal
        );
        updateData.paidAmount = payment.paidAmount;
        updateData.paymentMethod = payment.paymentMethod;
        updateData.paymentAccountId = payment.paymentAccountId;
        if (payment.paidAmount !== null && existing.paidAmount === null) {
          updateData.paymentRecordedAt = new Date();
        }
      }

      if (body.kiotvietCustomerId !== undefined) updateData.kiotvietCustomerId = body.kiotvietCustomerId ? BigInt(body.kiotvietCustomerId as string) : null;
      if (body.status !== undefined) updateData.status = body.status;
      if (body.notes !== undefined) updateData.notes = body.notes;

      // RBAC: Check confirmation or payment permissions
      const isPrivileged = ['owner', 'admin'].includes(user.role);
      const newStatus = (updateData.status as string) || existing.status;
      const newPaid = updateData.paidAmount !== undefined ? updateData.paidAmount : (existing.paidAmount ? Number(existing.paidAmount) : 0);
      const isAutoSyncEligible =
        ['confirmed', 'paid', 'shipped', 'completed'].includes(newStatus) || (newPaid !== null && newPaid > 0);

      if (
        isAutoSyncEligible &&
        !isPrivileged &&
        !['confirmed', 'paid', 'shipped', 'completed'].includes(existing.status)
      ) {
        const config = await getKiotvietConfig(user.orgId, tx);
        if (config?.autoSync) {
          throw new RequestValidationError(
            'Chỉ Quản lý (owner/admin) mới có quyền xác nhận đơn hoặc ghi nhận thanh toán khi bật tự động xuất hóa đơn KiotViet'
          );
        }
      }

      // Replace items if provided
      if (body.items !== undefined) {
        await tx.orderItem.deleteMany({ where: { orderId: id, orgId: user.orgId } });
        if (itemsToCreate.length > 0) {
          await tx.orderItem.createMany({
            data: itemsToCreate.map((item) => ({
              id: randomUUID(),
              orgId: user.orgId,
              orderId: id,
              productId: item.productId,
              kiotvietProductId: item.kiotvietProductId,
              retailer: item.retailer,
              branchId: item.branchId,
              productCode: item.productCode,
              productName: item.productName,
              unit: item.unit,
              quantity: item.quantity,
              price: item.price,
              discountMode: item.discountMode,
              discountInput: item.discountInput,
              discountAmount: item.discountAmount,
              subtotal: item.subtotal,
              note: item.note,
            })),
          });
        }
      }

      await tx.order.update({
        where: { id },
        data: updateData,
      });

      const updated = await tx.order.findFirst({
        where: { id, orgId: user.orgId },
        include: {
          contact: { select: { id: true, fullName: true, phone: true } },
          createdBy: { select: { id: true, fullName: true } },
          items: true,
          kiotvietJob: true,
        },
      });

      // Trigger auto-sync if transitioned to confirmed and items exist
      if (
        updated &&
        updated.items.length > 0 &&
        ['confirmed', 'paid', 'shipped', 'completed'].includes(updated.status) &&
        updated.kiotvietSyncStatus === 'not_synced'
      ) {
        const config = await getKiotvietConfig(user.orgId, tx);
        if (config?.autoSync) {
          const enqueueRes = await enqueueInvoiceTx(tx, {
            orderId: updated.id,
            orgId: user.orgId,
            mode: 'automatic',
            actorId: user.id,
          });
          if (enqueueRes?.order?.kiotvietSyncStatus) {
            updated.kiotvietSyncStatus = enqueueRes.order.kiotvietSyncStatus;
          }
        }
      }

      if (updated) {
        await enqueueWebhook(tx, user.orgId, 'order.updated', serializeOrderResponse(updated));
      }

      return updated;
    });

    if (!order) return reply.status(404).send({ error: 'Order not found' });
    return serializeOrderResponse(order);
  } catch (err: any) {
    if (err instanceof RequestValidationError) {
      return reply.status(400).send({ error: err.message });
    }
    if (err instanceof KiotvietConflictError) {
      return reply.status(409).send({ error: err.message, code: err.code });
    }
    logger.error('[orders] Update order error:', err);
    return reply.status(500).send({ error: 'Failed to update order' });
  }
}
