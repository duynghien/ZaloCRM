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
    });
  }

  return movedAttachments;
}
