/**
 * public-zalo-accounts-routes.ts — Public REST API for connected Zalo accounts.
 * Returns account list with strict whitelist projection to prevent sessionData leaks.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { requireApiKeyScope } from '../middleware/scope-guard.js';

export async function publicZaloAccountsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/public/zalo-accounts',
    { preHandler: [requireApiKeyScope('zalo_accounts:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const orgId = (request as any).orgId as string;

        // Strict whitelist projection — NEVER include sessionData
        const accounts = await prisma.zaloAccount.findMany({
          where: { orgId },
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            phone: true,
            status: true,
            lastConnectedAt: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        const mapped = accounts.map((a) => ({
          id: a.id,
          name: a.displayName,
          avatarUrl: a.avatarUrl,
          phone: a.phone,
          isConnected: a.status === 'connected',
          lastActiveAt: a.lastConnectedAt,
        }));

        return { accounts: mapped };
      } catch (err) {
        logger.error('[public-api] GET /zalo-accounts error:', err);
        return reply.status(500).send({ error: 'Failed to fetch Zalo accounts' });
      }
    }
  );
}
