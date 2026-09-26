/**
 * order-create-handler.ts — Handler for creating new orders (POST /api/v1/orders).
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { allocateOrderCode } from '../order-code-service.js';
import { RequestValidationError } from '../../../shared/http/request-schemas.js';
import { boundedFiniteNumber } from '../../../shared/http/request-bounds.js';
import { logger } from '../../../shared/utils/logger.js';
import { serializeOrderResponse } from '../order-response-serializer.js';
import { validateOrderItems, validatePaymentFields } from '../order-item-validation.js';
import { enqueueInvoiceTx } from '../../integrations/kiotviet/kiotviet-invoice-service.js';
import { getKiotvietConfig, KiotvietConflictError } from '../../integrations/kiotviet/kiotviet-settings-service.js';
import { enqueueWebhook } from '../../api/webhook-service.js';
import { orderBody, retryOrderTransaction } from './order-route-helpers.js';

export async function createOrderHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user!;
  const body = orderBody(request.body, true);

  if (!body.contactId || (body.totalAmount === undefined && !Array.isArray(body.items))) {
    return reply.status(400).send({ error: 'contactId và totalAmount hoặc items là bắt buộc' });
  }

  try {
    const order = await retryOrderTransaction(() =>
      prisma.$transaction(async (tx) => {
        const contact = await tx.contact.findFirst({
          where: { id: body.contactId as string, orgId: user.orgId },
          select: { id: true },
        });
        if (!contact) return null;

        if (body.conversationId) {
          const conversation = await tx.conversation.findFirst({
            where: { id: body.conversationId as string, orgId: user.orgId },
            select: { contactId: true },
          });
          if (!conversation || (conversation.contactId && conversation.contactId !== contact.id)) {
            return null;
          }
        }

        // Validate items if provided
        let itemsToCreate: any[] = [];
        let computedTotal = 0;
        if (Array.isArray(body.items) && body.items.length > 0) {
          const validated = await validateOrderItems(user.orgId, body.items, user.role, tx);
          itemsToCreate = validated.items;
          computedTotal = validated.totalAmount;
        }

        let totalAmount: number;
        if (itemsToCreate.length > 0) {
          totalAmount = computedTotal;
        } else {
          const bound = boundedFiniteNumber(body.totalAmount, 0, 100_000_000_000);
          if (bound === undefined) {
            throw new RequestValidationError('totalAmount must be a finite amount between 0 and 100000000000');
          }
          totalAmount = bound;
        }

        // Validate payments
        const payment = validatePaymentFields(
          body.paidAmount as number | null | undefined,
          body.paymentMethod as string | null | undefined,
          body.paymentAccountId as string | null | undefined,
          totalAmount
        );

        // RBAC: Check confirmation / payment permissions if auto-sync is enabled
        const isPrivileged = ['owner', 'admin'].includes(user.role);
        const isAutoSyncEligibleStatus =
          ['confirmed', 'paid', 'shipped', 'completed'].includes(body.status as string) ||
          (payment.paidAmount !== null && payment.paidAmount > 0);

        if (isAutoSyncEligibleStatus && !isPrivileged) {
          const config = await getKiotvietConfig(user.orgId, tx);
          if (config?.autoSync) {
            throw new RequestValidationError(
              'Chỉ Quản lý (owner/admin) mới có quyền xác nhận đơn hoặc ghi nhận thanh toán khi bật tự động xuất hóa đơn KiotViet'
            );
          }
        }

        const orderCode = await allocateOrderCode(tx, user.orgId);
        const kiotvietCustId = body.kiotvietCustomerId ? BigInt(body.kiotvietCustomerId as string) : null;

        const createdOrder = await tx.order.create({
          data: {
            id: randomUUID(),
            orgId: user.orgId,
            contactId: contact.id,
            createdByUserId: user.id,
            conversationId: (body.conversationId as string | null | undefined) ?? null,
            orderCode,
            totalAmount,
            status: (body.status as string | undefined) ?? 'new',
            notes: (body.notes as string | null | undefined) ?? null,
            paidAmount: payment.paidAmount,
            paymentMethod: payment.paymentMethod,
            paymentAccountId: payment.paymentAccountId,
            paymentRecordedAt: payment.paidAmount !== null ? new Date() : null,
            kiotvietCustomerId: kiotvietCustId,
            revision: 0,
            items:
              itemsToCreate.length > 0
                ? {
                    create: itemsToCreate.map((item) => ({
                      orgId: user.orgId,
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
                  }
                : undefined,
          },
          include: {
            contact: { select: { id: true, fullName: true, phone: true } },
            createdBy: { select: { id: true, fullName: true } },
            items: true,
          },
        });

        // Auto-sync enqueue if eligible
        if (
          itemsToCreate.length > 0 &&
          ['confirmed', 'paid', 'shipped', 'completed'].includes(createdOrder.status)
        ) {
          const config = await getKiotvietConfig(user.orgId, tx);
          if (config?.autoSync) {
            const enqueueRes = await enqueueInvoiceTx(tx, {
              orderId: createdOrder.id,
              orgId: user.orgId,
              mode: 'automatic',
              actorId: user.id,
            });
            if (enqueueRes?.order?.kiotvietSyncStatus) {
              createdOrder.kiotvietSyncStatus = enqueueRes.order.kiotvietSyncStatus;
            }
          }
        }

        await enqueueWebhook(tx, user.orgId, 'order.created', serializeOrderResponse(createdOrder));

        return createdOrder;
      })
    );

    if (!order) {
      return reply.status(404).send({ error: 'Related contact or conversation not found' });
    }

    return reply.status(200).send(serializeOrderResponse(order));
  } catch (err: any) {
    if (err instanceof RequestValidationError) {
      return reply.status(400).send({ error: err.message });
    }
    if (err instanceof KiotvietConflictError) {
      return reply.status(409).send({ error: err.message, code: err.code });
    }
    logger.error('[orders] Create order error:', err);
    return reply.status(500).send({ error: 'Failed to create order' });
  }
}
