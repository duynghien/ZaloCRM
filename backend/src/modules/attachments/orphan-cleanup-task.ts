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
import { logger } from '../../shared/utils/logger.js';

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
 */
export async function runOrphanCleanup(maxAgeMs = DEFAULT_ORPHAN_AGE_MS): Promise<CleanupReport> {
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
