/** Setup, login, refresh rotation, logout, and profile endpoints. */
import '@fastify/cookie';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/index.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from './auth-middleware.js';
import { checkSetupStatus, createSession, getProfile, login, revokeSession, revokeUserSessions, rotateSession, setup, validatePassword } from './auth-service.js';

function isSecureCookie(request?: FastifyRequest): boolean {
  if (request) {
    const proto = request.protocol || (request.headers['x-forwarded-proto'] as string);
    if (proto === 'https') return true;
    if (proto === 'http') return false;
  }
  return config.isProduction && config.appUrl.startsWith('https://');
}

function cookieOptions(request?: FastifyRequest, expiresAt?: Date) {
  return { httpOnly: true, secure: isSecureCookie(request), sameSite: 'lax' as const, path: '/api/v1/auth', ...(expiresAt ? { expires: expiresAt } : {}) };
}

function mediaCookieOptions(request?: FastifyRequest, expiresAt?: Date) {
  return { httpOnly: true, secure: isSecureCookie(request), sameSite: 'lax' as const, path: '/api/v1/attachments', ...(expiresAt ? { expires: expiresAt } : {}) };
}

function clearSessionCookies(reply: FastifyReply, request?: FastifyRequest): void {
  reply.clearCookie(config.refreshCookieName, cookieOptions(request));
  reply.clearCookie(config.csrfCookieName, { secure: isSecureCookie(request), sameSite: 'lax', path: '/' });
  reply.clearCookie(config.mediaCookieName || 'zalo_crm_media_session', mediaCookieOptions(request));
}

function setSessionCookies(reply: FastifyReply, app: FastifyInstance, user: { id: string; orgId: string; role: string }, refreshToken: string, expiresAt: Date, request?: FastifyRequest): string {
  const csrfToken = randomBytes(32).toString('base64url');
  reply.setCookie(config.refreshCookieName, refreshToken, cookieOptions(request, expiresAt));
  // The SPA reads this non-secret double-submit value from any protected route.
  // The refresh credential itself remains HttpOnly and limited to auth endpoints.
  reply.setCookie(config.csrfCookieName, csrfToken, { httpOnly: false, secure: isSecureCookie(request), sameSite: 'lax', path: '/', expires: expiresAt });

  const mediaToken = app.jwt.sign(
    { id: user.id, email: (user as any).email || '', orgId: user.orgId, role: user.role, sessionId: 'media' } as never,
    { expiresIn: '7d' },
  );
  reply.setCookie(config.mediaCookieName || 'zalo_crm_media_session', mediaToken, mediaCookieOptions(request, expiresAt));

  return csrfToken;
}

function assertBrowserRequest(request: FastifyRequest): void {
  const origin = request.headers.origin;
  const referer = request.headers.referer;
  const requestOrigin = origin || (referer ? new URL(referer).origin : '');
  if (!requestOrigin) throw Object.assign(new Error('Invalid request origin'), { statusCode: 403 });

  let isAllowedOrigin = requestOrigin === config.appOrigin;
  if (!isAllowedOrigin) {
    try {
      const parsed = new URL(requestOrigin);
      const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
      const hostHeader = request.headers.host;
      const hostOrigin = hostHeader ? `${request.protocol}://${hostHeader}` : '';
      if (isLoopback || (hostOrigin && requestOrigin === hostOrigin)) {
        isAllowedOrigin = true;
      }
    } catch {}
  }

  if (!isAllowedOrigin) throw Object.assign(new Error('Invalid request origin'), { statusCode: 403 });

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
    setSessionCookies(reply, app, user, tokens.refreshToken, tokens.expiresAt, request);
    return { token: tokens.accessToken, user };
  });

  app.post<{ Body: { email: string; password: string } }>('/api/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { email, password } = request.body;
    if (!email || !password) return reply.status(400).send({ error: 'Missing email or password' });
    const user = await login(email, password);
    const tokens = await createSession(app, user);
    setSessionCookies(reply, app, user, tokens.refreshToken, tokens.expiresAt, request);
    return { token: tokens.accessToken, user };
  });

  app.post('/api/v1/auth/refresh', async (request, reply) => {
    try {
      assertBrowserRequest(request);
      const refreshToken = request.cookies[config.refreshCookieName];
      if (!refreshToken) return reply.status(401).send({ error: 'Missing refresh session' });
      const { tokens, identity } = await rotateSession(app, refreshToken);
      setSessionCookies(reply, app, identity, tokens.refreshToken, tokens.expiresAt, request);
      return { token: tokens.accessToken, user: identity };
    } catch (error) {
      clearSessionCookies(reply, request);
      throw error;
    }
  });

  app.post('/api/v1/auth/logout', { preHandler: authMiddleware }, async (request, reply) => {
    assertBrowserRequest(request);
    const sessionId = currentSessionId(request);
    if (sessionId) await revokeSession(sessionId, 'logout');
    clearSessionCookies(reply, request);
    return { success: true };
  });

  app.post('/api/v1/auth/logout-all', { preHandler: authMiddleware }, async (request, reply) => {
    assertBrowserRequest(request);
    await revokeUserSessions(request.user.id, 'logout_all');
    clearSessionCookies(reply, request);
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
    clearSessionCookies(reply, request);
    return { success: true };
  });

  app.get('/api/v1/profile', { preHandler: authMiddleware }, async (request, reply) => {
    const user = request.user!;
    const mediaCookie = request.cookies[config.mediaCookieName || 'zalo_crm_media_session'];
    if (!mediaCookie && user.orgId) {
      const mediaToken = app.jwt.sign(
        { id: user.id, email: (user as any).email || '', orgId: user.orgId, role: user.role, sessionId: 'media' } as never,
        { expiresIn: '7d' },
      );
      reply.setCookie(config.mediaCookieName || 'zalo_crm_media_session', mediaToken, mediaCookieOptions(request));
    }
    return getProfile(request.user.id);
  });
}
