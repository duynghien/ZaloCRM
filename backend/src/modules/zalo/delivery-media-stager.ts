import fs from 'node:fs';
import path from 'node:path';
import { getOrgAttachmentsDir } from '../attachments/attachment-routes.js';
import type { StagedMediaFile } from './zalo-outbound-outbox.js';

export interface MovedAttachment {
  url: string;
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  fileType: 'image' | 'file';
  permanentPath: string;
  stagedPath: string;
}

/**
 * Rolls back moved media files from permanent storage back to staged storage in reverse order.
 * Idempotent: checks if file exists before attempting rename/copy.
 */
export async function rollbackMovedMediaToStaged(
  movedAttachments: Array<{ permanentPath: string; stagedPath: string }>
): Promise<void> {
  if (!movedAttachments || movedAttachments.length === 0) return;
  const reversed = [...movedAttachments].reverse();

  for (const file of reversed) {
    try {
      const exists = await fs.promises
        .access(file.permanentPath)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        await fs.promises.mkdir(path.dirname(file.stagedPath), { recursive: true });
        try {
          await fs.promises.rename(file.permanentPath, file.stagedPath);
        } catch {
          await fs.promises.copyFile(file.permanentPath, file.stagedPath);
          await fs.promises.unlink(file.permanentPath).catch(() => {});
        }
      }
    } catch {
      // Idempotent error suppression for clean rollback
    }
  }
}

export async function moveStagedMediaToPermanentStorage(
  orgId: string,
  mediaFiles: StagedMediaFile[]
): Promise<MovedAttachment[]> {
  const movedAttachments: MovedAttachment[] = [];
  if (!mediaFiles || mediaFiles.length === 0) {
    return movedAttachments;
  }

  const orgDir = getOrgAttachmentsDir(orgId);
  await fs.promises.mkdir(orgDir, { recursive: true });

  try {
    for (const file of mediaFiles) {
      const destPath = path.join(orgDir, file.filename);
      try {
        await fs.promises.rename(file.stagedPath, destPath);
      } catch {
        await fs.promises.copyFile(file.stagedPath, destPath);
        await fs.promises.unlink(file.stagedPath).catch(() => {});
      }

      movedAttachments.push({
        url: `/api/v1/attachments/${file.filename}`,
        filename: file.filename,
        originalName: file.originalName,
        size: file.size,
        mimeType: file.mimeType,
        fileType: file.fileType,
        permanentPath: destPath,
        stagedPath: file.stagedPath,
      });
    }
    return movedAttachments;
  } catch (err) {
    await rollbackMovedMediaToStaged(movedAttachments);
    throw err;
  }
}
