/**
 * order-read-handlers.ts — Read handlers for orders: listing, single order, and contact-specific orders.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { boundedPositiveInt, boundedString } from '../../../shared/http/request-bounds.js';
import { serializeOrderResponse } from '../order-response-serializer.js';
import { isOrderFinancialLocked } from '../order-invoice-lock.js';

export async function listOrdersHandler(request: FastifyRequest) {
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
        createdByKey: { select: { id: true, name: true, keyPrefix: true } },
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
}

export async function getOrderHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user!;
  const { id } = request.params as { id: string };

  const order = await prisma.order.findFirst({
    where: { id, orgId: user.orgId },
    include: {
      contact: { select: { id: true, fullName: true, phone: true } },
      createdBy: { select: { id: true, fullName: true } },
      createdByKey: { select: { id: true, name: true, keyPrefix: true } },
      items: true,
      kiotvietJob: true,
    },
  });

  if (!order) return reply.status(404).send({ error: 'Order not found' });
  const editable = !isOrderFinancialLocked(order);
  const hasGenericItems = order.items?.some(item => !item.kiotvietProductId) ?? false;
  const canSync = (order.items?.length ?? 0) > 0 && !hasGenericItems && !isOrderFinancialLocked(order);
  return serializeOrderResponse({ order: { ...order, editable, canSync } });
}

export async function getContactOrdersHandler(request: FastifyRequest) {
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
}
