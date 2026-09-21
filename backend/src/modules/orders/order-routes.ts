/**
 * Order management routes — CRUD + stats + per-staff report + KiotViet integration.
 * All routes require authentication via authMiddleware.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { allocateOrderCode } from './order-code-service.js';
import {
  objectInput,
  identifierInput,
  stringInput,
  enumInput,
  RequestValidationError,
} from '../../shared/http/request-schemas.js';
import { randomUUID } from 'node:crypto';
import {
  boundedFiniteNumber,
  boundedPositiveInt,
  boundedString,
  validOptionalDate,
} from '../../shared/http/request-bounds.js';
import { getVnDayStartUtc } from '../../shared/utils/date-utils.js';
import { logger } from '../../shared/utils/logger.js';
import { serializeOrderResponse } from './order-response-serializer.js';
import { validateOrderItems, validatePaymentFields } from './order-item-validation.js';
import {
  isOrderFinancialLocked,
  assertOrderNotLockedForFinancialChanges,
} from './order-invoice-lock.js';
import { enqueueInvoice } from '../integrations/kiotviet/kiotviet-invoice-service.js';
import { reconcileInvoice } from '../integrations/kiotviet/kiotviet-invoice-reconciliation.js';
import {
  getKiotvietConfig,
  KiotvietConflictError,
} from '../integrations/kiotviet/kiotviet-settings-service.js';

export async function orderRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.addHook('preHandler', async (request) => {
    const params = request.params as Record<string, unknown>;
    if (params?.id !== undefined) identifierInput(params.id);
  });

  const statuses = ['new', 'confirmed', 'paid', 'shipped', 'completed', 'cancelled'];

  const orderBody = (value: unknown, create: boolean) => {
    const body = objectInput(value);
    const allowed = create
      ? [
          'contactId',
          'conversationId',
          'totalAmount',
          'status',
          'notes',
          'items',
          'paidAmount',
          'paymentMethod',
          'paymentAccountId',
          'kiotvietCustomerId',
          'expectedRevision',
        ]
      : [
          'totalAmount',
          'status',
          'notes',
          'items',
          'paidAmount',
          'paymentMethod',
          'paymentAccountId',
          'kiotvietCustomerId',
          'expectedRevision',
        ];

    if (Object.keys(body).some((key) => !allowed.includes(key))) {
      throw new RequestValidationError('Invalid order field');
    }
    if (create) identifierInput(body.contactId);
    if (body.conversationId !== undefined && body.conversationId !== null) {
      identifierInput(body.conversationId);
    }
    if (body.notes !== undefined) stringInput(body.notes, 10_000, true);
    if (body.status !== undefined) enumInput(body.status, statuses);
    return body;
  };

  // ── List orders ───────────────────────────────────────────────────────────
  app.get('/api/v1/orders', async (request: FastifyRequest) => {
    const user = request.user!;
    const {
      page = '1',
      limit = '50',
      status = '',
      contactId = '',
      createdByUserId = '',
    } = request.query as Record<string, string>;
    const pageNum = boundedPositiveInt(page, 1, 10_000);
    const limitNum = boundedPositiveInt(limit, 50, 100);

    const where: any = { orgId: user.orgId };
    if (status) where.status = boundedString(status, 50);
    if (contactId) where.contactId = boundedString(contactId, 128);
    if (createdByUserId) where.createdByUserId = boundedString(createdByUserId, 128);

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          contact: { select: { id: true, fullName: true, phone: true } },
          createdBy: { select: { id: true, fullName: true } },
          items: true,
          kiotvietJob: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.order.count({ where }),
    ]);

    return serializeOrderResponse({ orders, total, page: pageNum, limit: limitNum });
  });

  // ── Get single order by ID ────────────────────────────────────────────────
  app.get('/api/v1/orders/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const order = await prisma.order.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        contact: { select: { id: true, fullName: true, phone: true } },
        createdBy: { select: { id: true, fullName: true } },
        items: true,
        kiotvietJob: true,
      },
    });

    if (!order) return reply.status(404).send({ error: 'Order not found' });
    return serializeOrderResponse({ order });
  });

  // ── Create order (preserves HTTP 200) ─────────────────────────────────────
  app.post('/api/v1/orders', async (request: FastifyRequest, reply: FastifyReply) => {
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
          const isConfirmedOrPaid =
            body.status === 'confirmed' || (payment.paidAmount !== null && payment.paidAmount > 0);

          if (isConfirmedOrPaid && !isPrivileged) {
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
              await enqueueInvoice({
                orderId: createdOrder.id,
                orgId: user.orgId,
                mode: 'automatic',
                actorId: user.id,
              });
            }
          }

          return createdOrder;
        })
      );

      if (!order) {
        return reply.status(404).send({ error: 'Related contact or conversation not found' });
      }

      // Return HTTP 200 with serialized order
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
  });

  // ── Update order (totalAmount, status, notes, items, payments) ────────────
  app.put('/api/v1/orders/:id', async (request: FastifyRequest, reply: FastifyReply) => {
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
        if (body.expectedRevision !== undefined && body.expectedRevision !== null) {
          if (existing.revision !== Number(body.expectedRevision)) {
            throw new KiotvietConflictError(
              `Order revision mismatch: expected ${body.expectedRevision}, got ${existing.revision}`,
              'order_revision_mismatch'
            );
          }
        }

        // Check financial locks
        if (isOrderFinancialLocked(existing.kiotvietSyncStatus)) {
          if (body.status === 'cancelled') {
            assertOrderNotLockedForFinancialChanges(existing.kiotvietSyncStatus, 'cancel');
          }
          if (
            body.items !== undefined ||
            body.totalAmount !== undefined ||
            body.paidAmount !== undefined ||
            body.paymentMethod !== undefined
          ) {
            assertOrderNotLockedForFinancialChanges(existing.kiotvietSyncStatus, 'financial_update');
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
            // Empty items array
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

        if (body.kiotvietCustomerId !== undefined) {
          updateData.kiotvietCustomerId = body.kiotvietCustomerId ? BigInt(body.kiotvietCustomerId as string) : null;
        }

        if (body.status !== undefined) {
          updateData.status = body.status;
        }
        if (body.notes !== undefined) {
          updateData.notes = body.notes;
        }

        // RBAC: Check confirmation or payment permissions
        const isPrivileged = ['owner', 'admin'].includes(user.role);
        const newStatus = (updateData.status as string) || existing.status;
        const newPaid = updateData.paidAmount !== undefined ? updateData.paidAmount : (existing.paidAmount ? Number(existing.paidAmount) : 0);
        const isConfirmedOrPaid = newStatus === 'confirmed' || (newPaid !== null && newPaid > 0);

        if (isConfirmedOrPaid && !isPrivileged && (existing.status !== 'confirmed')) {
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
            await enqueueInvoice({
              orderId: updated.id,
              orgId: user.orgId,
              mode: 'automatic',
              actorId: user.id,
            });
          }
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
  });

  // ── Delete order ──────────────────────────────────────────────────────────
  app.delete('/api/v1/orders/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.order.findFirst({
          where: { id, orgId: user.orgId },
          include: { kiotvietJob: true },
        });

        if (!existing) return reply.status(404).send({ error: 'Order not found' });

        if (isOrderFinancialLocked(existing.kiotvietSyncStatus)) {
          assertOrderNotLockedForFinancialChanges(existing.kiotvietSyncStatus, 'delete');
        }

        // If job exists and failed, delete job first so restrict constraint does not block
        if (existing.kiotvietJob) {
          await tx.kiotvietInvoiceJob.deleteMany({ where: { orderId: id, orgId: user.orgId } });
        }

        await tx.orderItem.deleteMany({ where: { orderId: id, orgId: user.orgId } });
        await tx.order.delete({ where: { id } });

        return { success: true };
      });
    } catch (err: any) {
      if (err instanceof KiotvietConflictError) {
        return reply.status(409).send({ error: err.message, code: err.code });
      }
      logger.error('[orders] Delete order error:', err);
      return reply.status(500).send({ error: 'Failed to delete order' });
    }
  });

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

  // ── Orders for a specific contact ─────────────────────────────────────────
  app.get('/api/v1/contacts/:id/orders', async (request: FastifyRequest) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const orders = await prisma.order.findMany({
      where: { contactId: id, orgId: user.orgId },
      include: {
        createdBy: { select: { id: true, fullName: true } },
        items: true,
        kiotvietJob: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return serializeOrderResponse({ orders });
  });

  // ── Order stats ───────────────────────────────────────────────────────────
  app.get('/api/v1/orders/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { from, to } = request.query as Record<string, string>;

    const where: any = { orgId: user.orgId };
    const fromDate = validOptionalDate(from);
    const toDate = validOptionalDate(to);
    if (toDate && /^\d{4}-\d{2}-\d{2}$/.test(to)) toDate.setUTCHours(23, 59, 59, 999);
    if (fromDate && toDate && fromDate > toDate) throw new RequestValidationError('Invalid date range');
    if ((from && !fromDate) || (to && !toDate)) return reply.status(400).send({ error: 'Invalid date range' });
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = fromDate;
      if (toDate) where.createdAt.lte = toDate;
    }

    const [total, completed, revenue, todayRevenue] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.count({ where: { ...where, status: 'completed' } }),
      prisma.order.aggregate({ where: { ...where, status: 'completed' }, _sum: { totalAmount: true } }),
      prisma.order.aggregate({
        where: {
          orgId: user.orgId,
          status: 'completed',
          createdAt: { gte: getVnDayStartUtc() },
        },
        _sum: { totalAmount: true },
      }),
    ]);

    return {
      totalOrders: total,
      completedOrders: completed,
      totalRevenue: revenue._sum.totalAmount || 0,
      todayRevenue: todayRevenue._sum.totalAmount || 0,
    };
  });

  // ── Staff performance ─────────────────────────────────────────────────────
  app.get('/api/v1/orders/by-staff', async (request: FastifyRequest) => {
    const user = request.user!;

    const staffStats = await prisma.order.groupBy({
      by: ['createdByUserId'],
      where: { orgId: user.orgId },
      _count: true,
      _sum: { totalAmount: true },
    });

    const userIds = staffStats.map((s) => s.createdByUserId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.fullName]));

    const result = staffStats.map((s) => ({
      userId: s.createdByUserId,
      fullName: userMap.get(s.createdByUserId) || 'Unknown',
      orderCount: s._count,
      totalRevenue: s._sum.totalAmount || 0,
    }));

    return { staffStats: result };
  });
}

async function retryOrderTransaction<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error: any) {
      if (attempt >= 3 || !['P2034', '40001', '40P01'].includes(error?.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}
