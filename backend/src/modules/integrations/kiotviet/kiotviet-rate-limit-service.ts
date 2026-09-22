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

  // 1. Check dedicated vendor cooldown table first (decoupled from minute buckets)
  const cooldown = await prisma.kiotvietVendorCooldown.findUnique({
    where: {
      orgId_retailer: { orgId, retailer },
    },
  });

  if (cooldown && cooldown.blockedUntil > now) {
    const waitSeconds = Math.max(1, Math.ceil((cooldown.blockedUntil.getTime() - now.getTime()) / 1000));
    throw new KiotvietRateLimitError(
      `KiotViet API rate limit active. Blocked until ${cooldown.blockedUntil.toISOString()}`,
      waitSeconds
    );
  }

  // 2. Truncate to current minute window start for quota bucket
  const windowStart = new Date(now);
  windowStart.setSeconds(0, 0);

  const limit = isPriorityWrite ? MAX_REQUESTS_PER_MINUTE + 20 : MAX_REQUESTS_PER_MINUTE;

  const rows = await prisma.$queryRaw<any[]>`
    INSERT INTO "kiotviet_rate_limit_buckets" ("id", "org_id", "retailer", "window_start", "request_count", "updated_at")
    VALUES (gen_random_uuid(), ${orgId}, ${retailer}, ${windowStart}, 1, NOW())
    ON CONFLICT ("org_id", "retailer", "window_start")
    DO UPDATE SET "request_count" = "kiotviet_rate_limit_buckets"."request_count" + 1, "updated_at" = NOW()
    WHERE "kiotviet_rate_limit_buckets"."request_count" < ${limit}
    RETURNING *
  `;

  if (!rows || rows.length === 0) {
    // Re-check cooldown in case of concurrent 429
    const latestCooldown = await prisma.kiotvietVendorCooldown.findUnique({
      where: { orgId_retailer: { orgId, retailer } },
    });
    if (latestCooldown && latestCooldown.blockedUntil > now) {
      const waitSeconds = Math.max(1, Math.ceil((latestCooldown.blockedUntil.getTime() - now.getTime()) / 1000));
      throw new KiotvietRateLimitError(
        `KiotViet API rate limit active. Blocked until ${latestCooldown.blockedUntil.toISOString()}`,
        waitSeconds
      );
    }

    const nextWindowStart = new Date(windowStart.getTime() + 60_000);
    const waitSeconds = Math.max(1, Math.ceil((nextWindowStart.getTime() - now.getTime()) / 1000));
    throw new KiotvietRateLimitError(
      'KiotViet request quota exceeded for the current time window',
      waitSeconds
    );
  }
}

/**
 * Sets blockedUntil timestamp across the organization's retailer when a 429 response is received.
 * Decoupled from minute buckets and uses GREATEST to preserve longer blocks.
 */
export async function recordVendorRateLimit429(
  orgId: string,
  retailer: string,
  retryAfterSeconds = 30
): Promise<void> {
  const safeSeconds = Math.min(Math.max(retryAfterSeconds, 1), 300);
  logger.warn(`[kiotviet-rate-limit] Vendor 429 received for ${orgId}/${retailer}. Cooldown ${safeSeconds}s requested.`);

  await prisma.$executeRaw`
    INSERT INTO "kiotviet_vendor_cooldown" ("org_id", "retailer", "blocked_until", "created_at", "updated_at")
    VALUES (${orgId}, ${retailer}, NOW() + (${safeSeconds} * INTERVAL '1 second'), NOW(), NOW())
    ON CONFLICT ("org_id", "retailer")
    DO UPDATE SET
      "blocked_until" = GREATEST("kiotviet_vendor_cooldown"."blocked_until", EXCLUDED."blocked_until"),
      "updated_at" = NOW()
  `;
}
