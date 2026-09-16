/**
 * Zalo account management routes.
 * All endpoints require authentication via authMiddleware.
 */
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { zaloPool } from './zalo-pool.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { requireRole } from '../auth/role-middleware.js';
import { requireZaloAccess } from './zalo-access-middleware.js';
import { decryptData } from '../../shared/utils/crypto.js';
import { pruneSocketsForZaloAccount } from './zalo-socket.js';
import { config } from '../../config/index.js';
import { boundedString } from '../../shared/http/request-bounds.js';

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export async function zaloRoutes(app: FastifyInstance): Promise<void> {
  // All routes in this plugin require auth
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/zalo-accounts — list accounts with live status from pool
  app.get('/api/v1/zalo-accounts', async (request) => {
    const user = request.user!;
    const accounts = await prisma.zaloAccount.findMany({
      where: user.role === 'member'
        ? { orgId: user.orgId, access: { some: { userId: user.id } } }
        : { orgId: user.orgId },
      select: {
        id: true,
        zaloUid: true,
        displayName: true,
        avatarUrl: true,
        phone: true,
        status: true,
        branchTag: true,
        colorTag: true,
        lastConnectedAt: true,
        createdAt: true,
        owner: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const accountIds = accounts.map((a) => a.id);
    const unreadAggregations = accountIds.length > 0
      ? await prisma.conversation.groupBy({
          by: ['zaloAccountId'],
          where: {
            orgId: user.orgId,
            zaloAccountId: { in: accountIds },
            unreadCount: { gt: 0 },
          },
          _sum: {
            unreadCount: true,
          },
        })
      : [];

    const unreadMap = new Map<string, number>();
    for (const item of unreadAggregations) {
      unreadMap.set(item.zaloAccountId, item._sum.unreadCount ?? 0);
    }

    // Merge live status from pool and unreadCount
    return accounts.map((a) => ({
      ...a,
      liveStatus: zaloPool.getStatus(a.id),
      unreadCount: unreadMap.get(a.id) ?? 0,
    }));
  });

  // POST /api/v1/zalo-accounts — create a new account record
  app.post<{ Body: { displayName?: string; branchTag?: string; colorTag?: string } }>(
    '/api/v1/zalo-accounts',
    { preHandler: requireRole('owner', 'admin') }, async (request, reply) => {
      const user = request.user!;
      const { displayName, branchTag, colorTag } = request.body ?? {};

      let safeDisplayName: string | null = null;
      if (typeof displayName === 'string') {
        const trimmed = boundedString(displayName.trim(), 100);
        safeDisplayName = trimmed.length > 0 ? trimmed : null;
      }

      let safeBranchTag: string | null = null;
      if (typeof branchTag === 'string') {
        const trimmed = boundedString(branchTag.trim(), 100);
        safeBranchTag = trimmed.length > 0 ? trimmed : null;
      }

      let safeColorTag: string | null = null;
      if (typeof colorTag === 'string') {
        const trimmed = colorTag.trim();
        if (trimmed.length > 0) {
          if (!HEX_COLOR_REGEX.test(trimmed)) {
            return reply.status(400).send({ error: 'Mã màu không hợp lệ, phải là định dạng hex #RRGGBB (ví dụ: #0068FF)' });
          }
          safeColorTag = trimmed.toUpperCase();
        }
      }

      const account = await prisma.zaloAccount.create({
        data: {
          orgId: user.orgId,
          ownerUserId: user.id,
          displayName: safeDisplayName,
          branchTag: safeBranchTag,
          colorTag: safeColorTag,
          status: 'qr_pending',
        },
      });

      return reply.status(201).send(account);
    },
  );

  // PATCH /api/v1/zalo-accounts/:id — update account details (displayName, branchTag, colorTag)
  app.patch<{
    Params: { id: string };
    Body: { displayName?: string | null; branchTag?: string | null; colorTag?: string | null };
  }>(
    '/api/v1/zalo-accounts/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;
      const { displayName, branchTag, colorTag } = request.body ?? {};

      const existing = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!existing) {
        return reply.status(404).send({ error: 'Account not found' });
      }

      const updateData: {
        displayName?: string | null;
        branchTag?: string | null;
        colorTag?: string | null;
      } = {};

      if (displayName !== undefined) {
        if (displayName === null) {
          updateData.displayName = null;
        } else if (typeof displayName === 'string') {
          const trimmed = boundedString(displayName.trim(), 100);
          updateData.displayName = trimmed.length > 0 ? trimmed : null;
        }
      }

      if (branchTag !== undefined) {
        if (branchTag === null) {
          updateData.branchTag = null;
        } else if (typeof branchTag === 'string') {
          const trimmed = boundedString(branchTag.trim(), 100);
          updateData.branchTag = trimmed.length > 0 ? trimmed : null;
        }
      }

      if (colorTag !== undefined) {
        if (colorTag === null) {
          updateData.colorTag = null;
        } else if (typeof colorTag === 'string') {
          const trimmed = colorTag.trim();
          if (trimmed.length === 0) {
            updateData.colorTag = null;
          } else {
            if (!HEX_COLOR_REGEX.test(trimmed)) {
              return reply.status(400).send({ error: 'Mã màu không hợp lệ, phải là định dạng hex #RRGGBB (ví dụ: #0068FF)' });
            }
            updateData.colorTag = trimmed.toUpperCase();
          }
        }
      }

      const updated = await prisma.zaloAccount.update({
        where: { id, orgId: user.orgId },
        data: updateData,
        select: {
          id: true,
          zaloUid: true,
          displayName: true,
          avatarUrl: true,
          phone: true,
          status: true,
          branchTag: true,
          colorTag: true,
          lastConnectedAt: true,
          createdAt: true,
        },
      });

      return reply.send({
        ...updated,
        liveStatus: zaloPool.getStatus(updated.id),
      });
    },
  );

  // POST /api/v1/zalo-accounts/:id/login — initiate QR login
  app.post<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/login',
    { preHandler: requireZaloAccess('admin') }, async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Account not found' });
      }

      // Fire-and-forget — QR delivered via Socket.IO
      zaloPool.loginQR(id).catch(() => {
        // errors are emitted via socket; no need to crash here
      });

      return { message: 'QR login initiated — subscribe to account:' + id + ' socket room' };
    },
  );

  // POST /api/v1/zalo-accounts/:id/reconnect — force reconnect using saved session
  app.post<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/reconnect',
    { preHandler: requireZaloAccess('admin') }, async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Account not found' });
      }

      const session = decryptData<{
        cookie: any;
        imei: string;
        userAgent: string;
      }>(account.sessionData, config.encryptionKey);

      if (!session?.imei) {
        return reply.status(400).send({ error: 'No saved session — please login with QR first' });
      }

      // Fire-and-forget — result emitted via Socket.IO
      zaloPool.reconnect(id, session).catch(() => {});

      return { message: 'Reconnect initiated' };
    },
  );

  // DELETE /api/v1/zalo-accounts/:id — disconnect and delete record
  app.delete<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id',
    { preHandler: requireRole('owner', 'admin') }, async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Account not found' });
      }

      zaloPool.disconnect(id);
      await prisma.zaloAccount.delete({ where: { id, orgId: user.orgId } });
      await pruneSocketsForZaloAccount(app.io, id);

      return reply.status(204).send();
    },
  );

  // GET /api/v1/zalo-accounts/:id/status — live status from pool
  app.get<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/status',
    { preHandler: requireZaloAccess('read') }, async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true, status: true },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Account not found' });
      }

      return { accountId: id, liveStatus: zaloPool.getStatus(id) };
    },
  );
}
