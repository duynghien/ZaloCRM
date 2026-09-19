/**
 * attachment-legacy-migration.ts — Handles atomic legacy attachment migration and DB ownership verification.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

const inFlightMigrations = new Map<string, Promise<string | null>>();

/**
 * Validates that the filename contains only safe characters and is not a directory traversal token.
 */
export function isValidAttachmentFilename(filename: string): boolean {
  if (!filename || typeof filename !== 'string') return false;
  if (filename.includes('/') || filename.includes('\\')) return false;
  const safe = path.basename(filename);
  if (!/^[a-zA-Z0-9._-]+$/.test(safe)) return false;
  if (safe === '.' || safe === '..' || safe === 'staged') return false;
  return true;
}

/**
 * Verifies that the specified legacy attachment belongs to the given organization
 * using PostgreSQL JSONB containment operator (@>) with GIN index.
 */
export async function verifyAttachmentOwnershipViaDb(filename: string, orgId: string): Promise<boolean> {
  try {
    const targetJson = JSON.stringify([{ filename }]);
    const matches = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT m.id
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.org_id = ${orgId}
        AND m.attachments @> ${targetJson}::jsonb
      LIMIT 1
    `;
    return matches.length > 0;
  } catch (err) {
    logger.warn(`[attachment-legacy-migration] DB verification failed for ${filename}:`, err);
    return false;
  }
}

/**
 * Atomically migrates a legacy attachment from baseDir into orgDir using .part staging and rename,
 * then removes the file from baseDir to prevent disk bloat.
 */
export async function atomicMigrateLegacyAttachment(
  baseFile: string,
  orgDir: string,
  safeFilename: string,
): Promise<string | null> {
  const destPath = path.join(orgDir, safeFilename);
  if (fs.existsSync(destPath)) return destPath;

  const migrationKey = `${orgDir}:${safeFilename}`;
  if (inFlightMigrations.has(migrationKey)) {
    return inFlightMigrations.get(migrationKey)!;
  }

  const migrationPromise = (async () => {
    try {
      await fs.promises.mkdir(orgDir, { recursive: true });
      const tempPartPath = `${destPath}.part-${randomUUID()}`;
      await fs.promises.copyFile(baseFile, tempPartPath);
      await fs.promises.rename(tempPartPath, destPath);
      // Clean up base file after successful atomic rename to prevent permanent disk bloat
      await fs.promises.unlink(baseFile).catch(() => {});
      return destPath;
    } catch (err) {
      logger.error(`[attachment-legacy-migration] Migration failed for ${safeFilename}:`, err);
      return null;
    } finally {
      inFlightMigrations.delete(migrationKey);
    }
  })();

  inFlightMigrations.set(migrationKey, migrationPromise);
  return migrationPromise;
}
