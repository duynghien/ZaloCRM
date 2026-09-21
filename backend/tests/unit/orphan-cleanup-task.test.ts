import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runOrphanCleanup, startOrphanCleanupTask, stopOrphanCleanupTask } from '../../src/modules/attachments/orphan-cleanup-task.js';
import { config } from '../../src/config/index.js';

vi.mock('../../src/shared/utils/lock-registry.js', () => ({
  CRON_LOCKS: {
    ORPHAN_CLEANUP: 84732614,
  },
  withCronLock: vi.fn(async (_lockId, fn) => ({ executed: true, result: await fn() })),
}));

describe('orphan-cleanup-task', () => {
  let tempDir: string;
  let stagedDir: string;
  const originalUploadDir = config.uploadDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zalocrm-cleanup-test-'));
    stagedDir = path.join(tempDir, 'attachments', 'staged');
    await fs.mkdir(stagedDir, { recursive: true });
    // Point config.uploadDir to our isolated temp directory
    (config as any).uploadDir = tempDir;
  });

  afterEach(async () => {
    (config as any).uploadDir = originalUploadDir;
    await stopOrphanCleanupTask();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('safely handles non-existent staged directory', async () => {
    (config as any).uploadDir = path.join(tempDir, 'non-existent');
    const report = await runOrphanCleanup();
    expect(report.cleanedCount).toBe(0);
    expect(report.scannedCount).toBe(0);
    expect(report.errorCount).toBe(0);
  });

  it('keeps recent files and deletes only files older than maxAgeMs', async () => {
    const recentFile = path.join(stagedDir, 'org-1-recent.png');
    const oldFile = path.join(stagedDir, 'org-1-old.pdf');

    await fs.writeFile(recentFile, 'recent content');
    await fs.writeFile(oldFile, 'old content');

    // Make oldFile 3 hours old (3 * 3600 * 1000 ms)
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000);
    await fs.utimes(oldFile, threeHoursAgo, threeHoursAgo);

    const report = await runOrphanCleanup(2 * 3600 * 1000); // 2 hours cutoff

    expect(report.scannedCount).toBe(2);
    expect(report.cleanedCount).toBe(1);
    expect(report.errorCount).toBe(0);

    // Verify recent file still exists
    await expect(fs.access(recentFile)).resolves.toBeUndefined();

    // Verify old file was deleted
    await expect(fs.access(oldFile)).rejects.toThrow();
  });

  it('ignores hidden files like .DS_Store or .gitkeep', async () => {
    const hiddenFile = path.join(stagedDir, '.DS_Store');
    await fs.writeFile(hiddenFile, 'hidden');

    const fourHoursAgo = new Date(Date.now() - 4 * 3600 * 1000);
    await fs.utimes(hiddenFile, fourHoursAgo, fourHoursAgo);

    const report = await runOrphanCleanup(2 * 3600 * 1000);
    expect(report.cleanedCount).toBe(0);

    // Hidden file preserved
    await expect(fs.access(hiddenFile)).resolves.toBeUndefined();
  });

  it('starts and stops cron task gracefully', async () => {
    expect(() => startOrphanCleanupTask()).not.toThrow();
    await expect(stopOrphanCleanupTask()).resolves.toBeUndefined();
  });
});
