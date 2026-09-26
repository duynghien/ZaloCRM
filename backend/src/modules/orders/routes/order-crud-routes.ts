/**
 * order-crud-routes.ts — Fastify routes for Order CRUD and Contact Order listing.
 */
import type { FastifyInstance } from 'fastify';
import {
  listOrdersHandler,
  getOrderHandler,
  getContactOrdersHandler,
} from './order-read-handlers.js';
import { createOrderHandler } from './order-create-handler.js';
import { updateOrderHandler } from './order-update-handler.js';
import { deleteOrderHandler } from './order-delete-handler.js';

export async function orderCrudRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/orders', listOrdersHandler);
  app.get('/api/v1/orders/:id', getOrderHandler);
  app.post('/api/v1/orders', createOrderHandler);
  app.put('/api/v1/orders/:id', updateOrderHandler);
  app.delete('/api/v1/orders/:id', deleteOrderHandler);
  app.get('/api/v1/contacts/:id/orders', getContactOrdersHandler);
}
