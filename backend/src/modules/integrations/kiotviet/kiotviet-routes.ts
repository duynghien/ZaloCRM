/**
 * KiotViet Integration Routes
 *
 * Provides endpoints for settings management, draft connection testing,
 * catalog synchronization, and product/customer lookup.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { logger } from '../../../shared/utils/logger.js';
import {
  getKiotvietConfig,
  getKiotvietPublicConfig,
  saveKiotvietConfig,
  KiotvietConflictError,
} from './kiotviet-settings-service.js';
import {
  getKiotvietBranches,
  getDraftKiotvietBranches,
  getKiotvietSellers,
  getKiotvietPaymentAccounts,
  searchKiotvietCustomersByPhone,
  createKiotvietCustomer,
} from './kiotviet-client.js';
import { searchLocalProducts } from './kiotviet-product-service.js';
import { enqueueCatalogSync } from './kiotviet-catalog-worker.js';
import { RequestValidationError } from '../../../shared/http/request-schemas.js';
import type { KiotvietCatalogStatusDto } from './kiotviet-types.js';

function applyNoStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
}

export async function kiotvietRoutes(app: FastifyInstance): Promise<void> {
  // Global auth check for all /api/v1/kiotviet routes
  app.addHook('preHandler', authMiddleware);

  // Helper guard for owner/admin only routes
  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user || !['owner', 'admin'].includes(request.user.role)) {
      reply.status(403).send({ error: 'Forbidden: Admin access required' });
    }
  };

  // ── GET /api/v1/kiotviet/config ──────────────────────────────────────────
  app.get('/api/v1/kiotviet/config', { preHandler: requireAdmin }, async (request: FastifyRequest, reply: FastifyReply) => {
    applyNoStore(reply);
    const orgId = request.user!.orgId;
    const config = await getKiotvietPublicConfig(orgId);
    return config;
  });

  // ── POST /api/v1/kiotviet/config ─────────────────────────────────────────
  app.post('/api/v1/kiotviet/config', { preHandler: requireAdmin }, async (request: FastifyRequest, reply: FastifyReply) => {
    applyNoStore(reply);
    const orgId = request.user!.orgId;
    const body = (request.body || {}) as Record<string, any>;

    try {
      const updated = await saveKiotvietConfig(orgId, body, body.expectedRevision);
      return updated;
    } catch (err: any) {
      if (err instanceof KiotvietConflictError) {
        return reply.status(409).send({ error: err.message, code: err.code });
      }
      if (err instanceof RequestValidationError) {
        return reply.status(400).send({ error: err.message });
      }
      logger.error('[kiotviet-routes] Failed to save config:', err);
      return reply.status(500).send({ error: 'Failed to save KiotViet configuration' });
    }
  });

  // ── POST /api/v1/kiotviet/test-connection ─────────────────────────────────
  app.post('/api/v1/kiotviet/test-connection', { preHandler: requireAdmin }, async (request: FastifyRequest, reply: FastifyReply) => {
    applyNoStore(reply);
    const orgId = request.user!.orgId;
    const body = (request.body || {}) as Record<string, any>;

    const clientId = String(body.clientId || '').trim();
    let clientSecret = String(body.clientSecret || '').trim();
    const retailer = String(body.retailer || '').trim();

    if (!clientId || !retailer) {
      return reply.status(400).send({ error: 'clientId and retailer are required for connection test' });
    }

    // If clientSecret is omitted, reuse saved secret only if clientId and retailer match saved config
    if (!clientSecret) {
      const saved = await getKiotvietConfig(orgId);
      if (saved && saved.clientId === clientId && saved.retailer === retailer && saved.clientSecret) {
        clientSecret = saved.clientSecret;
      } else {
        return reply.status(400).send({ error: 'clientSecret is required when testing new credentials' });
      }
    }

    try {
      const branches = await getDraftKiotvietBranches(clientId, clientSecret, retailer);
      const safeBranches = branches.map(b => ({ id: String(b.id), branchName: b.branchName }));

      return {
        ok: true,
        branches: safeBranches,
      };
    } catch (err: any) {
      logger.warn('[kiotviet-routes] Test connection failed:', err);
      return reply.status(400).send({
        ok: false,
        error: err?.message ? String(err.message).slice(0, 300) : 'Failed to connect to KiotViet',
      });
    }
  });

  // ── GET /api/v1/kiotviet/branches ────────────────────────────────────────
  app.get('/api/v1/kiotviet/branches', { preHandler: requireAdmin }, async (request: FastifyRequest, reply: FastifyReply) => {
    applyNoStore(reply);
    const orgId = request.user!.orgId;
    const config = await getKiotvietConfig(orgId);
    if (!config || !config.retailer || !config.clientId || !config.clientSecret) {
      return { branches: [] };
    }

    try {
      const branches = await getKiotvietBranches(orgId, config);
      return { branches: branches.map(b => ({ id: String(b.id), branchName: b.branchName })) };
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Failed to fetch branches' });
    }
  });

  // ── GET /api/v1/kiotviet/sellers ─────────────────────────────────────────
  app.get('/api/v1/kiotviet/sellers', { preHandler: requireAdmin }, async (request: FastifyRequest, reply: FastifyReply) => {
    applyNoStore(reply);
    const orgId = request.user!.orgId;
    const config = await getKiotvietConfig(orgId);
    if (!config || !config.retailer) {
      return { sellers: [] };
    }

    const sellers = await getKiotvietSellers(orgId, config);
    return {
      sellers: sellers.map(s => ({
        id: String(s.id),
        name: s.givenName ? `${s.givenName} (${s.userName})` : s.userName,
      })),
    };
  });

  // ── GET /api/v1/kiotviet/payment-accounts ─────────────────────────────────
  app.get('/api/v1/kiotviet/payment-accounts', { preHandler: requireAdmin }, async (request: FastifyRequest, reply: FastifyReply) => {
    applyNoStore(reply);
    const orgId = request.user!.orgId;
    const config = await getKiotvietConfig(orgId);
    if (!config || !config.retailer) {
      return { paymentAccounts: [] };
    }

    const paymentAccounts = await getKiotvietPaymentAccounts(orgId, config);
    return {
      paymentAccounts: paymentAccounts.map(p => ({
        id: String(p.id),
        name: p.accountName || p.bankName || `Account #${p.id}`,
      })),
    };
  });

  // ── POST /api/v1/kiotviet/sync-products ──────────────────────────────────
  app.post('/api/v1/kiotviet/sync-products', { preHandler: requireAdmin }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = request.user!.orgId;
    const body = (request.body || {}) as Record<string, any>;
    const mode = body.mode === 'incremental' ? 'incremental' : 'full';

    try {
      const result = await enqueueCatalogSync(orgId, mode);
      return reply.status(202).send(result);
    } catch (err: any) {
      if (err instanceof KiotvietConflictError) {
        return reply.status(409).send({ error: err.message, code: err.code });
      }
      logger.error('[kiotviet-routes] Failed to enqueue catalog sync:', err);
      return reply.status(500).send({ error: 'Failed to enqueue catalog sync' });
    }
  });

  // ── GET /api/v1/kiotviet/catalog-status ──────────────────────────────────
  app.get('/api/v1/kiotviet/catalog-status', { preHandler: requireAdmin }, async (request: FastifyRequest, reply: FastifyReply) => {
    applyNoStore(reply);
    const orgId = request.user!.orgId;
    const state = await prisma.kiotvietSyncState.findUnique({
      where: { orgId },
    });

    const statusDto: KiotvietCatalogStatusDto = {
      runId: state?.runId ?? null,
      status: (state?.status as any) ?? 'idle',
      totalProducts: state?.totalProducts ?? 0,
      processed: state?.processedCount ?? 0,
      lastSuccessfulAt: state?.lastSuccessfulAt ? state.lastSuccessfulAt.toISOString() : null,
      error: state?.error ?? null,
    };

    return statusDto;
  });

  // ── GET /api/v1/kiotviet/products (available to all authenticated users) ─
  app.get('/api/v1/kiotviet/products', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = request.user!.orgId;
    const query = (request.query || {}) as Record<string, any>;

    const q = typeof query.q === 'string' ? query.q : '';
    if (q.length > 100) {
      return reply.status(400).send({ error: 'Search query must not exceed 100 characters' });
    }

    let limit = 20;
    if (query.limit !== undefined) {
      limit = parseInt(String(query.limit), 10);
      if (isNaN(limit) || limit < 1 || limit > 50) {
        return reply.status(400).send({ error: 'Limit must be an integer between 1 and 50' });
      }
    }

    const products = await searchLocalProducts(orgId, q, limit);
    return { products };
  });

  // ── GET /api/v1/kiotviet/customers/search ─────────────────────────────────
  app.get('/api/v1/kiotviet/customers/search', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = request.user!.orgId;
    const query = (request.query || {}) as Record<string, any>;

    const rawPhone = typeof query.phone === 'string' ? query.phone.trim() : '';
    // Normalize phone (strip non-digits, accept starting +84 or 0)
    const normalizedPhone = rawPhone.replace(/\D/g, '');

    if (!normalizedPhone || normalizedPhone.length < 3) {
      return { customers: [] };
    }

    const config = await getKiotvietConfig(orgId);
    if (!config || !config.retailer || !config.clientId || !config.clientSecret) {
      return { customers: [] };
    }

    try {
      const customers = await searchKiotvietCustomersByPhone(orgId, config, normalizedPhone);
      return { customers };
    } catch (err: any) {
      logger.warn('[kiotviet-routes] Customer search error:', err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Customer search failed' });
    }
  });

  // ── POST /api/v1/kiotviet/customers ──────────────────────────────────────
  app.post('/api/v1/kiotviet/customers', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = request.user!.orgId;
    const body = (request.body || {}) as Record<string, any>;

    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim().replace(/\D/g, '');
    const address = body.address ? String(body.address).trim() : undefined;

    if (!name || !phone) {
      return reply.status(400).send({ error: 'name and phone are required to create a KiotViet customer' });
    }

    const config = await getKiotvietConfig(orgId);
    if (!config || !config.retailer || !config.clientId || !config.clientSecret) {
      return reply.status(400).send({ error: 'KiotViet integration is not configured' });
    }

    try {
      const customer = await createKiotvietCustomer(orgId, config, { name, phone, address });
      return { customer };
    } catch (err: any) {
      logger.warn('[kiotviet-routes] Create customer error:', err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Failed to create customer on KiotViet' });
    }
  });
}
