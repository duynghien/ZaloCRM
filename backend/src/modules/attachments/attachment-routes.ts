/**
 * attachment-routes.ts — Media upload, ticket generation, deletion, and secure streaming.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { config } from '../../config/index.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import {
  MAX_DOC_SIZE,
  MAX_IMAGE_SIZE,
  MAX_FILES_PER_BATCH,
  validateFileMetadata,
  validateMagicBytes,
  sanitizeFilename,
  getExtension,
} from './attachment-validator.js';
import { createMediaTicket, verifyMediaTicket } from './attachment-ticket-service.js';
import {
  isValidAttachmentFilename,
  verifyAttachmentOwnershipViaDb,
  atomicMigrateLegacyAttachment,
} from './attachment-legacy-migration.js';
import { logger } from '../../shared/utils/logger.js';

export function getAttachmentsBaseDir(): string {
  const baseDir = config.uploadDir || path.resolve(process.cwd(), 'uploads');
  const targetDir = path.resolve(baseDir, 'attachments');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const stagedDir = path.resolve(targetDir, 'staged');
  if (!fs.existsSync(stagedDir)) {
    fs.mkdirSync(stagedDir, { recursive: true });
  }
  return targetDir;
}

export function getOrgAttachmentsDir(orgId: string): string {
  const base = getAttachmentsBaseDir();
  const orgDir = path.resolve(base, orgId);
  if (!fs.existsSync(orgDir)) {
    fs.mkdirSync(orgDir, { recursive: true });
  }
  return orgDir;
}

export async function attachmentRoutes(app: FastifyInstance) {
  // ── Upload media files (1 to 5 files, staged) ─────────────────────────────
  app.post('/api/v1/media/upload', { preHandler: authMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    if (!request.isMultipart()) {
      return reply.status(400).send({ error: 'Yêu cầu định dạng multipart/form-data' });
    }

    const parts = request.files({
      limits: {
        fileSize: MAX_DOC_SIZE,
        files: MAX_FILES_PER_BATCH,
      },
    });

    const uploadedFiles: Array<{
      id: string;
      filename: string;
      originalName: string;
      mimeType: string;
      size: number;
      url: string;
    }> = [];

    const stagedPathsToCleanup: string[] = [];
    let fileCount = 0;

    try {
      for await (const part of parts) {
        fileCount++;
        if (fileCount > MAX_FILES_PER_BATCH) {
          throw new Error(`Chỉ được gửi tối đa ${MAX_FILES_PER_BATCH} tệp mỗi lần.`);
        }

        const rawFilename = part.filename || `file_${Date.now()}`;
        const sanitized = sanitizeFilename(rawFilename);
        const ext = getExtension(sanitized);

        const initialMeta = validateFileMetadata(sanitized, part.mimetype, 0);
        if (!initialMeta.valid) {
          throw new Error(initialMeta.error || 'Tệp không hợp lệ.');
        }

        const fileId = randomUUID();
        const storedFilename = `${user.orgId}-${fileId}-${sanitized}`;
        const baseDir = getAttachmentsBaseDir();
        const stagedDir = path.join(baseDir, 'staged');
        const stagedPath = path.join(stagedDir, storedFilename);

        stagedPathsToCleanup.push(stagedPath);

        // Stream to file while collecting header bytes and total size
        const writeStream = fs.createWriteStream(stagedPath);
        let totalBytes = 0;
        let headerBuffer = Buffer.alloc(0);
        const headerLimit = 1024;
        let headerCaptured = false;

        const maxAllowedSize = initialMeta.fileType === 'image' ? MAX_IMAGE_SIZE : MAX_DOC_SIZE;

        try {
          part.file.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes > maxAllowedSize) {
              part.file.destroy(new Error(`Tệp "${sanitized}" vượt quá dung lượng tối đa cho phép (${maxAllowedSize / (1024 * 1024)}MB).`));
              return;
            }
            if (!headerCaptured) {
              headerBuffer = Buffer.concat([headerBuffer, chunk]);
              if (headerBuffer.length >= headerLimit) {
                headerCaptured = true;
              }
            }
          });

          await pipeline(part.file, writeStream);

          // Deep inspection of magic bytes
          const magicCheck = validateMagicBytes(headerBuffer, ext);
          if (!magicCheck.valid) {
            throw new Error(`Tệp "${sanitized}" bị từ chối: ${magicCheck.error}`);
          }

          uploadedFiles.push({
            id: fileId,
            filename: storedFilename,
            originalName: sanitized,
            mimeType: initialMeta.mimeType || part.mimetype,
            size: totalBytes,
            url: `/api/v1/attachments/${storedFilename}`,
          });
        } catch (streamErr: any) {
          writeStream.destroy();
          await fs.promises.unlink(stagedPath).catch(() => {});
          throw streamErr;
        }
      }

      if (uploadedFiles.length === 0) {
        return reply.status(400).send({ error: 'Không tìm thấy tệp đính kèm nào được tải lên.' });
      }

      return { files: uploadedFiles };
    } catch (err: any) {
      // Cleanup all staged files from this failed batch
      for (const p of stagedPathsToCleanup) {
        await fs.promises.unlink(p).catch(() => {});
      }
      logger.warn(`[media-upload] Upload error: ${err?.message || err}`);
      return reply.status(400).send({ error: err?.message || 'Tải tệp lên thất bại.' });
    }
  });

  // ── Cancel/Delete staged upload ───────────────────────────────────────────
  app.delete('/api/v1/media/upload/:id', { preHandler: authMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const safeId = path.basename(id);

    const baseDir = getAttachmentsBaseDir();
    const stagedDir = path.join(baseDir, 'staged');

    try {
      const files = await fs.promises.readdir(stagedDir);
      // Find file starting with orgId and containing id
      const targetFile = files.find(
        (f) => f.startsWith(`${user.orgId}-`) && (f.includes(safeId) || f === safeId),
      );

      if (targetFile) {
        await fs.promises.unlink(path.join(stagedDir, targetFile)).catch(() => {});
        return { success: true, deleted: targetFile };
      }

      return { success: true, message: 'File not found or already deleted' };
    } catch (err) {
      return { success: true };
    }
  });

  // ── Request Short-lived Media Ticket ──────────────────────────────────────
  app.post('/api/v1/attachments/ticket', { preHandler: authMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { filename } = (request.body || {}) as { filename?: string };

    if (!filename || typeof filename !== 'string' || !isValidAttachmentFilename(filename)) {
      return reply.status(400).send({ error: 'Tên tệp không hợp lệ' });
    }

    const safeFilename = path.basename(filename);
    const baseDir = getAttachmentsBaseDir();
    const orgDir = path.join(baseDir, user.orgId);
    const stagedDir = path.join(baseDir, 'staged');

    // Verify file belongs to this org
    const inOrg = fs.existsSync(path.join(orgDir, safeFilename));
    const inStaged = safeFilename.startsWith(`${user.orgId}-`) && fs.existsSync(path.join(stagedDir, safeFilename));
    const inRoot = safeFilename.startsWith(`${user.orgId}-`) && fs.existsSync(path.join(baseDir, safeFilename));

    let isAuthorized = inOrg || inStaged || inRoot;

    // Backward compatibility check cho tệp cũ chưa có org prefix
    const baseFile = path.join(baseDir, safeFilename);
    if (!isAuthorized && fs.existsSync(baseFile) && fs.statSync(baseFile).isFile()) {
      isAuthorized = await verifyAttachmentOwnershipViaDb(safeFilename, user.orgId);
      if (isAuthorized) {
        await atomicMigrateLegacyAttachment(baseFile, orgDir, safeFilename);
      }
    }

    if (!isAuthorized) {
      return reply.status(404).send({ error: 'Attachment not found in your organization' });
    }

    const ticket = createMediaTicket(safeFilename, user.orgId, 60);
    return { ticket, expiresIn: 60 };
  });

  // ── Protected File Streaming ──────────────────────────────────────────────
  app.get('/api/v1/attachments/:filename', async (request: FastifyRequest, reply: FastifyReply) => {
    const { filename } = request.params as { filename: string };
    if (!isValidAttachmentFilename(filename)) {
      return reply.status(400).send({ error: 'Tên tệp không hợp lệ' });
    }
    const safeFilename = path.basename(filename);

    let authenticatedOrgId: string | null = null;

    // 1. Check Media Session Cookie
    const mediaCookie = request.cookies[config.mediaCookieName || 'zalo_crm_media_session'];
    if (mediaCookie) {
      try {
        const decoded = app.jwt.verify(mediaCookie) as any;
        if (decoded && decoded.orgId) {
          authenticatedOrgId = decoded.orgId;
        }
      } catch {}
    }

    // 2. Check Short-lived Media Ticket
    if (!authenticatedOrgId) {
      const ticket = (request.query as any)?.ticket;
      if (ticket) {
        const verified = verifyMediaTicket(ticket);
        if (verified && verified.filename === safeFilename) {
          authenticatedOrgId = verified.orgId;
        }
      }
    }

    // 3. Check Bearer Authorization Header
    if (!authenticatedOrgId) {
      try {
        await request.jwtVerify();
        const user = request.user as { orgId?: string };
        if (user?.orgId) {
          authenticatedOrgId = user.orgId;
        }
      } catch {}
    }

    // 4. Check Query Token (JWT access or media token passed as ?token=... or ?t=...)
    if (!authenticatedOrgId) {
      const queryToken = (request.query as any)?.token || (request.query as any)?.t;
      if (queryToken && typeof queryToken === 'string') {
        try {
          const decoded = app.jwt.verify(queryToken) as any;
          if (decoded && decoded.orgId) {
            authenticatedOrgId = decoded.orgId;
          }
        } catch {}
      }
    }

    if (!authenticatedOrgId) {
      return reply.status(401).send({ error: 'Unauthorized: Media access requires valid session or ticket' });
    }

    const baseDir = getAttachmentsBaseDir();
    const orgDir = path.join(baseDir, authenticatedOrgId);
    const stagedDir = path.join(baseDir, 'staged');

    // 1) Check if file belongs to authenticatedOrgId
    const ownOrgPath = path.join(orgDir, safeFilename);
    const ownStagedPath = safeFilename.startsWith(`${authenticatedOrgId}-`) ? path.join(stagedDir, safeFilename) : null;
    const ownLegacyPath = safeFilename.startsWith(`${authenticatedOrgId}-`) ? path.join(baseDir, safeFilename) : null;

    let resolvedPath: string | null = null;
    if (fs.existsSync(ownOrgPath)) {
      resolvedPath = ownOrgPath;
    } else if (ownStagedPath && fs.existsSync(ownStagedPath)) {
      resolvedPath = ownStagedPath;
    } else if (ownLegacyPath && fs.existsSync(ownLegacyPath)) {
      resolvedPath = ownLegacyPath;
    } else {
      const baseFile = path.join(baseDir, safeFilename);
      if (fs.existsSync(baseFile) && fs.statSync(baseFile).isFile()) {
        const isOwner = await verifyAttachmentOwnershipViaDb(safeFilename, authenticatedOrgId);
        if (isOwner) {
          resolvedPath = (await atomicMigrateLegacyAttachment(baseFile, orgDir, safeFilename)) || baseFile;
        } else {
          logger.warn(`[attachment-routes] Unauthorized or orphaned legacy file accessed: ${safeFilename} by org ${authenticatedOrgId}`);
        }
      }
    }

    if (!resolvedPath) {
      // Check if file exists under another organization or staged under another org
      // to properly distinguish 403 Forbidden from 404 Not Found
      let existsInOtherOrg = false;
      try {
        const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name !== authenticatedOrgId && entry.name !== 'staged') {
            if (fs.existsSync(path.join(baseDir, entry.name, safeFilename))) {
              existsInOtherOrg = true;
              break;
            }
          }
        }
        if (!existsInOtherOrg && fs.existsSync(path.join(stagedDir, safeFilename))) {
          existsInOtherOrg = true;
        }
      } catch {}

      if (existsInOtherOrg) {
        return reply.status(403).send({ error: 'Forbidden: Access to this organization attachment is denied' });
      }

      return reply.status(404).send({ error: 'Attachment not found' });
    }

    // Path traversal check
    if (!resolvedPath.startsWith(baseDir)) {
      return reply.status(403).send({ error: 'Invalid attachment path' });
    }

    const ext = getExtension(safeFilename);
    const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);

    // Security Headers
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, no-transform, max-age=86400');

    if (isImage) {
      reply.header('Content-Disposition', 'inline');
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      reply.type(mime);
    } else {
      // Strip orgId and optional UUID prefixes for friendly download filename
      const cleanDownloadName = safeFilename.replace(/^[a-zA-Z0-9_-]+-(?:[a-f0-9-]{36}-)?/, '');
      reply.header(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(cleanDownloadName || safeFilename)}"`,
      );
      reply.type('application/octet-stream');
    }

    const stream = fs.createReadStream(resolvedPath);
    return reply.send(stream);
  });
}
