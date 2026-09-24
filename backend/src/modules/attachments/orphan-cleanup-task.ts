/**
 * orphan-cleanup-task.ts — Hourly cron job to clean up abandoned staged attachments
 * that were uploaded but never sent as messages (older than 2 hours).
 *
 * Runs strictly against the filesystem (attachments/staged/) to avoid full-table scans
 * on the Message table.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import cron from 'node-cron';
import { config } from '../../config/index.js';
import { withDurableCronLease, CRON_LOCKS } from '../../shared/utils/lock-registry.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { Prisma } from '@prisma/client';
import { logger } from '../../shared/utils/logger.js';
import { recoverExpiredOutboundDispatches } from '../zalo/zalo-outbound-outbox.js';

let cleanupCronTask: ReturnType<typeof cron.schedule> | undefined;
const activeCleanupRuns = new Set<Promise<any>>();

export const DEFAULT_ORPHAN_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface CleanupReport {
  scannedCount: number;
  cleanedCount: number;
  errorCount: number;
}

/**
 * Scan attachments/staged/ and unlink files older than maxAgeMs.
 * Also prunes expired Zalo outbound outbox records.
 */
export async function runOrphanCleanup(maxAgeMs = DEFAULT_ORPHAN_AGE_MS): Promise<CleanupReport> {
  const lockResult = await withDurableCronLease(CRON_LOCKS.ORPHAN_CLEANUP, 'orphan-cleanup', 30 * 60_000, async (signal: AbortSignal) => {
    // 1. Recover expired dispatching outbox messages to uncertain
    await recoverExpiredOutboundDispatches().catch((err) =>
      logger.warn('[cleanup] Failed to recover expired outbound dispatches:', err)
    );

    // 2. Prune expired outbox messages
    await pruneZaloOutboundMessages().catch((err) =>
      logger.warn('[cleanup] Failed to prune outbound messages:', err)
    );
    const stagedDir = path.join(config.uploadDir, 'attachments', 'staged');
    const report: CleanupReport = {
      scannedCount: 0,
      cleanedCount: 0,
      errorCount: 0,
    };

    try {
      await fs.access(stagedDir);
    } catch {
      // Directory doesn't exist yet, nothing to clean
      return report;
    }

  let entries: string[] = [];
  try {
    entries = await fs.readdir(stagedDir);
  } catch (err) {
    logger.warn('[cleanup] Failed to read staged attachments directory:', err);
    return report;
  }

  const cutoff = Date.now() - maxAgeMs;

  for (const entry of entries) {
    if (signal?.aborted) {
      throw new Error('Orphan cleanup aborted due to lost lease');
    }
    // Skip hidden files (.DS_Store, etc.)
    if (entry.startsWith('.')) continue;

    report.scannedCount++;
    const filePath = path.join(stagedDir, entry);

    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) continue;

      if (stats.mtimeMs < cutoff) {
        await fs.unlink(filePath);
        report.cleanedCount++;
        const ageMinutes = Math.round((Date.now() - stats.mtimeMs) / 60000);
        logger.info(`[cleanup] Deleted orphaned staged file: ${entry} (age: ${ageMinutes}m)`);
      }
    } catch (err) {
      report.errorCount++;
      logger.warn(`[cleanup] Failed to clean staged file ${entry}:`, err);
    }
    }
    return report;
  });

  if (!lockResult.executed) {
    return { scannedCount: 0, cleanedCount: 0, errorCount: 0 };
  }
  return lockResult.result;
}

/**
 * Start hourly cron job for orphaned staged files.
 * Runs at minute 0 of every hour ('0 * * * *').
 */
export function startOrphanCleanupTask(): void {
  cleanupCronTask?.stop();
  cleanupCronTask = cron.schedule('0 * * * *', () => {
    const run = runOrphanCleanup()
      .then((rep) => {
        if (rep.cleanedCount > 0) {
          logger.info(`[cleanup] Hourly staged cleanup complete: cleaned ${rep.cleanedCount} files (${rep.scannedCount} scanned)`);
        }
      })
      .catch((err) => {
        logger.error('[cleanup] Error during hourly orphan cleanup:', err);
      })
      .finally(() => {
        activeCleanupRuns.delete(run);
      });

    activeCleanupRuns.add(run);
    return run;
  });

  logger.info('[cleanup] Orphan staged attachment cleanup cron scheduled (hourly)');
}

/**
 * Stop cron job and wait for any active cleanup runs to settle.
 */
export async function stopOrphanCleanupTask(): Promise<void> {
  cleanupCronTask?.stop();
  cleanupCronTask = undefined;
  await Promise.allSettled(activeCleanupRuns);
}

/**
 * Prunes and redacts outbound outbox messages according to retention policy (Decisions 2 & 3):
 * - 30 days for 'succeeded' records (deleted)
 * - 90 days for 'failed_before_dispatch' records (deleted)
 * - 'uncertain' records are KEPT PERMANENTLY as tombstones to prevent duplicate sends lifetime.
 *   After 90 days, their payload (content and attachments) is redacted (set to NULL) to save space,
 *   while preserving id, orgId, accountId, threadId, idempotencyKey, requestHash, state.
 *   Media files are preserved for reconciliation and NOT deleted by orphan cleanup.
 */
export async function pruneZaloOutboundMessages(): Promise<{
  succeededPruned: number;
  failedPruned: number;
  uncertainRedacted: number;
}> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const succeededResult = await prisma.zaloOutboundMessage.deleteMany({
    where: {
      state: 'succeeded',
      createdAt: { lt: thirtyDaysAgo },
    },
  });

  const failedResult = await prisma.zaloOutboundMessage.deleteMany({
    where: {
      state: 'failed_before_dispatch',
      createdAt: { lt: ninetyDaysAgo },
    },
  });

  const redactedResult = await prisma.zaloOutboundMessage.updateMany({
    where: {
      state: 'uncertain',
      createdAt: { lt: ninetyDaysAgo },
      OR: [
        { content: { not: null } },
        { attachments: { not: Prisma.DbNull } },
      ],
    },
    data: {
      content: null,
      attachments: Prisma.DbNull,
    },
  });

  if (succeededResult.count > 0 || failedResult.count > 0 || redactedResult.count > 0) {
    logger.info(
      {
        succeededPruned: succeededResult.count,
        failedPruned: failedResult.count,
        uncertainRedacted: redactedResult.count,
      },
      '[cleanup] Pruned and redacted Zalo outbound messages'
    );
  }

  return {
    succeededPruned: succeededResult.count,
    failedPruned: failedResult.count,
    uncertainRedacted: redactedResult.count,
  };
}

