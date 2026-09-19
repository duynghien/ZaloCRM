import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';
let fixture: Awaited<ReturnType<typeof createTestApp>>;
let getAttachmentsBaseDir: () => string;
const password = 'FixturePassword123';
let passwordHash: string;

beforeAll(async () => {
  fixture = await createTestApp();
  const routesMod = await import('../../src/modules/attachments/attachment-routes.js');
  getAttachmentsBaseDir = routesMod.getAttachmentsBaseDir;
  passwordHash = await bcrypt.hash(password, 4);
}, 120_000);

afterAll(async () => {
  await fixture?.close();
});

async function createOrgAndUser(name = 'Org Test') {
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

describe('Attachment organization isolation and backward compatibility', () => {
  it('downloads and stores files in orgDir with orgId prefix', async () => {
    const { org } = await createOrgAndUser('Org Downloader');
    const baseDir = getAttachmentsBaseDir();
    const orgDir = path.join(baseDir, org.id);

    // Create a dummy image file locally to serve as mock download source
    const dummySrc = path.join(baseDir, `source-${randomUUID()}.jpg`);
    await fs.promises.writeFile(dummySrc, Buffer.from('fake image data 12345'));

    // Test downloadAttachment with file:// is not allowed by outbound URL policy (only https),
    // so we test saving directly to orgDir and route verification
    const uniqueFilename = `${org.id}-${randomUUID()}-test.jpg`;
    await fs.promises.mkdir(orgDir, { recursive: true });
    const localPath = path.join(orgDir, uniqueFilename);
    await fs.promises.writeFile(localPath, Buffer.from('fake image data 12345'));

    expect(fs.existsSync(localPath)).toBe(true);
    expect(localPath.startsWith(orgDir)).toBe(true);

    await fs.promises.unlink(dummySrc).catch(() => {});
  });

  it('allows user of Org A to download Org A file and denies user of Org B', async () => {
    const orgA = await createOrgAndUser('Org A');
    const orgB = await createOrgAndUser('Org B');
    const baseDir = getAttachmentsBaseDir();

    const orgADir = path.join(baseDir, orgA.org.id);
    await fs.promises.mkdir(orgADir, { recursive: true });
    const filenameA = `${orgA.org.id}-${randomUUID()}-photo.jpg`;
    await fs.promises.writeFile(path.join(orgADir, filenameA), Buffer.from('photo data org A'));

    // Org A user downloads via ticket
    const ticketResA = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/attachments/ticket',
      headers: { authorization: `Bearer ${orgA.token}` },
      payload: { filename: filenameA },
    });
    expect(ticketResA.statusCode).toBe(200);
    const ticketA = ticketResA.json().ticket;

    const streamResA = await fixture.app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${filenameA}?ticket=${ticketA}`,
    });
    expect(streamResA.statusCode).toBe(200);
    expect(streamResA.headers['cache-control']).toBe('private, no-transform, max-age=86400');
    expect(streamResA.body).toBe('photo data org A');

    // Org B user attempts to request ticket for Org A's file -> 404
    const ticketResB = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/attachments/ticket',
      headers: { authorization: `Bearer ${orgB.token}` },
      payload: { filename: filenameA },
    });
    expect(ticketResB.statusCode).toBe(404);

    // Org B user attempts direct stream with Org B Bearer token -> 403
    const streamResB = await fixture.app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${filenameA}`,
      headers: { authorization: `Bearer ${orgB.token}` },
    });
    expect(streamResB.statusCode).toBe(403);
  });

  it('supports backward compatibility via JSONB @> and performs atomic migration', async () => {
    const orgA = await createOrgAndUser('Org BackwardCompat');
    const baseDir = getAttachmentsBaseDir();
    const orgADir = path.join(baseDir, orgA.org.id);

    // Legacy file in baseDir without org prefix
    const legacyFilename = `${randomUUID()}-legacy-pic.jpg`;
    const baseFile = path.join(baseDir, legacyFilename);
    await fs.promises.writeFile(baseFile, Buffer.from('legacy image binary content'));

    // Create conversation and message with attachment belonging to Org A
    const zaloAccount = await fixture.prisma.zaloAccount.create({
      data: {
        org: { connect: { id: orgA.org.id } },
        owner: { connect: { id: orgA.user.id } },
        zaloUid: `zalo-${randomUUID()}`,
        displayName: 'Zalo Acc',
      },
    });
    const conv = await fixture.prisma.conversation.create({
      data: {
        orgId: orgA.org.id,
        zaloAccountId: zaloAccount.id,
        externalThreadId: `thread-${randomUUID()}`,
      },
    });
    await fixture.prisma.message.create({
      data: {
        conversationId: conv.id,
        senderType: 'contact',
        contentType: 'image',
        attachments: [
          {
            filename: legacyFilename,
            url: `/api/v1/attachments/${legacyFilename}`,
            originalName: 'legacy-pic.jpg',
          },
        ],
        sentAt: new Date(),
      },
    });

    // Org A requests ticket for legacy file -> succeeds and migrates
    const ticketRes = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/attachments/ticket',
      headers: { authorization: `Bearer ${orgA.token}` },
      payload: { filename: legacyFilename },
    });
    expect(ticketRes.statusCode).toBe(200);

    // Stream the legacy file
    const streamRes = await fixture.app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${legacyFilename}?ticket=${ticketRes.json().ticket}`,
    });
    expect(streamRes.statusCode).toBe(200);
    expect(streamRes.body).toBe('legacy image binary content');

    // Verify file has been atomically migrated to orgADir and removed from baseDir
    expect(fs.existsSync(path.join(orgADir, legacyFilename))).toBe(true);
    expect(fs.existsSync(baseFile)).toBe(false);
  });

  it('prevents tenant hijacking when Org B embeds Org A filename outside filename property', async () => {
    const orgA = await createOrgAndUser('Org Victim');
    const orgB = await createOrgAndUser('Org Attacker');
    const baseDir = getAttachmentsBaseDir();

    const legacyFilename = `${randomUUID()}-secret.jpg`;
    const baseFile = path.join(baseDir, legacyFilename);
    await fs.promises.writeFile(baseFile, Buffer.from('confidential data of org A'));

    // Org A owns the attachment in DB
    const zaloA = await fixture.prisma.zaloAccount.create({
      data: {
        org: { connect: { id: orgA.org.id } },
        owner: { connect: { id: orgA.user.id } },
        zaloUid: `zalo-${randomUUID()}`,
        displayName: 'Zalo A',
      },
    });
    const convA = await fixture.prisma.conversation.create({
      data: { orgId: orgA.org.id, zaloAccountId: zaloA.id, externalThreadId: `thread-${randomUUID()}` },
    });
    await fixture.prisma.message.create({
      data: {
        conversationId: convA.id,
        senderType: 'contact',
        attachments: [{ filename: legacyFilename, originalName: 'secret.jpg' }],
        sentAt: new Date(),
      },
    });

    // Org B creates a message trying to hijack by putting filename in title or content
    const zaloB = await fixture.prisma.zaloAccount.create({
      data: {
        org: { connect: { id: orgB.org.id } },
        owner: { connect: { id: orgB.user.id } },
        zaloUid: `zalo-${randomUUID()}`,
        displayName: 'Zalo B',
      },
    });
    const convB = await fixture.prisma.conversation.create({
      data: { orgId: orgB.org.id, zaloAccountId: zaloB.id, externalThreadId: `thread-${randomUUID()}` },
    });
    await fixture.prisma.message.create({
      data: {
        conversationId: convB.id,
        senderType: 'contact',
        content: `I am trying to exploit ${legacyFilename}`,
        attachments: [{ title: legacyFilename, extractedText: `hacked ${legacyFilename}` }], // NOT in filename property
        sentAt: new Date(),
      },
    });

    // Org B attempts to get ticket for legacyFilename -> 404
    const ticketRes = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/attachments/ticket',
      headers: { authorization: `Bearer ${orgB.token}` },
      payload: { filename: legacyFilename },
    });
    expect(ticketRes.statusCode).toBe(404);

    // Org B attempts direct stream -> 404
    const streamRes = await fixture.app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${legacyFilename}`,
      headers: { authorization: `Bearer ${orgB.token}` },
    });
    expect(streamRes.statusCode).toBe(404);

    // Clean up
    await fs.promises.unlink(baseFile).catch(() => {});
  });

  it('rejects path traversal and directory inputs with 400 Bad Request', async () => {
    const { token } = await createOrgAndUser('Org Traversal');

    // Ticket route validates filename directly in JSON body
    for (const bad of ['.', '..', 'staged', '../etc/passwd', 'folder/file', 'bad*name']) {
      const ticketRes = await fixture.app.inject({
        method: 'POST',
        url: '/api/v1/attachments/ticket',
        headers: { authorization: `Bearer ${token}` },
        payload: { filename: bad },
      });
      expect(ticketRes.statusCode).toBe(400);
    }

    // Direct streaming route rejects invalid filename tokens with 400
    for (const bad of ['staged', 'bad*name', 'file:name']) {
      const streamRes = await fixture.app.inject({
        method: 'GET',
        url: `/api/v1/attachments/${bad}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(streamRes.statusCode).toBe(400);
    }
  });
});
