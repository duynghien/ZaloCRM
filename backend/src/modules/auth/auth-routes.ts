/** Setup, login, refresh rotation, logout, and profile endpoints. */
import '@fastify/cookie';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/index.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from './auth-middleware.js';
import { checkSetupStatus, createSession, getProfile, login, revokeSession, revokeUserSessions, rotateSession, setup, validatePassword } from './auth-service.js';

function cookieOptions(expiresAt?: Date) {
  return { httpOnly: true, secure: config.isProduction, sameSite: 'lax' as const, path: '/api/v1/auth', ...(expiresAt ? { expires: expiresAt } : {}) };
}

function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(config.refreshCookieName, cookieOptions());
  reply.clearCookie(config.csrfCookieName, { secure: config.isProduction, sameSite: 'lax', path: '/' });
}

function setSessionCookies(reply: FastifyReply, refreshToken: string, expiresAt: Date): string {
  const csrfToken = randomBytes(32).toString('base64url');
  reply.setCookie(config.refreshCookieName, refreshToken, cookieOptions(expiresAt));
  // The SPA reads this non-secret double-submit value from any protected route.
  // The refresh credential itself remains HttpOnly and limited to auth endpoints.
  reply.setCookie(config.csrfCookieName, csrfToken, { httpOnly: false, secure: config.isProduction, sameSite: 'lax', path: '/', expires: expiresAt });
  return csrfToken;
}

function assertBrowserRequest(request: FastifyRequest): void {
  const origin = request.headers.origin;
  const referer = request.headers.referer;
  const requestOrigin = origin || (referer ? new URL(referer).origin : '');
  if (!requestOrigin || requestOrigin !== config.appOrigin) throw Object.assign(new Error('Invalid request origin'), { statusCode: 403 });
  const csrfCookie = request.cookies[config.csrfCookieName];
  const csrfHeader = request.headers['x-csrf-token'];
  if (!csrfCookie || typeof csrfHeader !== 'string' || csrfCookie !== csrfHeader) throw Object.assign(new Error('Invalid CSRF token'), { statusCode: 403 });
}

function currentSessionId(request: FastifyRequest): string {
  return (request.user as { sessionId?: string }).sessionId || '';
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/setup/status', async () => checkSetupStatus());

  app.post<{ Body: { orgName: string; fullName: string; email: string; password: string } }>('/api/v1/setup', { config: { rateLimit: { max: 3, timeWindow: '1 hour' } } }, async (request, reply) => {
    const { orgName, fullName, email, password } = request.body;
    if (!orgName || !fullName || !email || !password) return reply.status(400).send({ error: 'Missing required fields' });
    const user = await setup(orgName, fullName, email, password);
    const tokens = await createSession(app, user);
    setSessionCookies(reply, tokens.refreshToken, tokens.expiresAt);
    return { token: tokens.accessToken, user };
  });

  app.post<{ Body: { email: string; password: string } }>('/api/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { email, password } = request.body;
    if (!email || !password) return reply.status(400).send({ error: 'Missing email or password' });
    const user = await login(email, password);
    const tokens = await createSession(app, user);
    setSessionCookies(reply, tokens.refreshToken, tokens.expiresAt);
    return { token: tokens.accessToken, user };
  });

  app.post('/api/v1/auth/refresh', async (request, reply) => {
    try {
      assertBrowserRequest(request);
      const refreshToken = request.cookies[config.refreshCookieName];
      if (!refreshToken) return reply.status(401).send({ error: 'Missing refresh session' });
      const { tokens, identity } = await rotateSession(app, refreshToken);
      setSessionCookies(reply, tokens.refreshToken, tokens.expiresAt);
      return { token: tokens.accessToken, user: identity };
    } catch (error) {
      clearSessionCookies(reply);
      throw error;
    }
  });

  app.post('/api/v1/auth/logout', { preHandler: authMiddleware }, async (request, reply) => {
    assertBrowserRequest(request);
    const sessionId = currentSessionId(request);
    if (sessionId) await revokeSession(sessionId, 'logout');
    clearSessionCookies(reply);
    return { success: true };
  });

  app.post('/api/v1/auth/logout-all', { preHandler: authMiddleware }, async (request, reply) => {
    assertBrowserRequest(request);
    await revokeUserSessions(request.user.id, 'logout_all');
    clearSessionCookies(reply);
    return { success: true };
  });

  // Owner password recovery is self-service; administrators never target Owner security state.
  app.post<{ Body: { currentPassword: string; newPassword: string } }>('/api/v1/auth/password', { preHandler: authMiddleware }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body;
    if (!currentPassword || !newPassword) return reply.status(400).send({ error: 'Missing password fields' });
    validatePassword(newPassword);
    const user = await prisma.user.findUnique({ where: { id: request.user.id }, select: { passwordHash: true } });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) return reply.status(401).send({ error: 'Current password is invalid' });
    await prisma.user.update({ where: { id: request.user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12) } });
    await revokeUserSessions(request.user.id, 'password_changed');
    clearSessionCookies(reply);
    return { success: true };
  });

  app.get('/api/v1/profile', { preHandler: authMiddleware }, async (request) => getProfile(request.user.id));
}
