/**
 * api-key-auth-middleware.ts — Multi-key authentication & shared rate limit guard.
 * Validates x-api-key against api_keys table, enforces status, expiration, and rate limits.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';

// In-memory bounded cache for debouncing lastUsedAt updates (max 1000 keys)
const lastUsedCache = new Map<string, number>();

export async function apiKeyAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKey = request.headers['x-api-key'] as string;
  if (!apiKey || typeof apiKey !== 'string') {
    return reply.status(401).send({ error: 'API key required' });
  }

  const incomingHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const keyRecord = await prisma.apiKey.findUnique({
    where: { keyHash: incomingHash },
  });

  if (!keyRecord) {
    return reply.status(401).send({ error: 'Invalid API key' });
  }

  if (!keyRecord.isActive) {
    return reply.status(403).send({ error: 'API key has been disabled' });
  }

  const now = Date.now();
  if (keyRecord.expiresAt && keyRecord.expiresAt.getTime() < now) {
    return reply.status(403).send({ error: 'API key has expired' });
  }

  // Enforce PostgreSQL-backed shared rate limit bucket across all backend instances
  const windowStart = new Date(Math.floor(now / 60_000) * 60_000);
  const windowEnd = new Date(windowStart.getTime() + 60_000);
  const retryAfterSeconds = Math.max(1, Math.ceil((windowEnd.getTime() - now) / 1000));

  const buckets = await prisma.$queryRaw<Array<{ request_count: number }>>`
    INSERT INTO "api_key_rate_limit_buckets" ("key_id", "window_start", "request_count")
    VALUES (${keyRecord.id}, ${windowStart}, 1)
    ON CONFLICT ("key_id", "window_start")
    DO UPDATE SET "request_count" = "api_key_rate_limit_buckets"."request_count" + 1
    RETURNING "request_count"
  `;

  const requestCount = buckets[0]?.request_count ?? 1;
  if (requestCount > keyRecord.rateLimit) {
    reply.header('Retry-After', retryAfterSeconds);
    return reply.status(429).send({
      error: 'Too Many Requests',
      message: `Rate limit of ${keyRecord.rateLimit} req/min exceeded`,
      retryAfter: retryAfterSeconds,
    });
  }

  // Periodic cleanup of expired rate limit buckets (5% sample probability)
  if (Math.random() < 0.05) {
    const staleThreshold = new Date(now - 5 * 60 * 1000);
    prisma.apiKeyRateLimitBucket.deleteMany({
      where: { windowStart: { lt: staleThreshold } },
    }).catch(() => {});
  }

  // Debounce lastUsedAt update (max once per 5 minutes per key)
  const lastUsedTs = lastUsedCache.get(keyRecord.id);
  if (!lastUsedTs || now - lastUsedTs > 5 * 60 * 1000) {
    if (lastUsedCache.size >= 1000) {
      const firstKey = lastUsedCache.keys().next().value;
      if (firstKey) lastUsedCache.delete(firstKey);
    }
    lastUsedCache.set(keyRecord.id, now);
    prisma.apiKey.update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date(now) },
    }).catch((err) => {
      logger.warn(`[api-key-auth] Failed to update lastUsedAt for key ${keyRecord.id}:`, err);
    });
  }

  // Attach authenticated context to request
  (request as any).orgId = keyRecord.orgId;
  (request as any).apiKeyId = keyRecord.id;
  (request as any).apiKeyScopes = Array.isArray(keyRecord.scopes)
    ? keyRecord.scopes
    : (typeof keyRecord.scopes === 'string' ? JSON.parse(keyRecord.scopes) : []);
  (request as any).apiKeyRateLimit = keyRecord.rateLimit;
}
