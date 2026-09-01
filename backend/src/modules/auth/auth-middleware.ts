/**
 * Auth middleware — verifies JWT on protected routes.
 * JWT user shape is defined in shared/types/fastify-jwt-user.d.ts.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { validateSessionUser } from './auth-service.js';

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
    const claims = request.user as { id: string; sessionId?: string };
    if (!claims.sessionId) throw new Error('Legacy token rejected');
    const user = await validateSessionUser(claims.sessionId, claims.id);
    request.user = { ...user, sessionId: claims.sessionId } as typeof request.user;
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}
