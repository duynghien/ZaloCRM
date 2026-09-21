import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma-client.js';

export const CRON_LOCKS = {
  APPOINTMENT_REMINDER: 84732612,
  CHAT_SLA_MONITOR: 84732613,
  ORPHAN_CLEANUP: 84732614,
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
