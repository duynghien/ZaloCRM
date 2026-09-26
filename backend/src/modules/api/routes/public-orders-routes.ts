/**
 * public-orders-routes.ts — Public REST API for order creation and querying.
 * Supports machine-to-machine key attribution, generic line items, and BigInt serialization.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { boundedPositiveInt, boundedString, boundedFiniteNumber } from '../../../shared/http/request-bounds.js';
import { serializeOrderResponse } from '../../orders/order-response-serializer.js';
import { allocateOrderCode } from '../../orders/order-code-service.js';
import { enqueueWebhook } from '../webhook-service.js';
import { requireApiKeyScope, hasApiKeyScope } from '../middleware/scope-guard.js';

export async function publicOrdersRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/public/orders — List orders
  app.get(
    '/api/public/orders',
    { preHandler: [requireApiKeyScope('orders:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const orgId = (request as any).orgId as string;
        const { page = '1', limit = '20', status = '', contactId = '', search = '' } = request.query as Record<string, string>;

        const pageNum = boundedPositiveInt(page, 1, 10_000);
        const limitNum = boundedPositiveInt(limit, 20, 100);
        const safeStatus = boundedString(status, 50);
        const safeContactId = boundedString(contactId, 128);
        const safeSearch = boundedString(search, 100);

        const where: any = { orgId };
        if (safeStatus) where.status = safeStatus;
        if (safeContactId) where.contactId = safeContactId;
        if (safeSearch) {
          where.OR = [
            { orderCode: { contains: safeSearch, mode: 'insensitive' } },
            { notes: { contains: safeSearch, mode: 'insensitive' } },
          ];
        }

        const [orders, total] = await Promise.all([
          prisma.order.findMany({
            where,
            include: {
              contact: { select: { id: true, fullName: true, phone: true } },
              createdBy: { select: { id: true, fullName: true } },
              createdByKey: { select: { id: true, name: true, keyPrefix: true } },
              items: true,
            },
            orderBy: { createdAt: 'desc' },
            skip: (pageNum - 1) * limitNum,
            take: limitNum,
          }),
          prisma.order.count({ where }),
        ]);

        const totalPages = Math.ceil(total / limitNum) || 1;
        return serializeOrderResponse({ orders, data: orders, pagination: { page: pageNum, limit: limitNum, total, totalPages } });
      } catch (err) {
        logger.error('[public-api] GET /orders error:', err);
        return reply.status(500).send({ error: 'Failed to fetch orders' });
      }
    }
  );

  // GET /api/public/orders/:id — Single order
  app.get(
    '/api/public/orders/:id',
    { preHandler: [requireApiKeyScope('orders:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const orgId = (request as any).orgId as string;
        const { id } = request.params as { id: string };

        const order = await prisma.order.findFirst({
          where: { id, orgId },
          include: {
            contact: { select: { id: true, fullName: true, phone: true } },
            createdBy: { select: { id: true, fullName: true } },
            createdByKey: { select: { id: true, name: true, keyPrefix: true } },
            items: true,
          },
        });

        if (!order) return reply.status(404).send({ error: 'Order not found' });
        return serializeOrderResponse(order);
      } catch (err) {
        logger.error('[public-api] GET /orders/:id error:', err);
        return reply.status(500).send({ error: 'Failed to fetch order' });
      }
    }
  );

  // POST /api/public/orders — Create order via Machine API Key
  app.post(
    '/api/public/orders',
    { preHandler: [requireApiKeyScope('orders:write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const orgId = (request as any).orgId as string;
        const apiKeyId = (request as any).apiKeyId as string;
        const body = request.body as Record<string, any>;

        // 1. Resolve contact
        let targetContactId = body?.contactId ? boundedString(body.contactId, 128) : null;

        if (targetContactId) {
          const existing = await prisma.contact.findFirst({ where: { id: targetContactId, orgId }, select: { id: true } });
          if (!existing) return reply.status(404).send({ error: 'Contact not found' });
        } else if (body?.phone || body?.fullName) {
          if (!hasApiKeyScope(request, 'contacts:write')) {
            return reply.status(403).send({
              error: "Creating new contacts via order requires 'contacts:write' scope",
            });
          }
          const phone = boundedString(body.phone, 30);
          const fullName = boundedString(body.fullName, 100) || 'Khách vãng lai';
          let contact = phone ? await prisma.contact.findFirst({ where: { phone, orgId }, select: { id: true } }) : null;
          if (!contact) {
            contact = await prisma.contact.create({
              data: { orgId, fullName, phone, source: 'public_api' },
              select: { id: true },
            });
          }
          targetContactId = contact.id;
        } else {
          return reply.status(400).send({ error: 'contactId or customer phone/fullName is required' });
        }

        // 2. Validate generic line items & compute total
        let itemsData: any[] = [];
        let totalAmount = 0;

        if (Array.isArray(body?.items) && body.items.length > 0) {
          for (let i = 0; i < body.items.length; i++) {
            const item = body.items[i];
            const productName = boundedString(item.productName, 200);
            if (!productName) return reply.status(400).send({ error: `Item at index ${i} requires productName` });
            const quantity = Number(item.quantity);
            const price = Number(item.price);
            if (isNaN(quantity) || quantity <= 0) return reply.status(400).send({ error: `Item at index ${i} has invalid quantity` });
            if (isNaN(price) || price < 0) return reply.status(400).send({ error: `Item at index ${i} has invalid price` });
            const subtotal = Math.round(quantity * price);
            totalAmount += subtotal;
            const productCode = item.productCode ? boundedString(item.productCode, 100) : `GEN-${randomUUID().slice(0, 8).toUpperCase()}`;
            itemsData.push({
              orgId,
              productCode,
              productName,
              unit: item.unit ? boundedString(item.unit, 30) : null,
              quantity,
              price,
              subtotal,
              note: item.notes || item.note ? boundedString(item.notes || item.note, 500) : null,
            });
          }
        } else {
          const bound = boundedFiniteNumber(body?.totalAmount, 0, 100_000_000_000);
          if (bound === undefined) return reply.status(400).send({ error: 'totalAmount or valid items array is required' });
          totalAmount = bound;
        }

        // 3. Create order transactionally
        const createdOrder = await prisma.$transaction(async (tx) => {
          const orderCode = await allocateOrderCode(tx, orgId);
          const order = await tx.order.create({
            data: {
              orgId,
              contactId: targetContactId!,
              createdByKeyId: apiKeyId,
              createdByUserId: null,
              orderCode,
              totalAmount,
              status: body?.status ? boundedString(body.status, 50) : 'new',
              notes: body?.notes ? boundedString(body.notes, 1000) : null,
              items: itemsData.length > 0 ? { create: itemsData } : undefined,
            },
            include: {
              contact: { select: { id: true, fullName: true, phone: true } },
              createdByKey: { select: { id: true, name: true, keyPrefix: true } },
              items: true,
            },
          });
          await enqueueWebhook(tx, orgId, 'order.created', serializeOrderResponse(order));
          return order;
        });

        return reply.status(201).send(serializeOrderResponse(createdOrder));
      } catch (err) {
        logger.error('[public-api] POST /orders error:', err);
        return reply.status(500).send({ error: 'Failed to create order' });
      }
    }
  );
}
