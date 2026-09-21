/**
 * appointment-routes.ts — REST API for appointment management.
 * Supports list, detail, create, update, delete, today, and upcoming endpoints.
 * All routes require JWT auth and are scoped to user's org.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { assertContactInOrg, assertUserInOrg } from '../../shared/security/tenant-assertions.js';
import { TenantIsolationError } from '../../shared/errors/index.js';
import { boundedPositiveInt } from '../../shared/http/request-bounds.js';
import { RequestValidationError } from '../../shared/http/request-schemas.js';

type QueryParams = Record<string, string>;

const APPOINTMENT_INCLUDE = {
  contact: { select: { id: true, fullName: true, phone: true, avatarUrl: true } },
  assignedUser: { select: { id: true, fullName: true } },
} as const;

export async function appointmentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/appointments/today — today's appointments ─────────────────
  app.get('/api/v1/appointments/today', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

      const appointments = await prisma.appointment.findMany({
        where: { orgId: user.orgId, appointmentDate: { gte: start, lte: end } },
        include: APPOINTMENT_INCLUDE,
        orderBy: [{ appointmentTime: 'asc' }, { appointmentDate: 'asc' }],
      });

      return { appointments, total: appointments.length };
    } catch (err) {
      logger.error('[appointments] Today error:', err);
      return reply.status(500).send({ error: 'Failed to fetch today appointments' });
    }
  });

  // ── GET /api/v1/appointments/upcoming — next 7 days ───────────────────────
  app.get('/api/v1/appointments/upcoming', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const now = new Date();
      const in7Days = new Date(now);
      in7Days.setDate(in7Days.getDate() + 7);

      const appointments = await prisma.appointment.findMany({
        where: {
          orgId: user.orgId,
          appointmentDate: { gte: now, lte: in7Days },
          status: 'scheduled',
        },
        include: APPOINTMENT_INCLUDE,
        orderBy: [{ appointmentDate: 'asc' }, { appointmentTime: 'asc' }],
      });

      return { appointments, total: appointments.length };
    } catch (err) {
      logger.error('[appointments] Upcoming error:', err);
      return reply.status(500).send({ error: 'Failed to fetch upcoming appointments' });
    }
  });

  // ── GET /api/v1/appointments — list with filters ──────────────────────────
  app.get('/api/v1/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const {
        page = '1',
        limit = '50',
        status = '',
        contactId = '',
        dateFrom = '',
        dateTo = '',
      } = request.query as QueryParams;

      const pageNum = boundedPositiveInt(page, 1, 10_000);
      const limitNum = boundedPositiveInt(limit, 50, 100);

      const where: any = { orgId: user.orgId };
      if (status) where.status = status;
      if (contactId) where.contactId = contactId;
      if (dateFrom || dateTo) {
        where.appointmentDate = {};
        if (dateFrom) {
          const fromDate = new Date(dateFrom);
          if (isNaN(fromDate.getTime())) {
            return reply.status(400).send({ error: 'Invalid dateFrom format' });
          }
          where.appointmentDate.gte = fromDate;
        }
        if (dateTo) {
          const toDate = new Date(dateTo);
          if (isNaN(toDate.getTime())) {
            return reply.status(400).send({ error: 'Invalid dateTo format' });
          }
          where.appointmentDate.lte = toDate;
        }
      }

      const [appointments, total] = await Promise.all([
        prisma.appointment.findMany({
          where,
          include: APPOINTMENT_INCLUDE,
          orderBy: [{ appointmentDate: 'desc' }, { appointmentTime: 'asc' }],
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.appointment.count({ where }),
      ]);

      return { appointments, total, page: pageNum, limit: limitNum };
    } catch (err: any) {
      if (err instanceof RequestValidationError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      logger.error('[appointments] List error:', err);
      return reply.status(500).send({ error: 'Failed to fetch appointments' });
    }
  });

  // ── GET /api/v1/appointments/:id — detail ─────────────────────────────────
  app.get('/api/v1/appointments/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const appointment = await prisma.appointment.findFirst({
        where: { id, orgId: user.orgId },
        include: APPOINTMENT_INCLUDE,
      });

      if (!appointment) return reply.status(404).send({ error: 'Appointment not found' });
      return appointment;
    } catch (err) {
      logger.error('[appointments] Detail error:', err);
      return reply.status(500).send({ error: 'Failed to fetch appointment' });
    }
  });

  // ── POST /api/v1/appointments — create ────────────────────────────────────
  app.post('/api/v1/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as Record<string, any>;

      if (!body.contactId || !body.appointmentDate) {
        return reply.status(400).send({ error: 'contactId and appointmentDate are required' });
      }

      const appointmentDate = new Date(body.appointmentDate);
      if (isNaN(appointmentDate.getTime())) {
        return reply.status(400).send({ error: 'Invalid appointmentDate' });
      }

      await assertContactInOrg(prisma, user.orgId, body.contactId);
      if (body.assignedUserId) {
        await assertUserInOrg(prisma, user.orgId, body.assignedUserId, { requireActive: true });
      }

      // Deduplication: prevent same contact + same date within org
      const existing = await prisma.appointment.findFirst({
        where: {
          contactId: body.contactId,
          appointmentDate,
          orgId: user.orgId,
        },
      });
      if (existing) {
        return reply.status(409).send({ error: 'Lịch hẹn đã tồn tại cho ngày này' });
      }

      const appointment = await prisma.appointment.create({
        data: {
          orgId: user.orgId,
          contactId: body.contactId,
          assignedUserId: body.assignedUserId ?? user.id,
          appointmentDate,
          appointmentTime: body.appointmentTime,
          type: body.type,
          status: body.status ?? 'scheduled',
          notes: body.notes,
        },
        include: APPOINTMENT_INCLUDE,
      });

      return reply.status(201).send(appointment);
    } catch (err: any) {
      if (err instanceof TenantIsolationError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      logger.error('[appointments] Create error:', err);
      return reply.status(500).send({ error: 'Failed to create appointment' });
    }
  });

  // ── PUT /api/v1/appointments/:id — update ─────────────────────────────────
  app.put('/api/v1/appointments/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, any>;

      const existing = await prisma.appointment.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Appointment not found' });

      if (body.contactId !== undefined) {
        await assertContactInOrg(prisma, user.orgId, body.contactId);
      }
      if (body.assignedUserId !== undefined && body.assignedUserId !== null) {
        await assertUserInOrg(prisma, user.orgId, body.assignedUserId, { requireActive: true });
      }

      let parsedDate: Date | undefined;
      if (body.appointmentDate !== undefined) {
        parsedDate = new Date(body.appointmentDate);
        if (isNaN(parsedDate.getTime())) {
          return reply.status(400).send({ error: 'Invalid appointmentDate' });
        }
      }

      const updated = await prisma.appointment.update({
        where: { id },
        data: {
          contactId: body.contactId,
          assignedUserId: body.assignedUserId,
          appointmentDate: parsedDate,
          appointmentTime: body.appointmentTime,
          type: body.type,
          status: body.status,
          notes: body.notes,
        },
        include: APPOINTMENT_INCLUDE,
      });

      return updated;
    } catch (err: any) {
      if (err instanceof TenantIsolationError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      logger.error('[appointments] Update error:', err);
      return reply.status(500).send({ error: 'Failed to update appointment' });
    }
  });

  // ── DELETE /api/v1/appointments/:id — delete ──────────────────────────────
  app.delete('/api/v1/appointments/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const existing = await prisma.appointment.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Appointment not found' });

      await prisma.appointment.delete({ where: { id } });
      return { success: true };
    } catch (err) {
      logger.error('[appointments] Delete error:', err);
      return reply.status(500).send({ error: 'Failed to delete appointment' });
    }
  });
}
