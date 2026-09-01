/**
 * Zalo access middleware — checks if user has sufficient permission on a Zalo account.
 * Permission hierarchy: admin > chat > read.
 * Owner/admin roles bypass the check (they have access to all accounts in their org).
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { resolveZaloAccountId } from './zalo-account-scope-resolver.js';

export type Permission = 'read' | 'chat' | 'admin';

const hierarchy: Record<Permission, number> = { read: 1, chat: 2, admin: 3 };

export async function hasZaloAccess(user: { id: string; orgId: string; role: string }, zaloAccountId: string, minPermission: Permission): Promise<boolean> {
  const account = await prisma.zaloAccount.findFirst({ where: { id: zaloAccountId, orgId: user.orgId }, select: { id: true } });
  if (!account) return false;
  if (['owner', 'admin'].includes(user.role)) return true;
  const access = await prisma.zaloAccountAccess.findFirst({ where: { zaloAccountId, userId: user.id }, select: { permission: true } });
  return !!access && (hierarchy[access.permission as Permission] ?? 0) >= hierarchy[minPermission];
}

// Factory: returns a preHandler that checks the user has at least minPermission on the Zalo account
export function requireZaloAccess(minPermission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;

    const zaloAccountId = await resolveZaloAccountId(request);
    if (!zaloAccountId) return reply.status(404).send({ error: 'Not found' });

    try {
      if (!(await hasZaloAccess(user, zaloAccountId, minPermission))) {
        return reply.status(403).send({ error: 'Không có quyền truy cập tài khoản Zalo này' });
      }
    } catch {
      return reply.status(500).send({ error: 'Internal error checking access' });
    }
  };
}
