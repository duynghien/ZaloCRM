/**
 * public-api-routes.ts — External REST API authenticated via API key (X-Api-Key header).
 * Provides read/write access to contacts, conversations, appointments, and message sending.
 * All routes prefixed /api/public/ — no JWT required, orgId injected from API key lookup.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { boundedPositiveInt, boundedString, validOptionalDate } from '../../shared/http/request-bounds.js';

import crypto from 'node:crypto';
import { validatePublicRequest } from './public-api-schemas.js';
import { messageDeliveryService } from '../zalo/message-delivery-service.js';

// ── API key auth middleware ────────────────────────────────────────────────────

async function apiKeyAuth(request: FastifyRequest, reply: FastifyReply) {
  const apiKey = request.headers['x-api-key'] as string;
  if (!apiKey || typeof apiKey !== 'string') {
    return reply.status(401).send({ error: 'API key required' });
  }

  // 1. Primary: SHA-256 hash lookup
  const incomingHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const hashedSetting = await prisma.appSetting.findFirst({
    where: { settingKey: 'public_api_key_hash', valuePlain: incomingHash },
  });

  if (hashedSetting) {
    (request as any).orgId = hashedSetting.orgId;
    return;
  }

  // 2. Backward-compatible fallback: legacy plaintext lookup with lazy migration
  const legacySetting = await prisma.appSetting.findFirst({
    where: { settingKey: 'public_api_key', valuePlain: apiKey },
  });

  if (legacySetting) {
    (request as any).orgId = legacySetting.orgId;

    // Atomically upgrade and purge legacy plaintext key
    const prefix = apiKey.slice(0, 10);
    prisma.$transaction([
      prisma.appSetting.upsert({
        where: { orgId_settingKey: { orgId: legacySetting.orgId, settingKey: 'public_api_key_hash' } },
        create: { orgId: legacySetting.orgId, settingKey: 'public_api_key_hash', valuePlain: incomingHash },
        update: { valuePlain: incomingHash },
      }),
      prisma.appSetting.upsert({
        where: { orgId_settingKey: { orgId: legacySetting.orgId, settingKey: 'public_api_key_prefix' } },
        create: { orgId: legacySetting.orgId, settingKey: 'public_api_key_prefix', valuePlain: prefix },
        update: { valuePlain: prefix },
      }),
      prisma.appSetting.deleteMany({
        where: { orgId: legacySetting.orgId, settingKey: 'public_api_key' },
      }),
    ]).catch((err) => {
      logger.warn(`[public-api] Failed to lazy upgrade and purge legacy API key for org ${legacySetting.orgId}:`, err);
    });

    return;
  }

  return reply.status(401).send({ error: 'Invalid API key' });
}

// ── Route registration ────────────────────────────────────────────────────────

export async function publicApiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', apiKeyAuth);
  app.addHook('preHandler', validatePublicRequest);

  // ── Contacts ─────────────────────────────────────────────────────────────

  app.get('/api/public/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const { search = '', status = '', limit = '20' } = request.query as Record<string, string>;
      const safeSearch = boundedString(search, 200);
      const safeStatus = boundedString(status, 50);
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

      const contacts = await prisma.contact.findMany({
        where,
        select: {
          id: true, fullName: true, phone: true, email: true,
          source: true, status: true, notes: true, tags: true,
          createdAt: true, updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: limitNum,
      });

      return { contacts };
    } catch (err) {
      logger.error('[public-api] GET /contacts error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contacts' });
    }
  });

  app.get('/api/public/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
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
  });

  app.post('/api/public/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const body = request.body as Record<string, any>;

      if (!body?.fullName && !body?.phone) {
        return reply.status(400).send({ error: 'fullName or phone is required' });
      }

      const contact = await prisma.contact.create({
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

      return reply.status(201).send(contact);
    } catch (err) {
      logger.error('[public-api] POST /contacts error:', err);
      return reply.status(500).send({ error: 'Failed to create contact' });
    }
  });

  app.put('/api/public/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, any>;

      const existing = await prisma.contact.findFirst({ where: { id, orgId }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Contact not found' });

      const updated = await prisma.contact.update({
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

      return updated;
    } catch (err) {
      logger.error('[public-api] PUT /contacts/:id error:', err);
      return reply.status(500).send({ error: 'Failed to update contact' });
    }
  });

  // ── Conversations ─────────────────────────────────────────────────────────

  app.get('/api/public/conversations', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const { limit = '20' } = request.query as Record<string, string>;
      const limitNum = boundedPositiveInt(limit, 20, 100);

      const conversations = await prisma.conversation.findMany({
        where: { orgId },
        select: {
          id: true, threadType: true, externalThreadId: true,
          lastMessageAt: true, unreadCount: true, isReplied: true,
          contact: { select: { id: true, fullName: true, phone: true, avatarUrl: true } },
        },
        orderBy: { lastMessageAt: 'desc' },
        take: limitNum,
      });

      return { conversations };
    } catch (err) {
      logger.error('[public-api] GET /conversations error:', err);
      return reply.status(500).send({ error: 'Failed to fetch conversations' });
    }
  });

  app.get('/api/public/conversations/:id/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const { id } = request.params as { id: string };
      const { limit = '50' } = request.query as Record<string, string>;
      const limitNum = boundedPositiveInt(limit, 50, 200);

      const conv = await prisma.conversation.findFirst({ where: { id, orgId }, select: { id: true } });
      if (!conv) return reply.status(404).send({ error: 'Conversation not found' });

      const messages = await prisma.message.findMany({
        where: { conversationId: id, isDeleted: false },
        orderBy: { sentAt: 'desc' },
        take: limitNum,
        select: {
          id: true, senderType: true, senderName: true,
          content: true, contentType: true, sentAt: true, attachments: true,
        },
      });

      return { messages };
    } catch (err) {
      logger.error('[public-api] GET /conversations/:id/messages error:', err);
      return reply.status(500).send({ error: 'Failed to fetch messages' });
    }
  });

  // ── Appointments ──────────────────────────────────────────────────────────

  app.get('/api/public/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const { from, to } = request.query as Record<string, string>;
      const fromDate = validOptionalDate(from);
      const toDate = validOptionalDate(to);
      if ((from && !fromDate) || (to && !toDate)) return reply.status(400).send({ error: 'Invalid appointment date range' });

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
  });

  app.post('/api/public/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const body = request.body as Record<string, any>;

      if (!body?.contactId || !body?.appointmentDate) {
        return reply.status(400).send({ error: 'contactId and appointmentDate are required' });
      }

      const contact = await prisma.contact.findFirst({ where: { id: body.contactId, orgId }, select: { id: true } });
      if (!contact) return reply.status(404).send({ error: 'Contact not found' });

      const appointment = await prisma.appointment.create({
        data: {
          orgId,
          contactId: body.contactId,
          appointmentDate: new Date(body.appointmentDate),
          appointmentTime: body.appointmentTime,
          type: body.type,
          notes: body.notes,
        },
      });

      return reply.status(201).send(appointment);
    } catch (err) {
      logger.error('[public-api] POST /appointments error:', err);
      return reply.status(500).send({ error: 'Failed to create appointment' });
    }
  });

  // ── Messages send ─────────────────────────────────────────────────────────

  app.post('/api/public/messages/send', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const body = request.body as Record<string, any>;

      if (!body?.zaloAccountId || !body?.threadId || !body?.content) {
        return reply.status(400).send({ error: 'zaloAccountId, threadId, and content are required' });
      }

      if (typeof body.content === 'string' && body.content.length > 10_000) {
        return reply.status(400).send({ error: 'Nội dung tin nhắn không được vượt quá 10,000 ký tự' });
      }

      const idempotencyKey =
        (request.headers['idempotency-key'] as string | undefined) ||
        (request.headers['x-idempotency-key'] as string | undefined) ||
        body.idempotencyKey ||
        body.clientMessageId;

      const result = await messageDeliveryService.sendMessage({
        orgId,
        zaloAccountId: body.zaloAccountId,
        threadId: body.threadId,
        threadType: body.threadType,
        content: body.content,
        source: 'public_api',
        force: body.force === true,
        idempotencyKey,
      });

      return {
        success: true,
        messageId: result.message.id,
        conversationId: result.conversationId,
        zaloMsgId: result.zaloMsgId,
      };
    } catch (err: any) {
      logger.error('[public-api] POST /messages/send error:', err);
      const statusCode = err?.statusCode || (err?.message?.includes('not found') ? 404 : 500);
      return reply.status(statusCode).send({
        error: err?.message || 'Failed to send message',
        canForce: err?.canForce,
        code: err?.code,
      });
    }
  });
}
