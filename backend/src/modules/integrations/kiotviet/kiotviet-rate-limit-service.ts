/**
 * KiotViet Rate Limit & Concurrency Service
 *
 * Implements tenant-scoped minute buckets for API rate limiting and quota management.
 * Priority: Invoice POSTs are given absolute priority; catalog sync yields when constrained.
 */

import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';

// 4,500 GET/hour budget -> 75 requests per 1-minute window
export const MAX_REQUESTS_PER_MINUTE = 75;

export class KiotvietRateLimitError extends Error {
  readonly statusCode = 429;
  readonly code = 'kiotviet_rate_limited';
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds = 10) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
    Object.setPrototypeOf(this, KiotvietRateLimitError.prototype);
  }
}

/**
 * Checks and reserves a request slot for an organization's retailer in the current minute window.
 * Priority writes (invoice POSTs) are permitted even if close to bucket capacity.
 */
export async function checkAndReserveRateLimit(
  orgId: string,
  retailer: string,
  isPriorityWrite = false
): Promise<void> {
  const now = new Date();
  // Truncate to current minute window start
  const windowStart = new Date(now);
  windowStart.setSeconds(0, 0);

  const bucket = await prisma.kiotvietRateLimitBucket.findUnique({
    where: {
      orgId_retailer_windowStart: {
        orgId,
        retailer,
        windowStart,
      },
    },
  });

  if (bucket?.blockedUntil && bucket.blockedUntil > now) {
    const waitSeconds = Math.ceil((bucket.blockedUntil.getTime() - now.getTime()) / 1000);
    throw new KiotvietRateLimitError(
      `KiotViet API rate limit active. Blocked until ${bucket.blockedUntil.toISOString()}`,
      waitSeconds
    );
  }

  // If normal background request (like catalog sync) and request count is high, throttle
  const limit = isPriorityWrite ? MAX_REQUESTS_PER_MINUTE + 20 : MAX_REQUESTS_PER_MINUTE;

  if (bucket && bucket.requestCount >= limit) {
    const nextWindowStart = new Date(windowStart.getTime() + 60_000);
    const waitSeconds = Math.max(1, Math.ceil((nextWindowStart.getTime() - now.getTime()) / 1000));
    throw new KiotvietRateLimitError(
      'KiotViet request quota exceeded for the current time window',
      waitSeconds
    );
  }

  await prisma.kiotvietRateLimitBucket.upsert({
    where: {
      orgId_retailer_windowStart: {
        orgId,
        retailer,
        windowStart,
      },
    },
    create: {
      orgId,
      retailer,
      windowStart,
      requestCount: 1,
    },
    update: {
      requestCount: { increment: 1 },
    },
  });
}

/**
 * Sets blockedUntil timestamp across the organization's retailer when a 429 response is received.
 */
export async function recordVendorRateLimit429(
  orgId: string,
  retailer: string,
  retryAfterSeconds = 30
): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setSeconds(0, 0);
  const blockedUntil = new Date(now.getTime() + Math.min(retryAfterSeconds, 300) * 1000);

  logger.warn(`[kiotviet-rate-limit] Vendor 429 received for ${orgId}/${retailer}. Blocking until ${blockedUntil.toISOString()}`);

  await prisma.kiotvietRateLimitBucket.upsert({
    where: {
      orgId_retailer_windowStart: {
        orgId,
        retailer,
        windowStart,
      },
    },
    create: {
      orgId,
      retailer,
      windowStart,
      requestCount: MAX_REQUESTS_PER_MINUTE,
      blockedUntil,
    },
    update: {
      blockedUntil,
    },
  });
}
