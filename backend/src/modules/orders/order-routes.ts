/**
 * order-routes.ts — Root aggregator Fastify plugin for Order management routes.
 * Registers CRUD, statistics, and KiotViet integration sub-routes with auth preHandler hook.
 */
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { identifierInput } from '../../shared/http/request-schemas.js';
import { orderCrudRoutes } from './routes/order-crud-routes.js';
import { orderStatsRoutes } from './routes/order-stats-routes.js';
import { orderKiotvietRoutes } from './routes/order-kiotviet-routes.js';

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.addHook('preHandler', async (request) => {
    const params = request.params as Record<string, unknown>;
    if (params?.id !== undefined) identifierInput(params.id);
  });

  await app.register(orderCrudRoutes);
  await app.register(orderStatsRoutes);
  await app.register(orderKiotvietRoutes);
}

export * from './routes/order-route-helpers.js';
