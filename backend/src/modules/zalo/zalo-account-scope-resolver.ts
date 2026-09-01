import type { FastifyRequest } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';

/** Resolve an account identifier without trusting a route parameter's shape. */
export async function resolveZaloAccountId(
  request: FastifyRequest,
): Promise<string | null> {
  const user = request.user;
  if (!user) return null;

  const params = request.params as Record<string, string | undefined>;
  const explicitAccountId = params.zaloAccountId ?? params.accountId;
  const isConversationRoute = (request.routeOptions.url ?? '').includes('/conversations/');

  if (isConversationRoute && params.id) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: params.id, orgId: user.orgId },
      select: { zaloAccountId: true },
    });
    return conversation?.zaloAccountId ?? null;
  }

  const accountId = explicitAccountId ?? params.id;
  if (!accountId) return null;
  const account = await prisma.zaloAccount.findFirst({
    where: { id: accountId, orgId: user.orgId },
    select: { id: true },
  });
  return account?.id ?? null;
}
