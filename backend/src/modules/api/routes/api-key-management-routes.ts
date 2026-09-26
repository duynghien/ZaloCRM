/**
 * api-key-management-routes.ts — Owner/Admin management routes for API keys.
 * Enforces composite tenant scoping, least-privilege defaults, and single-reveal key generation.
 */
import { randomBytes, createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { logger } from '../../../shared/utils/logger.js';
import { ALL_VALID_SCOPES, DEFAULT_LEAST_PRIVILEGE_SCOPES } from '../middleware/scope-guard.js';

async function requireAdminOrOwner(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const role = req.user?.role;
  if (role !== 'owner' && role !== 'admin') {
    await reply.status(403).send({ error: 'Chỉ Quản trị viên hoặc Chủ sở hữu mới có quyền quản lý API Key' });
  }
}

export async function apiKeyManagementRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/settings/api-keys — list API keys ──────────────────────────
  app.get('/api/v1/settings/api-keys', { preHandler: requireAdminOrOwner }, async (request: FastifyRequest) => {
    const user = request.user!;
    const keys = await prisma.apiKey.findMany({
      where: { orgId: user.orgId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        rateLimit: true,
        lastUsedAt: true,
        expiresAt: true,
        isActive: true,
        createdAt: true,
        revokedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { keys };
  });

  // ── POST /api/v1/settings/api-keys — generate new key ─────────────────────
  app.post('/api/v1/settings/api-keys', { preHandler: requireAdminOrOwner }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const body = (request.body as Record<string, any>) || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';

    if (!name) {
      return reply.status(400).send({ error: 'Tên khóa API là bắt buộc' });
    }

    let scopes: string[] = DEFAULT_LEAST_PRIVILEGE_SCOPES;
    if (Array.isArray(body.scopes) && body.scopes.length > 0) {
      const valid = body.scopes.filter((s: string) => ALL_VALID_SCOPES.includes(s));
      if (valid.length > 0) scopes = valid;
    }

    const rateLimit = typeof body.rateLimit === 'number' && body.rateLimit > 0
      ? Math.min(Math.max(body.rateLimit, 1), 1000)
      : 60;

    let expiresAt: Date | null = null;
    if (body.expiresAt) {
      const parsed = new Date(body.expiresAt);
      if (!isNaN(parsed.getTime())) expiresAt = parsed;
    }

    const rawKey = `zcrm_${randomBytes(24).toString('hex')}`;
    const keyPrefix = rawKey.slice(0, 12);
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const created = await prisma.apiKey.create({
      data: {
        orgId: user.orgId,
        name,
        keyPrefix,
        keyHash,
        scopes,
        rateLimit,
        expiresAt,
        createdById: user.id,
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        rateLimit: true,
        expiresAt: true,
        isActive: true,
        createdAt: true,
      },
    });

    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    reply.header('Pragma', 'no-cache');
    reply.header('Expires', '0');

    return reply.status(201).send({
      ...created,
      apiKey: rawKey,
      key: rawKey,
    });
  });

  // ── PUT /api/v1/settings/api-keys/:id — update key ─────────────────────────
  app.put('/api/v1/settings/api-keys/:id', { preHandler: requireAdminOrOwner }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const body = (request.body as Record<string, any>) || {};

    const existing = await prisma.apiKey.findFirst({
      where: { id, orgId: user.orgId },
    });
    if (!existing) {
      return reply.status(404).send({ error: 'Không tìm thấy API Key' });
    }
    if (existing.revokedAt) {
      return reply.status(400).send({ error: 'Khóa API đã bị thu hồi vĩnh viễn, không thể chỉnh sửa' });
    }

    const data: any = {};
    if (typeof body.name === 'string' && body.name.trim()) {
      data.name = body.name.trim();
    }
    if (Array.isArray(body.scopes) && body.scopes.length > 0) {
      data.scopes = body.scopes.filter((s: string) => ALL_VALID_SCOPES.includes(s));
    }
    if (typeof body.rateLimit === 'number' && body.rateLimit > 0) {
      data.rateLimit = Math.min(Math.max(body.rateLimit, 1), 1000);
    }
    if (typeof body.isActive === 'boolean') {
      data.isActive = body.isActive;
    }
    if (body.expiresAt !== undefined) {
      data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    }

    const updated = await prisma.apiKey.update({
      where: { id: existing.id },
      data,
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        rateLimit: true,
        lastUsedAt: true,
        expiresAt: true,
        isActive: true,
        createdAt: true,
        revokedAt: true,
      },
    });

    return updated;
  });

  // ── DELETE /api/v1/settings/api-keys/:id — revoke key ──────────────────────
  app.delete('/api/v1/settings/api-keys/:id', { preHandler: requireAdminOrOwner }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const existing = await prisma.apiKey.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true, revokedAt: true },
    });
    if (!existing) {
      return reply.status(404).send({ error: 'Không tìm thấy API Key' });
    }

    await prisma.apiKey.update({
      where: { id: existing.id },
      data: {
        isActive: false,
        revokedAt: existing.revokedAt || new Date(),
      },
    });

    return { success: true };
  });
}
