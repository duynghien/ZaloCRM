/**
 * public-appointments-routes.ts — Public REST API for appointment creation and querying.
 * Enforces appointments:read/appointments:write scopes and transactional outbox events.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { validOptionalDate } from '../../../shared/http/request-bounds.js';
import { requireApiKeyScope } from '../middleware/scope-guard.js';
import { enqueueWebhook } from '../webhook-service.js';

export async function publicAppointmentsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/public/appointments
  app.get(
    '/api/public/appointments',
    { preHandler: [requireApiKeyScope('appointments:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const orgId = (request as any).orgId as string;
        const { from, to } = request.query as Record<string, string>;
        const fromDate = validOptionalDate(from);
        const toDate = validOptionalDate(to);
        if ((from && !fromDate) || (to && !toDate)) {
          return reply.status(400).send({ error: 'Invalid appointment date range' });
        }

        const where: any = { orgId };
        if (fromDate || toDate) {
          where.appointmentDate = {};
          if (fromDate) where.appointmentDate.gte = fromDate;
          if (toDate) where.appointmentDate.lte = toDate;
        }

        const appointments = await prisma.appointment.findMany({
          where,
          include: { contact: { select: { id: true, fullName: true, phone: true } } },
          orderBy: { appointmentDate: 'asc' },
          take: 100,
        });

        return { appointments };
      } catch (err) {
        logger.error('[public-api] GET /appointments error:', err);
        return reply.status(500).send({ error: 'Failed to fetch appointments' });
      }
    }
  );

  // POST /api/public/appointments
  app.post(
    '/api/public/appointments',
    { preHandler: [requireApiKeyScope('appointments:write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const orgId = (request as any).orgId as string;
        const body = request.body as Record<string, any>;

        if (!body?.contactId || !body?.appointmentDate) {
          return reply.status(400).send({ error: 'contactId and appointmentDate are required' });
        }

        const appointment = await prisma.$transaction(async (tx) => {
          const contact = await tx.contact.findFirst({
            where: { id: body.contactId, orgId },
            select: { id: true },
          });
          if (!contact) return null;

          const created = await tx.appointment.create({
            data: {
              orgId,
              contactId: body.contactId,
              appointmentDate: new Date(body.appointmentDate),
              appointmentTime: body.appointmentTime,
              type: body.type,
              notes: body.notes,
            },
          });

          await enqueueWebhook(tx, orgId, 'appointment.created', created);
          return created;
        });

        if (!appointment) {
          return reply.status(404).send({ error: 'Contact not found' });
        }

        return reply.status(201).send(appointment);
      } catch (err) {
        logger.error('[public-api] POST /appointments error:', err);
        return reply.status(500).send({ error: 'Failed to create appointment' });
      }
    }
  );
}
