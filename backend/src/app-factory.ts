import { schemaIsCompatible } from './shared/database/schema-compatibility.js';
/** Construct the production HTTP/socket app without starting background services. */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config/index.js';
import { prisma } from './shared/database/prisma-client.js';
import { logger } from './shared/utils/logger.js';
import { authRoutes } from './modules/auth/auth-routes.js';
import { zaloRoutes } from './modules/zalo/zalo-routes.js';
import { chatRoutes } from './modules/chat/chat-routes.js';
import { attachmentRoutes } from './modules/attachments/attachment-routes.js';
import { contactRoutes } from './modules/contacts/contact-routes.js';
import { contactSubResourceRoutes } from './modules/contacts/contact-sub-resource-routes.js';
import { appointmentRoutes } from './modules/contacts/appointment-routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard-routes.js';
import { reportRoutes } from './modules/dashboard/report-routes.js';
import { userRoutes } from './modules/auth/user-routes.js';
import { teamRoutes } from './modules/auth/team-routes.js';
import { orgRoutes } from './modules/auth/org-routes.js';
import { zaloAccessRoutes } from './modules/zalo/zalo-access-routes.js';
import { zaloSyncRoutes } from './modules/zalo/zalo-sync-routes.js';
import { notificationRoutes } from './modules/notifications/notification-routes.js';
import { searchRoutes } from './modules/search/search-routes.js';
import { publicApiRoutes } from './modules/api/public-api-routes.js';
import { webhookSettingsRoutes } from './modules/api/webhook-settings-routes.js';
import { apiKeyManagementRoutes } from './modules/api/routes/api-key-management-routes.js';
import { webhookSubscriptionRoutes } from './modules/api/routes/webhook-subscription-routes.js';
import { webhookLogRoutes } from './modules/api/routes/webhook-log-routes.js';
import { orderRoutes } from './modules/orders/order-routes.js';
import { aiReportRoutes } from './modules/ai-reports/ai-report-routes.js';
import { chatCopilotRoutes } from './modules/chat/copilot/chat-copilot-routes.js';
import { quickReplyRoutes } from './modules/chat/quick-replies/quick-reply-routes.js';
import { conversationTagRoutes } from './modules/chat/tags/conversation-tag-routes.js';
import { chatTurnDebouncer } from './modules/chat/copilot/chat-turn-debouncer.js';
import { kiotvietRoutes } from './modules/integrations/kiotviet/kiotviet-routes.js';

import { initializeSocketServer } from './shared/realtime/socket-server.js';
import { messageDeliveryService } from './modules/zalo/message-delivery-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApp(options: { https?: { key: Buffer; cert: Buffer }; staticRoot?: string } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    trustProxy: config.trustedProxyHops > 0 ? (_addr: string, hop: number) => hop < config.trustedProxyHops : false,
    routerOptions: {
      maxParamLength: 1000,
    },
    ...(options.https ? { https: options.https } : {}),
  });
  // ── Plugins ──────────────────────────────────────────────────────────────

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      try {
        const parsed = new URL(origin);
        const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
        const isAppOrigin = origin === config.appOrigin;
        if (isAppOrigin || isLoopback) {
          return cb(null, true);
        }
        return cb(null, false);
      } catch {
        return cb(null, false);
      }
    },
    credentials: true,
  });

  await app.register(fastifyCookie);

  await app.register(fastifyJwt, {
    secret: config.jwtSecret,
  });

  await app.register(multipart, {
    limits: {
      fileSize: 30 * 1024 * 1024,
      files: 5,
    },
  });

  // Rate limiting with trusted IP key generation
  await app.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      return request.ip;
    },
  });

  // Serve compiled frontend assets in production
  if (config.isProduction) {
    await app.register(fastifyStatic, {
      root: options.staticRoot ?? path.join(__dirname, '../static'),
      prefix: '/',
    });
  }

  initializeSocketServer(app);
  chatTurnDebouncer.init(app.io);
  messageDeliveryService.setIO(app.io);

  // ── Routes ────────────────────────────────────────────────────────────────

  await app.register(authRoutes);
  await app.register(zaloRoutes);
  await app.register(chatRoutes);
  await app.register(attachmentRoutes);
  await app.register(chatCopilotRoutes);
  await app.register(quickReplyRoutes);
  await app.register(conversationTagRoutes);
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
  await app.register(apiKeyManagementRoutes);
  await app.register(webhookSubscriptionRoutes);
  await app.register(webhookLogRoutes);
  await app.register(orderRoutes);
  await app.register(aiReportRoutes);
  await app.register(kiotvietRoutes);

  // Readiness probe: a failed mandatory database dependency must be visible to orchestrators.
  app.get('/health', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      if (!await schemaIsCompatible()) return reply.status(503).send({ status: 'error', db: 'connected', schema: 'incompatible', timestamp: new Date().toISOString() });
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

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const status = error.statusCode ?? 500;
    logger.error(`[http] Request error on ${request.method} ${request.url}: ${error.stack || error.message}`);
    if (status >= 500 && config.isProduction) {
      return reply.status(status).send({
        error: 'Internal Server Error',
        requestId: request.id,
      });
    }
    return reply.status(status).send({
      error: error.message || (status >= 500 ? 'Internal Server Error' : 'Bad Request'),
      ...(config.isProduction ? {} : { stack: error.stack }),
    });
  });

  return app;
}
