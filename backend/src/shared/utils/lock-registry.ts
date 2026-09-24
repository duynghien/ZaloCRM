import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma-client.js';

export const CRON_LOCKS = {
  APPOINTMENT_REMINDER: 84732612,
  CHAT_SLA_MONITOR: 84732613,
  ORPHAN_CLEANUP: 84732614,
  ZALO_CONNECTION_CHECK: 84732615,
  ZALO_DAILY_SESSION_REFRESH: 84732616,
  // Backward compatibility alias
  ZALO_HEALTH_CHECK: 84732615,
} as const;

export async function withCronLock<T>(
  lockId: number,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<{ executed: true; result: T } | { executed: false; result?: undefined }> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${lockId}) as locked
      `;
      const locked = rows[0]?.locked ?? false;
      if (!locked) {
        return { executed: false };
      }
      const result = await fn(tx);
      return { executed: true, result };
    },
    {
      timeout: 120_000,
    },
  );
}

/**
 * Non-blocking durable lease for long-running cron jobs.
 * Acquires a lease in `cron_job_leases` table, runs `fn` outside of any active
 * database transaction to prevent pool exhaustion and transaction timeouts,
 * and releases the lease in `finally`.
 */
export async function withDurableCronLease<T>(
  lockId: number | bigint,
  jobName: string,
  durationMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<{ executed: true; result: T } | { executed: false; result?: undefined }> {
  const workerId = `${process.pid}-${randomUUID()}`;
  const lockIdBigInt = BigInt(lockId);

  const rows = await prisma.$queryRaw<Array<{ lock_id: bigint }>>`
    INSERT INTO "cron_job_leases" ("lock_id", "job_name", "lease_owner", "lease_expires_at", "updated_at")
    VALUES (${lockIdBigInt}, ${jobName}, ${workerId}, NOW() + (${durationMs} || ' milliseconds')::interval, NOW())
    ON CONFLICT ("lock_id") DO UPDATE SET
      "lease_owner" = EXCLUDED."lease_owner",
      "lease_expires_at" = EXCLUDED."lease_expires_at",
      "updated_at" = NOW()
    WHERE "cron_job_leases"."lease_expires_at" IS NULL OR "cron_job_leases"."lease_expires_at" < NOW()
    RETURNING "lock_id"
  `;

  if (!rows || rows.length === 0) {
    return { executed: false };
  }

  const abortController = new AbortController();
  const heartbeatIntervalMs = Math.max(1000, Math.floor(durationMs / 3));
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let renewing = false;

  heartbeatTimer = setInterval(async () => {
    if (renewing || abortController.signal.aborted) return;
    renewing = true;
    try {
      const renewal = await prisma.$executeRaw`
        UPDATE "cron_job_leases"
        SET "lease_expires_at" = NOW() + (${durationMs} || ' milliseconds')::interval, "updated_at" = NOW()
        WHERE "lock_id" = ${lockIdBigInt} AND "lease_owner" = ${workerId}
      `;
      if (renewal !== 1) {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        abortController.abort(new Error(`Lost cron lease for job ${jobName} (lock ${lockId})`));
      }
    } catch {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      abortController.abort(new Error(`Failed to renew cron lease for job ${jobName} (lock ${lockId})`));
    } finally {
      renewing = false;
    }
  }, heartbeatIntervalMs);

  if (typeof heartbeatTimer?.unref === 'function') {
    heartbeatTimer.unref();
  }

  try {
    const result = await fn(abortController.signal);
    return { executed: true, result };
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    try {
      await prisma.$executeRaw`
        UPDATE "cron_job_leases"
        SET "lease_owner" = NULL, "lease_expires_at" = NULL, "updated_at" = NOW()
        WHERE "lock_id" = ${lockIdBigInt} AND "lease_owner" = ${workerId}
      `;
    } catch {
      // Ignored: lease will expire naturally after durationMs
    }
  }
}
