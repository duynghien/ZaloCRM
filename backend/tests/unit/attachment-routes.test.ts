/**
 * attachment-routes.test.ts — Unit tests for attachment validation, ticket service,
 * upload endpoint, delete endpoint, and protected file streaming.
 */
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
  validateFileMetadata,
  validateMagicBytes,
  sanitizeFilename,
  MAX_IMAGE_SIZE,
  MAX_DOC_SIZE,
} from '../../src/modules/attachments/attachment-validator.js';
import {
  createMediaTicket,
  verifyMediaTicket,
} from '../../src/modules/attachments/attachment-ticket-service.js';
import {
  attachmentRoutes,
  getAttachmentsBaseDir,
} from '../../src/modules/attachments/attachment-routes.js';

vi.mock('../../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: vi.fn(async (req: any) => {
    req.user = { id: 'u-1', orgId: 'org-test', role: 'owner', email: 'test@example.com' };
  }),
}));

describe('Attachment Validator', () => {
  it('sanitizes filenames and strips dangerous path characters', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('my report (1) *final*.pdf')).toBe('my_report__1___final_.pdf');
    expect(sanitizeFilename('normal-image.PNG')).toBe('normal-image.PNG');
  });

  it('validates allowed image metadata', () => {
    const res = validateFileMetadata('photo.png', 'image/png', 5 * 1024 * 1024);
    expect(res.valid).toBe(true);
    expect(res.fileType).toBe('image');
  });

  it('rejects oversize images (> 15MB)', () => {
    const res = validateFileMetadata('huge.png', 'image/png', MAX_IMAGE_SIZE + 1024);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('15MB');
  });

  it('validates allowed document metadata', () => {
    const res = validateFileMetadata('document.pdf', 'application/pdf', 20 * 1024 * 1024);
    expect(res.valid).toBe(true);
    expect(res.fileType).toBe('file');
  });

  it('rejects oversize documents (> 30MB)', () => {
    const res = validateFileMetadata('huge.pdf', 'application/pdf', MAX_DOC_SIZE + 1024);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('30MB');
  });

  it('strictly rejects forbidden extensions (HTML, SVG, Script, Executables)', () => {
    expect(validateFileMetadata('bad.html', 'text/html', 100).valid).toBe(false);
    expect(validateFileMetadata('vector.svg', 'image/svg+xml', 100).valid).toBe(false);
    expect(validateFileMetadata('malware.exe', 'application/x-msdownload', 100).valid).toBe(false);
    expect(validateFileMetadata('hack.sh', 'text/x-sh', 100).valid).toBe(false);
  });

  it('validates magic bytes for genuine images and detects spoofing', () => {
    // Valid PNG header
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(validateMagicBytes(pngHeader, 'png').valid).toBe(true);

    // Valid JPEG header
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(validateMagicBytes(jpegHeader, 'jpg').valid).toBe(true);

    // Fake PNG that is actually HTML/Script
    const fakePng = Buffer.from('<html><script>alert(1)</script></html>');
    const check = validateMagicBytes(fakePng, 'png');
    expect(check.valid).toBe(false);
    expect(check.error).toContain('HTML/SVG/Script');

    // Mismatched header (JPEG header with PNG extension)
    expect(validateMagicBytes(jpegHeader, 'png').valid).toBe(false);
  });

  it('validates magic bytes for PDF and ZIP', () => {
    const pdfHeader = Buffer.from('%PDF-1.7 header');
    expect(validateMagicBytes(pdfHeader, 'pdf').valid).toBe(true);

    const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    expect(validateMagicBytes(zipHeader, 'zip').valid).toBe(true);
    expect(validateMagicBytes(zipHeader, 'docx').valid).toBe(true);
  });
});

describe('Attachment Ticket Service', () => {
  it('creates and verifies a valid ticket', () => {
    const ticket = createMediaTicket('my-file.pdf', 'org-123', 60);
    const verified = verifyMediaTicket(ticket);

    expect(verified).not.toBeNull();
    expect(verified?.filename).toBe('my-file.pdf');
    expect(verified?.orgId).toBe('org-123');
  });

  it('rejects tampered or malformed tickets', () => {
    const ticket = createMediaTicket('my-file.pdf', 'org-123', 60);
    const tampered = 'tampered' + ticket.slice(8);
    expect(verifyMediaTicket(tampered)).toBeNull();
    expect(verifyMediaTicket('invalid.format')).toBeNull();
    expect(verifyMediaTicket('')).toBeNull();
  });

  it('rejects expired tickets', () => {
    const expiredTicket = createMediaTicket('my-file.pdf', 'org-123', -10);
    expect(verifyMediaTicket(expiredTicket)).toBeNull();
  });
});

describe('Attachment Routes Integration', () => {
  let app: any;
  let testFileDir: string;

  beforeEach(async () => {
    app = Fastify({ logger: false, routerOptions: { maxParamLength: 1000 } });
    await app.register(fastifyCookie);
    await app.register(fastifyJwt, { secret: process.env.JWT_SECRET! });
    await app.register(multipart, { limits: { fileSize: 30 * 1024 * 1024, files: 5 } });
    await app.register(attachmentRoutes);
    await app.ready();

    testFileDir = getAttachmentsBaseDir();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/v1/attachments/:filename rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/attachments/any-file.jpg',
    });

    expect(res.statusCode).toBe(401);
  });

  it('GET /api/v1/attachments/:filename serves image with valid media session cookie', async () => {
    const orgId = 'org-test';
    const orgDir = path.join(testFileDir, orgId);
    fs.mkdirSync(orgDir, { recursive: true });

    const samplePng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
    ]);
    const filename = `${orgId}-sample.png`;
    fs.writeFileSync(path.join(orgDir, filename), samplePng);

    const mediaToken = app.jwt.sign(
      { id: 'u-1', email: 'test@example.com', orgId, role: 'owner', sessionId: 'media' },
      { expiresIn: '7d' },
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${filename}`,
      cookies: { zalo_crm_media_session: mediaToken },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'; sandbox");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBe('inline');
  });

  it('GET /api/v1/attachments/:filename serves image with valid token in query param', async () => {
    const orgId = 'org-test';
    const orgDir = path.join(testFileDir, orgId);
    fs.mkdirSync(orgDir, { recursive: true });

    const samplePng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
    ]);
    const filename = `${orgId}-query-sample.png`;
    fs.writeFileSync(path.join(orgDir, filename), samplePng);

    const accessToken = app.jwt.sign(
      { id: 'u-1', email: 'test@example.com', orgId, role: 'owner', sessionId: 'sess-1' },
      { expiresIn: '15m' },
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${filename}?token=${accessToken}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-disposition']).toBe('inline');
  });

  it('GET /api/v1/attachments/:filename serves long filename (> 100 characters) without 404', async () => {
    const orgId = 'org-test';
    const orgDir = path.join(testFileDir, orgId);
    fs.mkdirSync(orgDir, { recursive: true });

    const longName = `${orgId}-${'a'.repeat(80)}-screenshot.png`;
    expect(longName.length).toBeGreaterThan(100);
    fs.writeFileSync(path.join(orgDir, longName), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    const accessToken = app.jwt.sign(
      { id: 'u-1', email: 'test@example.com', orgId, role: 'owner', sessionId: 'sess-1' },
      { expiresIn: '15m' },
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${longName}?token=${accessToken}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });

  it('GET /api/v1/attachments/:filename serves file with valid ticket and forces download for documents', async () => {
    const orgId = 'org-test';
    const orgDir = path.join(testFileDir, orgId);
    fs.mkdirSync(orgDir, { recursive: true });

    const filename = `${orgId}-report.pdf`;
    fs.writeFileSync(path.join(orgDir, filename), '%PDF-1.4 test content');

    const ticket = createMediaTicket(filename, orgId, 60);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${filename}?ticket=${ticket}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toContain("default-src 'none'; sandbox");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toContain('attachment; filename="report.pdf"');
  });

  it('GET /api/v1/attachments/:filename blocks cross-org access with 403 Forbidden', async () => {
    const otherOrg = 'org-other';
    const otherDir = path.join(testFileDir, otherOrg);
    fs.mkdirSync(otherDir, { recursive: true });

    const filename = `${otherOrg}-secret-file.pdf`;
    fs.writeFileSync(path.join(otherDir, filename), 'secret other org data');

    const attackerToken = app.jwt.sign(
      { id: 'u-attacker', email: 'attacker@example.com', orgId: 'org-attacker', role: 'owner', sessionId: 'media' },
      { expiresIn: '7d' },
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${filename}`,
      cookies: { zalo_crm_media_session: attackerToken },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('Attachment not found');
  });

  it('POST /api/v1/attachments/ticket returns valid ticket for org file', async () => {
    const orgId = 'org-test';
    const orgDir = path.join(testFileDir, orgId);
    fs.mkdirSync(orgDir, { recursive: true });

    const filename = `${orgId}-contract.pdf`;
    fs.writeFileSync(path.join(orgDir, filename), '%PDF-1.4 test contract');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/attachments/ticket',
      payload: { filename },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ticket).toBeDefined();
    expect(body.expiresIn).toBe(60);

    const verified = verifyMediaTicket(body.ticket);
    expect(verified?.filename).toBe(filename);
    expect(verified?.orgId).toBe(orgId);
  });

  it('DELETE /api/v1/media/upload/:id removes staged file', async () => {
    const orgId = 'org-test';
    const stagedDir = path.join(testFileDir, 'staged');
    fs.mkdirSync(stagedDir, { recursive: true });

    const fileId = 'draft-12345';
    const stagedFilename = `${orgId}-${fileId}-sample.png`;
    const stagedPath = path.join(stagedDir, stagedFilename);
    fs.writeFileSync(stagedPath, 'dummy data');

    expect(fs.existsSync(stagedPath)).toBe(true);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/media/upload/${fileId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(stagedPath)).toBe(false);
  });
});
