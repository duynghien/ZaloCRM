/**
 * Main application entry point.
 * Bootstraps Fastify server with all plugins, Socket.IO, and route handlers.
 * The process never exits — all errors are caught and logged.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Prisma } from '@prisma/client';
import { config } from './config/index.js';
import { prisma } from './shared/database/prisma-client.js';
import { logger } from './shared/utils/logger.js';
import { authRoutes } from './modules/auth/auth-routes.js';
import { zaloRoutes } from './modules/zalo/zalo-routes.js';
import { chatRoutes } from './modules/chat/chat-routes.js';
import { contactRoutes } from './modules/contacts/contact-routes.js';
import { contactSubResourceRoutes } from './modules/contacts/contact-sub-resource-routes.js';
import { appointmentRoutes } from './modules/contacts/appointment-routes.js';
import { startAppointmentReminder, stopAppointmentReminder } from './modules/contacts/appointment-reminder.js';
import { dashboardRoutes } from './modules/dashboard/dashboard-routes.js';
import { reportRoutes } from './modules/dashboard/report-routes.js';
import { userRoutes } from './modules/auth/user-routes.js';
import { teamRoutes } from './modules/auth/team-routes.js';
import { orgRoutes } from './modules/auth/org-routes.js';
import { zaloAccessRoutes } from './modules/zalo/zalo-access-routes.js';
import { zaloSyncRoutes } from './modules/zalo/zalo-sync-routes.js';
import { zaloPool } from './modules/zalo/zalo-pool.js';
import { pruneSocketAccountRooms, registerZaloSocketHandlers } from './modules/zalo/zalo-socket.js';
import { notificationRoutes } from './modules/notifications/notification-routes.js';
import { searchRoutes } from './modules/search/search-routes.js';
import { startZaloHealthCheck, stopZaloHealthCheck } from './modules/zalo/zalo-health-check.js';
import { publicApiRoutes } from './modules/api/public-api-routes.js';
import { webhookSettingsRoutes } from './modules/api/webhook-settings-routes.js';
import { orderRoutes } from './modules/orders/order-routes.js';
import { aiReportRoutes } from './modules/ai-reports/ai-report-routes.js';
import { startReportCronJobs, stopReportCronJobs } from './modules/ai-reports/report-cron.js';
import { startReportJobWorker, stopReportJobWorker } from './modules/ai-reports/report-job-worker.js';
import { decryptData } from './shared/utils/crypto.js';
import { registerSessionRevocationListener, validateSessionUser, type JwtPayload } from './modules/auth/auth-service.js';
import { validateConfiguredGeminiModel } from './modules/ai-reports/ai-client.js';

declare module 'fastify' {
  interface FastifyInstance {
    io: Server;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let application: FastifyInstance | undefined;
let shutdownPromise: Promise<void> | undefined;

async function shutdown(exitCode: number, cause: string): Promise<void> {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    logger.error(`[lifecycle] Shutting down after ${cause}`);
    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();

    try {
      stopAppointmentReminder();
      stopReportCronJobs();
      await stopZaloHealthCheck();
      zaloPool.disconnectAll();
      await application?.close();
      await prisma.$disconnect();
    } catch (error) {
      logger.error('[lifecycle] Graceful shutdown failed:', error);
      exitCode = 1;
    } finally {
      clearTimeout(forceExit);
      process.exit(exitCode);
    }
  })();

  return shutdownPromise;
}

async function bootstrap() {
  const app = Fastify({ logger: false });
  application = app;

  // ── Plugins ──────────────────────────────────────────────────────────────

  await app.register(cors, {
    origin: config.isProduction ? config.appOrigin : true,
    credentials: true,
  });

  await app.register(fastifyCookie);

  await app.register(fastifyJwt, {
    secret: config.jwtSecret,
  });

  // Rate limiting with higher limits and per-key tracking
  await app.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
    // Use different limits for different clients
    keyGenerator: (request) => {
      // Use API key for authenticated requests
      const apiKey = request.headers['x-api-key'] as string;
      if (apiKey) {
        return `api:${apiKey}`;
      }
      // Use IP for other requests
      return request.ip;
    },
  });

  // Serve compiled frontend assets in production
  if (config.isProduction) {
    await app.register(fastifyStatic, {
      root: path.join(__dirname, '../static'),
      prefix: '/',
    });
  }

  // ── Socket.IO ─────────────────────────────────────────────────────────────

  const io = new Server(app.server, {
    cors: {
      origin: config.isProduction ? config.appOrigin : '*',
      credentials: true,
    },
  });

  // Attach io to app so route handlers can emit events
  app.decorate('io', io);
  registerSessionRevocationListener((sessionIds) => {
    const revokedSessions = new Set(sessionIds);
    for (const socket of io.sockets.sockets.values()) {
      if (revokedSessions.has(socket.data.sessionId as string)) socket.disconnect(true);
    }
  });

  // Pass io to zalo pool for real-time event emission
  zaloPool.setIO(io);

  // Authenticate socket connection via JWT token passed in auth or query
  io.use(async (socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.query?.token as string);
    if (!token) {
      return next(new Error('Authentication error: Token required'));
    }
    try {
      const claims = app.jwt.verify<JwtPayload>(token);
      if (!claims.sessionId) throw new Error('Legacy token rejected');
      const user = await validateSessionUser(claims.sessionId, claims.id);
      socket.data.user = { ...user, sessionId: claims.sessionId };
      socket.data.sessionId = claims.sessionId;
      socket.join(`org:${user.orgId}`);
      await pruneSocketAccountRooms(socket);
      next();
    } catch {
      next(new Error('Authentication error: Invalid, expired, or revoked token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id} (user: ${socket.data.user?.id}, org: ${socket.data.user?.orgId})`);

    // Recheck server-side session state for every incoming event. This removes
    // revoked, expired, and deactivated identities before Zalo handlers can
    // consume their packets, while refreshing role/org claims from the database.
    socket.use((_, next) => {
      const user = socket.data.user as JwtPayload | undefined;
      const sessionId = socket.data.sessionId as string | undefined;
      if (!user || !sessionId) {
        socket.disconnect(true);
        return next(new Error('Authentication error: Session required'));
      }

      void validateSessionUser(sessionId, user.id)
        .then(async (validatedUser) => {
          if (user.orgId !== validatedUser.orgId) {
            socket.leave(`org:${user.orgId}`);
            socket.join(`org:${validatedUser.orgId}`);
          }
          socket.data.user = { ...validatedUser, sessionId };
          await pruneSocketAccountRooms(socket);
          next();
        })
        .catch(() => {
          socket.disconnect(true);
          next(new Error('Authentication error: Session is no longer valid'));
        });
    });

    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${socket.id}`);
    });
  });

  // Event middleware protects commands, while this bounded sweep also removes
  // idle sockets from organization broadcast rooms after a session is revoked.
  const socketSessionSweep = setInterval(() => {
    for (const socket of io.sockets.sockets.values()) {
      const user = socket.data.user as JwtPayload | undefined;
      const sessionId = socket.data.sessionId as string | undefined;
      if (!user || !sessionId) {
        socket.disconnect(true);
        continue;
      }
      void validateSessionUser(sessionId, user.id)
        .then(async (validatedUser) => {
          if (user.orgId !== validatedUser.orgId) {
            socket.leave(`org:${user.orgId}`);
            socket.join(`org:${validatedUser.orgId}`);
          }
          socket.data.user = { ...validatedUser, sessionId };
          await pruneSocketAccountRooms(socket);
        })
        .catch(() => socket.disconnect(true));
    }
  }, 15_000);
  app.addHook('onClose', async () => {
    clearInterval(socketSessionSweep);
    stopReportJobWorker();
    await io.close();
  });

  // Register Zalo Socket.IO event handlers
  registerZaloSocketHandlers(io);

  // ── Routes ────────────────────────────────────────────────────────────────

  await app.register(authRoutes);
  await app.register(zaloRoutes);
  await app.register(chatRoutes);
  await app.register(contactRoutes);
  await app.register(contactSubResourceRoutes);
  await app.register(appointmentRoutes);
  await app.register(dashboardRoutes);
  await app.register(reportRoutes);
  await app.register(userRoutes);
  await app.register(teamRoutes);
  await app.register(orgRoutes);
  await app.register(zaloAccessRoutes);
  await app.register(zaloSyncRoutes);
  await app.register(notificationRoutes);
  await app.register(searchRoutes);
  await app.register(publicApiRoutes);
  await app.register(webhookSettingsRoutes);
  await app.register(orderRoutes);
  await app.register(aiReportRoutes);

  // Readiness probe: a failed mandatory database dependency must be visible to orchestrators.
  app.get('/health', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'connected', timestamp: new Date().toISOString() };
    } catch {
      return reply.status(503).send({ status: 'error', db: 'disconnected', timestamp: new Date().toISOString() });
    }
  });

  // API version banner
  app.get('/api/v1/status', async () => {
    return { version: '1.0.0', name: 'Zalo CRM' };
  });

  // SPA fallback — serve index.html for non-API routes in production
  if (config.isProduction) {
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'not_found' });
      }
      return reply.sendFile('index.html');
    });
  }

  // ── Error handler ─────────────────────────────────────────────────────────

  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    logger.error('Request error:', error.message);
    reply.status(error.statusCode ?? 500).send({
      error: error.message || 'Internal Server Error',
    });
  });

  // ── Start ─────────────────────────────────────────────────────────────────

  try {
    await validateConfiguredGeminiModel();
    await app.listen({ port: config.port, host: config.host });
    logger.info(`Zalo CRM running on http://${config.host}:${config.port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    startAppointmentReminder(io);
    startZaloHealthCheck();
    startReportCronJobs();
    startReportJobWorker();
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }

  // Reconnect Zalo accounts that have saved sessions (staggered to avoid rate limits)
  try {
    const accounts = await prisma.zaloAccount.findMany({
      where: { sessionData: { not: Prisma.JsonNull } },
      select: { id: true, sessionData: true },
    });
    logger.info(`Attempting reconnect for ${accounts.length} Zalo account(s)`);
    for (const account of accounts) {
      const session = decryptData<{
        cookie: any;
        imei: string;
        userAgent: string;
      }>(account.sessionData, config.encryptionKey);

      if (session?.imei) {
        // Stagger reconnects: 10 seconds between each account to avoid rate limits
        await new Promise((r) => setTimeout(r, 10_000));
        zaloPool.reconnect(account.id, session).catch((err) => {
          logger.warn(`Auto-reconnect failed for account ${account.id}:`, err);
        });
      }
    }
  } catch (err) {
    logger.error('Failed to load accounts for reconnect:', err);
  }
}

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  void shutdown(1, 'uncaught exception');
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
  void shutdown(1, 'unhandled rejection');
});
process.once('SIGTERM', () => { void shutdown(0, 'SIGTERM'); });
process.once('SIGINT', () => { void shutdown(0, 'SIGINT'); });

bootstrap();
