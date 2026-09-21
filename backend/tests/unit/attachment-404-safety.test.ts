process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import {
  attachmentRoutes,
  getAttachmentsBaseDir,
} from '../../src/modules/attachments/attachment-routes.js';

vi.mock('../../src/shared/database/prisma-client.js', () => ({
  prisma: {
    authSession: {
      findFirst: vi.fn(async () => ({ id: 'valid-session' })),
    },
  },
}));

vi.mock('../../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: vi.fn(async (req: any) => {
    req.user = { id: 'u-1', orgId: 'org-test', role: 'owner', email: 'test@example.com' };
  }),
}));

describe('Attachment 404 Safety & O(1) Staged Handling', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify();
    await app.register(fastifyCookie);
    await app.register(fastifyJwt, { secret: 'test_jwt_secret_32_characters_long_12345' });
    await app.register(multipart);
    await app.register(attachmentRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 404 immediately for non-existent file without cross-tenant scanning', async () => {
    const token = app.jwt.sign(
      { id: 'u-1', email: 'test@example.com', orgId: 'org-test', role: 'owner', sessionId: 'media' },
      { expiresIn: '1h' },
    );
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/attachments/non-existent-file-12345.jpg',
      cookies: { zalo_crm_media_session: token },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Attachment not found' });
  });

  it('deletes staged file directly in O(1) when safeId starts with user orgId', async () => {
    const baseDir = getAttachmentsBaseDir();
    const stagedDir = path.join(baseDir, 'staged');
    await fs.promises.mkdir(stagedDir, { recursive: true });

    const stagedFileName = `org-test-uuid-testfile.jpg`;
    const stagedFilePath = path.join(stagedDir, stagedFileName);
    await fs.promises.writeFile(stagedFilePath, 'test content');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/media/upload/${stagedFileName}`,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true, deleted: stagedFileName });
    expect(fs.existsSync(stagedFilePath)).toBe(false);
  });

  it('rejects deletion of another organization staged file', async () => {
    const baseDir = getAttachmentsBaseDir();
    const stagedDir = path.join(baseDir, 'staged');
    await fs.promises.mkdir(stagedDir, { recursive: true });

    const otherOrgFileName = `other-org-uuid-testfile.jpg`;
    const otherOrgPath = path.join(stagedDir, otherOrgFileName);
    await fs.promises.writeFile(otherOrgPath, 'other content');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/media/upload/${otherOrgFileName}`,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true, message: 'File not found or already deleted' });
    expect(fs.existsSync(otherOrgPath)).toBe(true);
    await fs.promises.unlink(otherOrgPath).catch(() => {});
  });
});
