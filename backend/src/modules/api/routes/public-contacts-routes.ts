/**
 * public-contacts-routes.ts — Public REST API for contacts management.
 * Provides GET, POST, PUT /contacts with pagination and dual response key compatibility.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { boundedPositiveInt, boundedString } from '../../../shared/http/request-bounds.js';
import { requireApiKeyScope } from '../middleware/scope-guard.js';
import { enqueueWebhook } from '../webhook-service.js';

export async function publicContactsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/public/contacts
  app.get(
    '/api/public/contacts',
    { preHandler: [requireApiKeyScope('contacts:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const orgId = (request as any).orgId as string;
        const { search = '', status = '', page = '1', limit = '20' } = request.query as Record<string, string>;
        const safeSearch = boundedString(search, 200);
        const safeStatus = boundedString(status, 50);
        const pageNum = boundedPositiveInt(page, 1, 10_000);
        const limitNum = boundedPositiveInt(limit, 20, 100);

        const where: any = { orgId };
        if (safeStatus) where.status = safeStatus;
        if (safeSearch) {
          where.OR = [
            { fullName: { contains: safeSearch, mode: 'insensitive' } },
            { phone: { contains: safeSearch } },
            { email: { contains: safeSearch, mode: 'insensitive' } },
          ];
        }

        const [contacts, total] = await Promise.all([
          prisma.contact.findMany({
            where,
            select: {
              id: true, fullName: true, phone: true, email: true,
              source: true, status: true, notes: true, tags: true,
              createdAt: true, updatedAt: true,
            },
            orderBy: { updatedAt: 'desc' },
            skip: (pageNum - 1) * limitNum,
            take: limitNum,
          }),
          prisma.contact.count({ where }),
        ]);

        const totalPages = Math.ceil(total / limitNum) || 1;
        return {
          contacts,
          data: contacts,
          pagination: { page: pageNum, limit: limitNum, total, totalPages },
        };
      } catch (err) {
        logger.error('[public-api] GET /contacts error:', err);
        return reply.status(500).send({ error: 'Failed to fetch contacts' });
      }
    }
  );

  // GET /api/public/contacts/:id
  app.get(
    '/api/public/contacts/:id',
    { preHandler: [requireApiKeyScope('contacts:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const orgId = (request as any).orgId as string;
        const { id } = request.params as { id: string };

        const contact = await prisma.contact.findFirst({
          where: { id, orgId },
          include: {
            appointments: { orderBy: { appointmentDate: 'desc' }, take: 5 },
            _count: { select: { conversations: true } },
          },
        });

        if (!contact) return reply.status(404).send({ error: 'Contact not found' });
        return contact;
      } catch (err) {
        logger.error('[public-api] GET /contacts/:id error:', err);
        return reply.status(500).send({ error: 'Failed to fetch contact' });
      }
    }
  );

  // POST /api/public/contacts
  app.post(
    '/api/public/contacts',
    { preHandler: [requireApiKeyScope('contacts:write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const orgId = (request as any).orgId as string;
        const body = request.body as Record<string, any>;

        if (!body?.fullName && !body?.phone) {
          return reply.status(400).send({ error: 'fullName or phone is required' });
        }

        const contact = await prisma.$transaction(async (tx) => {
          const created = await tx.contact.create({
            data: {
              orgId,
              fullName: body.fullName,
              phone: body.phone,
              email: body.email,
              source: body.source,
              status: body.status ?? 'new',
              notes: body.notes,
              tags: body.tags ?? [],
            },
          });
          await enqueueWebhook(tx, orgId, 'contact.created', created);
          return created;
        });

        return reply.status(201).send(contact);
      } catch (err) {
        logger.error('[public-api] POST /contacts error:', err);
        return reply.status(500).send({ error: 'Failed to create contact' });
      }
    }
  );

  // PUT /api/public/contacts/:id
  app.put(
    '/api/public/contacts/:id',
    { preHandler: [requireApiKeyScope('contacts:write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const orgId = (request as any).orgId as string;
        const { id } = request.params as { id: string };
        const body = request.body as Record<string, any>;

        const existing = await prisma.contact.findFirst({ where: { id, orgId }, select: { id: true } });
        if (!existing) return reply.status(404).send({ error: 'Contact not found' });

        const updated = await prisma.$transaction(async (tx) => {
          const res = await tx.contact.update({
            where: { id },
            data: {
              fullName: body.fullName,
              phone: body.phone,
              email: body.email,
              source: body.source,
              status: body.status,
              notes: body.notes,
              tags: body.tags,
            },
          });
          await enqueueWebhook(tx, orgId, 'contact.updated', res);
          return res;
        });

        return updated;
      } catch (err) {
        logger.error('[public-api] PUT /contacts/:id error:', err);
        return reply.status(500).send({ error: 'Failed to update contact' });
      }
    }
  );
}
