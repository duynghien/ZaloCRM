import { randomUUID } from 'node:crypto';
import { prisma as defaultPrisma } from '../src/shared/database/prisma-client.js';

export interface ResetCronLeasesOptions {
  actor: string;
  reason: string;
  lockId?: string | number | bigint;
  all?: boolean;
  confirmAll?: boolean;
}

export interface ResetLeaseResult {
  resetCount: number;
  leases: Array<{
    lockId: string;
    jobName: string;
    priorOwner: string | null;
    priorExpiresAt: Date | null;
  }>;
}

export async function resetCronLeases(
  options: ResetCronLeasesOptions,
  clientPrisma: any = defaultPrisma
): Promise<ResetLeaseResult> {
  const actor = options.actor?.trim();
  const reason = options.reason?.trim();

  if (!actor || !actor.includes('@')) {
    throw new Error('Valid operator email (--actor) is required');
  }
  if (!reason || reason.length < 5) {
    throw new Error('A detailed reason (--reason) of at least 5 characters is required');
  }

  const hasLockId = options.lockId !== undefined && options.lockId !== null && String(options.lockId).trim() !== '';
  const isAll = Boolean(options.all);
  const isConfirmAll = Boolean(options.confirmAll);

  if (!hasLockId && !isAll) {
    throw new Error('Either --lock-id <id> or (--all and --confirm-all) must be specified');
  }
  if (isAll && !isConfirmAll) {
    throw new Error('--confirm-all is mandatory when using --all to prevent accidental system-wide lease reset');
  }

  return await clientPrisma.$transaction(async (tx: any) => {
    let rowsToReset: Array<{
      lock_id: bigint;
      job_name: string;
      lease_owner: string | null;
      lease_expires_at: Date | null;
    }> = [];

    if (hasLockId) {
      const lockIdBigInt = BigInt(options.lockId!);
      let rawResult: any[] | null = null;
      if (typeof tx.$queryRaw === 'function') {
        try {
          rawResult = await tx.$queryRaw<any[]>`
            SELECT "lock_id", "job_name", "lease_owner", "lease_expires_at"
            FROM "cron_job_leases"
            WHERE "lock_id" = ${lockIdBigInt}
            FOR UPDATE;
          `;
        } catch {}
      }
      if (Array.isArray(rawResult)) {
        rowsToReset = rawResult;
      } else {
        const found = await tx.cronJobLease?.findUnique({
          where: { lockId: lockIdBigInt },
        });
        if (found) {
          rowsToReset = [{
            lock_id: found.lockId,
            job_name: found.jobName,
            lease_owner: found.leaseOwner,
            lease_expires_at: found.leaseExpiresAt,
          }];
        }
      }
    } else {
      let rawResult: any[] | null = null;
      if (typeof tx.$queryRaw === 'function') {
        try {
          rawResult = await tx.$queryRaw<any[]>`
            SELECT "lock_id", "job_name", "lease_owner", "lease_expires_at"
            FROM "cron_job_leases"
            FOR UPDATE;
          `;
        } catch {}
      }
      if (Array.isArray(rawResult)) {
        rowsToReset = rawResult;
      } else {
        const found = await tx.cronJobLease?.findMany();
        rowsToReset = (found || []).map((f: any) => ({
          lock_id: f.lockId,
          job_name: f.jobName,
          lease_owner: f.leaseOwner,
          lease_expires_at: f.leaseExpiresAt,
        }));
      }
    }

    if (rowsToReset.length === 0) {
      return { resetCount: 0, leases: [] };
    }

    const resetAuditRecords = rowsToReset.map((row) => ({
      id: randomUUID(),
      lockId: row.lock_id,
      jobName: row.job_name,
      priorOwner: row.lease_owner,
      priorExpiresAt: row.lease_expires_at,
      actor,
      reason,
      createdAt: new Date(),
    }));

    // Record audit logs
    if (tx.cronJobLeaseReset?.createMany) {
      await tx.cronJobLeaseReset.createMany({
        data: resetAuditRecords,
      });
    } else if (typeof tx.$executeRaw === 'function') {
      for (const rec of resetAuditRecords) {
        await tx.$executeRaw`
          INSERT INTO "cron_job_lease_resets" (
            "id", "lock_id", "job_name", "prior_owner", "prior_expires_at", "actor", "reason", "created_at"
          ) VALUES (
            ${rec.id}, ${rec.lockId}, ${rec.jobName}, ${rec.priorOwner}, ${rec.priorExpiresAt}, ${rec.actor}, ${rec.reason}, ${rec.createdAt}
          );
        `;
      }
    }

    // Release leases
    if (hasLockId) {
      const lockIdBigInt = BigInt(options.lockId!);
      if (tx.cronJobLease?.update) {
        await tx.cronJobLease.update({
          where: { lockId: lockIdBigInt },
          data: { leaseOwner: null, leaseExpiresAt: null },
        });
      } else if (typeof tx.$executeRaw === 'function') {
        await tx.$executeRaw`
          UPDATE "cron_job_leases"
          SET "lease_owner" = NULL, "lease_expires_at" = NULL, "updated_at" = NOW()
          WHERE "lock_id" = ${lockIdBigInt};
        `;
      }
    } else {
      if (tx.cronJobLease?.updateMany) {
        await tx.cronJobLease.updateMany({
          data: { leaseOwner: null, leaseExpiresAt: null },
        });
      } else if (typeof tx.$executeRaw === 'function') {
        await tx.$executeRaw`
          UPDATE "cron_job_leases"
          SET "lease_owner" = NULL, "lease_expires_at" = NULL, "updated_at" = NOW();
        `;
      }
    }

    return {
      resetCount: rowsToReset.length,
      leases: rowsToReset.map((r) => ({
        lockId: String(r.lock_id),
        jobName: r.job_name,
        priorOwner: r.lease_owner,
        priorExpiresAt: r.lease_expires_at,
      })),
    };
  });
}

// CLI runner
if (process.argv[1]?.endsWith('reset-cron-leases.ts') || process.argv[1]?.endsWith('reset-cron-leases.js')) {
  const args = process.argv.slice(2);
  const parsedArgs: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        parsedArgs[key] = args[i + 1];
        i++;
      } else {
        parsedArgs[key] = true;
      }
    }
  }

  const actor = parsedArgs.actor as string;
  const reason = parsedArgs.reason as string;
  const lockId = parsedArgs['lock-id'] as string;
  const all = Boolean(parsedArgs.all);
  const confirmAll = Boolean(parsedArgs['confirm-all']);

  if (!actor || !reason || (!lockId && (!all || !confirmAll))) {
    console.error('Usage:');
    console.error('  npm run operator:reset-cron-leases -- --actor <email> --reason <reason> --lock-id <id>');
    console.error('  npm run operator:reset-cron-leases -- --actor <email> --reason <reason> --all --confirm-all');
    process.exit(1);
  }

  resetCronLeases({ actor, reason, lockId, all, confirmAll })
    .then((res) => {
      console.log(`[OPERATOR] Successfully reset ${res.resetCount} cron lease(s):`);
      for (const l of res.leases) {
        console.log(` - Lock ${l.lockId} (${l.jobName}): priorOwner=${l.priorOwner ?? 'none'}`);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[OPERATOR ERROR]', err.message);
      process.exit(1);
    });
}
