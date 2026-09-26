/**
 * public-api-routes.ts — External REST API aggregator.
 * Authenticated via API key (X-Api-Key header) with scope-based authorization.
 * All routes prefixed /api/public/ — no JWT required, orgId injected from API key lookup.
 */
import type { FastifyInstance } from 'fastify';
import { apiKeyAuth } from './middleware/api-key-auth-middleware.js';
import { validatePublicRequest } from './public-api-schemas.js';
import { publicContactsRoutes } from './routes/public-contacts-routes.js';
import { publicConversationsRoutes } from './routes/public-conversations-routes.js';
import { publicMessagesRoutes } from './routes/public-messages-routes.js';
import { publicAppointmentsRoutes } from './routes/public-appointments-routes.js';
import { publicOrdersRoutes } from './routes/public-orders-routes.js';
import { publicZaloAccountsRoutes } from './routes/public-zalo-accounts-routes.js';

export async function publicApiRoutes(app: FastifyInstance): Promise<void> {
  // Pre-handler hooks for all /api/public/* routes
  app.addHook('preHandler', apiKeyAuth);
  app.addHook('preHandler', validatePublicRequest);

  // Modularized sub-resources
  await app.register(publicContactsRoutes);
  await app.register(publicConversationsRoutes);
  await app.register(publicMessagesRoutes);
  await app.register(publicAppointmentsRoutes);
  await app.register(publicOrdersRoutes);
  await app.register(publicZaloAccountsRoutes);
}
