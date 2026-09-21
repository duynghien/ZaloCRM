import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';
let fixture: Awaited<ReturnType<typeof createTestApp>>;
let errApp: any;
let config: any;
let getAttachmentsBaseDir: () => string;
let recoverPendingAttachmentDownloads: () => Promise<void>;
const password = 'FixturePassword123';
let passwordHash: string;

beforeAll(async () => {
  fixture = await createTestApp();
  passwordHash = await bcrypt.hash(password, 4);

  const configMod = await import('../../src/config/index.js');
  config = configMod.config;

  const routesMod = await import('../../src/modules/attachments/attachment-routes.js');
  getAttachmentsBaseDir = routesMod.getAttachmentsBaseDir;

  const procMod = await import('../../src/modules/attachments/attachment-processor.js');
  recoverPendingAttachmentDownloads = procMod.recoverPendingAttachmentDownloads;

  const appFactoryMod = await import('../../src/app-factory.js');
  errApp = await appFactoryMod.createApp();
  errApp.get('/api/v1/test-unhandled-error', async () => {
    throw new Error('Database connection failed: password=super-secret-1234');
  });
  await errApp.ready();
}, 120_000);

afterAll(async () => {
  await errApp?.close();
  await fixture?.close();
});

async function createOrgAndUser(name = 'Validation Test Org') {
  const org = await fixture.prisma.organization.create({ data: { name } });
  const user = await fixture.prisma.user.create({
    data: {
      orgId: org.id,
      role: 'owner',
      email: `${randomUUID()}@test.invalid`,
      fullName: name,
      passwordHash,
    },
  });
  const res = await fixture.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: user.email, password },
  });
  const token = res.json().token as string;
  const cookies = Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
  return { org, user, token, cookies };
}

describe('API validation, error sanitization, and staged cleanup (Phase 7)', () => {
  describe('Global 500 error sanitization', () => {
    it('sanitizes 500 error messages and includes requestId in production', async () => {
      const originalIsProd = config.isProduction;
      try {
        (config as any).isProduction = true;

        const res = await errApp.inject({
          method: 'GET',
          url: '/api/v1/test-unhandled-error',
        });

        expect(res.statusCode).toBe(500);
        const body = res.json();
        expect(body.error).toBe('Internal Server Error');
        expect(body.requestId).toBeDefined();
        expect(typeof body.requestId).toBe('string');
        expect(body.stack).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain('super-secret-1234');
      } finally {
        (config as any).isProduction = originalIsProd;
      }
    });

    it('returns descriptive error message and stack in development/test', async () => {
      const originalIsProd = config.isProduction;
      try {
        (config as any).isProduction = false;

        const res = await errApp.inject({
          method: 'GET',
          url: '/api/v1/test-unhandled-error',
        });

        expect(res.statusCode).toBe(500);
        const body = res.json();
        expect(body.error).toContain('Database connection failed');
        expect(body.stack).toBeDefined();
      } finally {
        (config as any).isProduction = originalIsProd;
      }
    });
  });

  describe('Input bounds & date validation', () => {
    it('rejects invalid pagination on contacts endpoint', async () => {
      const { token } = await createOrgAndUser('Contacts Bounds Org');
      const headers = { authorization: `Bearer ${token}` };

      // Negative page
      const res1 = await fixture.app.inject({
        method: 'GET',
        url: '/api/v1/contacts?page=-1',
        headers,
      });
      expect(res1.statusCode).toBe(400);

      // Non-numeric page
      const res2 = await fixture.app.inject({
        method: 'GET',
        url: '/api/v1/contacts?page=abc',
        headers,
      });
      expect(res2.statusCode).toBe(400);

      // Page out of range (> 10000)
      const res3 = await fixture.app.inject({
        method: 'GET',
        url: '/api/v1/contacts?page=10001',
        headers,
      });
      expect(res3.statusCode).toBe(400);

      // Limit out of range (> 100)
      const res4 = await fixture.app.inject({
        method: 'GET',
        url: '/api/v1/contacts?limit=101',
        headers,
      });
      expect(res4.statusCode).toBe(400);

      // Valid pagination succeeds
      const res5 = await fixture.app.inject({
        method: 'GET',
        url: '/api/v1/contacts?page=1&limit=50',
        headers,
      });
      expect(res5.statusCode).toBe(200);
    });

    it('rejects invalid pagination and dates on appointments endpoints', async () => {
      const { org, user, token } = await createOrgAndUser('Appointments Bounds Org');
      const headers = { authorization: `Bearer ${token}` };

      const contact = await fixture.prisma.contact.create({
        data: { orgId: org.id, fullName: 'Test Contact' },
      });

      // Negative page
      const res1 = await fixture.app.inject({
        method: 'GET',
        url: '/api/v1/appointments?page=-5',
        headers,
      });
      expect(res1.statusCode).toBe(400);

      // Limit out of range
      const res2 = await fixture.app.inject({
        method: 'GET',
        url: '/api/v1/appointments?limit=500',
        headers,
      });
      expect(res2.statusCode).toBe(400);

      // Invalid dateFrom
      const res3 = await fixture.app.inject({
        method: 'GET',
        url: '/api/v1/appointments?dateFrom=not-a-valid-date',
        headers,
      });
      expect(res3.statusCode).toBe(400);
      expect(res3.json().error).toContain('Invalid dateFrom');

      // Invalid dateTo
      const res4 = await fixture.app.inject({
        method: 'GET',
        url: '/api/v1/appointments?dateTo=invalid-to-date',
        headers,
      });
      expect(res4.statusCode).toBe(400);
      expect(res4.json().error).toContain('Invalid dateTo');

      // POST with invalid appointmentDate
      const res5 = await fixture.app.inject({
        method: 'POST',
        url: '/api/v1/appointments',
        headers,
        payload: {
          contactId: contact.id,
          appointmentDate: 'garbage-date',
        },
      });
      expect(res5.statusCode).toBe(400);
      expect(res5.json().error).toContain('Invalid appointmentDate');

      // POST valid appointment
      const validDate = new Date('2026-10-15T09:00:00.000Z');
      const res6 = await fixture.app.inject({
        method: 'POST',
        url: '/api/v1/appointments',
        headers,
        payload: {
          contactId: contact.id,
          appointmentDate: validDate.toISOString(),
          notes: 'Test note',
        },
      });
      expect(res6.statusCode).toBe(201);
      const createdApptId = res6.json().id;

      // PUT with invalid appointmentDate
      const res7 = await fixture.app.inject({
        method: 'PUT',
        url: `/api/v1/appointments/${createdApptId}`,
        headers,
        payload: {
          appointmentDate: 'not-valid-either',
        },
      });
      expect(res7.statusCode).toBe(400);
      expect(res7.json().error).toContain('Invalid appointmentDate');
    });
  });

  describe('Staged file exact UUID matching and deletion', () => {
    it('rejects partial substring matching and deletes exact UUID only', async () => {
      const { org, token } = await createOrgAndUser('Staged Clean Org');
      const headers = { authorization: `Bearer ${token}` };

      const baseDir = getAttachmentsBaseDir();
      const stagedDir = path.join(baseDir, 'staged');
      await fs.promises.mkdir(stagedDir, { recursive: true });

      const uuidTarget = randomUUID();
      const fileTarget = `${org.id}-${uuidTarget}-document.pdf`;
      const fileTargetSuffix = `${org.id}-${uuidTarget}-suffix-document.pdf`;

      const targetPath = path.join(stagedDir, fileTarget);
      const targetSuffixPath = path.join(stagedDir, fileTargetSuffix);

      await fs.promises.writeFile(targetPath, 'file content target');
      await fs.promises.writeFile(targetSuffixPath, 'file content target suffix');

      // Attempt deletion with a partial substring of the target UUID
      const substringId = uuidTarget.slice(0, 12);
      const resPartial = await fixture.app.inject({
        method: 'DELETE',
        url: `/api/v1/media/upload/${substringId}`,
        headers,
      });
      expect(resPartial.statusCode).toBe(200);
      expect(resPartial.json().message).toContain('File not found');

      // Both files must still exist!
      expect(fs.existsSync(targetPath)).toBe(true);
      expect(fs.existsSync(targetSuffixPath)).toBe(true);

      // Now delete with exact UUID
      const resExact = await fixture.app.inject({
        method: 'DELETE',
        url: `/api/v1/media/upload/${uuidTarget}`,
        headers,
      });
      expect(resExact.statusCode).toBe(200);
      expect(resExact.json().deleted).toBe(fileTarget);

      // Target is deleted, but suffix file remains intact!
      expect(fs.existsSync(targetPath)).toBe(false);
      expect(fs.existsSync(targetSuffixPath)).toBe(true);

      // Cleanup remaining test file
      await fs.promises.unlink(targetSuffixPath).catch(() => {});
    });
  });

  describe('Attachment startup recovery pagination', () => {
    it('executes recoverPendingAttachmentDownloads without unhandled exceptions', async () => {
      await expect(recoverPendingAttachmentDownloads()).resolves.not.toThrow();
    });
  });
});
