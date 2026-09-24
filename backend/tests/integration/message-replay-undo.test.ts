import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { PassThrough } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';
const previousUploadDir = process.env.UPLOAD_DIR;
const dns = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', async (original) => ({ ...await original<object>(), lookup: dns }));
let fixture: Awaited<ReturnType<typeof createTestApp>>;
let handler: typeof import('../../src/modules/chat/message-handler.js');
let attach: typeof import('../../src/modules/zalo/zalo-listener-factory.js').attachZaloListener;
let uploadDir: string;
beforeAll(async () => {
  uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-attachments-'));
  process.env.UPLOAD_DIR = uploadDir;
  fixture = await createTestApp();
  handler = await import('../../src/modules/chat/message-handler.js');
  attach = (await import('../../src/modules/zalo/zalo-listener-factory.js')).attachZaloListener;
}, 120_000);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await fixture?.close(); await fs.rm(uploadDir, { recursive: true, force: true });
  if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previousUploadDir;
});
async function account(orgId?: string) {
  orgId ??= (await fixture.prisma.organization.create({ data: { name: 'Replay isolation' } })).id;
  const owner = await fixture.prisma.user.create({ data: { orgId, role: 'owner', email: `${randomUUID()}@test.invalid`, fullName: 'Owner', passwordHash: 'unused' } });
  return fixture.prisma.zaloAccount.create({ data: { orgId, ownerUserId: owner.id } });
}
function incoming(accountId: string, threadId = randomUUID(), msgId = randomUUID()) {
  return { accountId, threadId, msgId, senderUid: threadId, senderName: 'Contact', content: 'Replay payload', contentType: 'text', timestamp: Date.now(), isSelf: false, threadType: 'user' as const };
}
function attachmentTransport() {
  dns.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  return vi.spyOn(https, 'request').mockImplementation(((options: any, callback: any) => {
    const request = Object.assign(new EventEmitter(), { write() {}, end() {
      queueMicrotask(() => { const response = Object.assign(new PassThrough(), { statusCode: 200, headers: { 'content-type': 'application/octet-stream' } }); callback(response); response.end('attachment bytes'); });
    }, destroy(error: Error) { request.emit('error', error); } });
    return request;
  }) as any);
}
it.each(['sequential', 'concurrent'])('suppresses %s inbound replay before unread and attachment side effects', async mode => {
  const a = await account(); const msg = { ...incoming(a.id), attachments: [{ url: 'https://cdn.example/file.bin', title: 'file.bin' }] };
  // A real existing contact avoids unrelated contact-creation races.
  await fixture.prisma.contact.create({ data: { orgId: a.orgId, zaloUid: msg.senderUid, fullName: msg.senderName } });
  const transport = attachmentTransport();
  const results = mode === 'concurrent' ? await Promise.all(Array.from({ length: 6 }, () => handler.handleIncomingMessage(msg))) : [await handler.handleIncomingMessage(msg), await handler.handleIncomingMessage(msg)];
  expect(results.filter(Boolean)).toHaveLength(1);
  const saved = results.find(Boolean)!;
  await vi.waitFor(async () => {
    const row = await fixture.prisma.message.findUniqueOrThrow({ where: { id: saved.message.id } });
    expect((row.attachments as any[])[0].localPath).toBeTruthy();
  });
  expect(transport).toHaveBeenCalledOnce();
  const conv = await fixture.prisma.conversation.findUniqueOrThrow({ where: { id: saved.conversationId } });
  expect(conv.unreadCount).toBe(1);
  expect(conv.updatedAt).toBeInstanceOf(Date);
});
it('undo changes only the exact account, conversation and message across shared provider IDs', async () => {
  const a = await account(); const b = await account(a.orgId); const foreign = await account(); const threadId = randomUUID(); const msgId = randomUUID();
  const messages = await Promise.all([incoming(a.id, threadId, msgId), incoming(a.id, randomUUID(), msgId), incoming(b.id, threadId, msgId), incoming(foreign.id, threadId, msgId), incoming(a.id, threadId, randomUUID())].map(m => handler.handleIncomingMessage(m)));
  expect(messages.every(Boolean)).toBe(true);
  await (handler.handleMessageUndo as any)(a.id, msgId, threadId);
  const rows = await Promise.all(messages.map(m => fixture.prisma.message.findUniqueOrThrow({ where: { id: m!.message.id } })));
  expect(rows.map(row => row.isDeleted)).toEqual([true, false, false, false, false]);
  expect(rows[0].deletedAt).toBeInstanceOf(Date);
  expect(rows.slice(1).every(row => row.deletedAt === null)).toBe(true);
});
it('listener preserves concurrent equal IDs in different threads and waits for the matching undo', async () => {
  const a = await account(); const listener = Object.assign(new EventEmitter(), { start: vi.fn() });
  const drain = attach({ accountId: a.id, orgId: a.orgId, api: { listener }, io: null, userInfoCache: new Map(), onDisconnected() {} });
  const msgId = randomUUID(); const threads = [randomUUID(), randomUUID()];
  const callbacks = listener.listeners('message') as Array<(value: any) => Promise<void>>;
  const pending = threads.map(threadId => callbacks[0]({ threadId, isSelf: true, type: 0, data: { msgId, content: 'Concurrent threads', ts: String(Date.now()) } }));
  const undo = (listener.listeners('undo')[0] as any)({ threadId: threads[0], data: { msgId } });
  await Promise.all([...pending, undo]); await drain();
  const rows = await fixture.prisma.message.findMany({ where: { zaloMsgId: msgId, conversation: { zaloAccountId: a.id } }, include: { conversation: true } });
  expect(rows).toHaveLength(2);
  expect(rows.find(r => r.conversation.externalThreadId === threads[0])?.isDeleted).toBe(true);
  expect(rows.find(r => r.conversation.externalThreadId === threads[1])?.isDeleted).toBe(false);
});

it('listener ignores undo without a conversation scope instead of deleting every matching ID', async () => {
  const a = await account(); const saved = await handler.handleIncomingMessage(incoming(a.id));
  expect(saved).not.toBeNull();
  const listener = Object.assign(new EventEmitter(), { start: vi.fn() });
  const drain = attach({ accountId: a.id, orgId: a.orgId, api: { listener }, io: null, userInfoCache: new Map(), onDisconnected() {} });
  try {
    await (listener.listeners('undo')[0] as any)({ data: { msgId: saved!.message.zaloMsgId } });
    expect(await fixture.prisma.message.findUniqueOrThrow({ where: { id: saved!.message.id } })).toMatchObject({ isDeleted: false, deletedAt: null });
  } finally { await drain(); }
});

it.each(['user', 'group'] as const)('publishes %s contact creation only after ingestion commits', async threadType => {
  const a = await account();
  const msg = { ...incoming(a.id), threadType, groupName: 'Committed group' };
  await fixture.prisma.appSetting.create({ data: { orgId: a.orgId, settingKey: 'webhook_url', valuePlain: 'https://hooks.example/events' } });
  const deliveries: Array<{ event: string; data: { contactId?: string; fullName?: string } }> = [];
  dns.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  vi.spyOn(https, 'request').mockImplementation(((_options: any, callback: any) => {
    let body = '';
    const request = Object.assign(new EventEmitter(), {
      write(chunk: string) { body += chunk; },
      end() {
        deliveries.push(JSON.parse(body));
        queueMicrotask(() => {
          const response = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
          callback(response); response.end('ok');
        });
      },
      destroy(error: Error) { request.emit('error', error); },
    });
    return request;
  }) as any);
  // Fail inside PostgreSQL after the contact and conversation inserts. The delay
  // exposes delivery started before rollback, without replacing application code.
  await fixture.prisma.$executeRawUnsafe(`CREATE FUNCTION reject_replay_message() RETURNS trigger AS $$
    BEGIN PERFORM pg_sleep(0.3); RAISE EXCEPTION 'ingestion rollback regression'; END;
    $$ LANGUAGE plpgsql`);
  await fixture.prisma.$executeRawUnsafe('CREATE TRIGGER reject_replay_message BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION reject_replay_message()');
  try {
    expect(await handler.handleIncomingMessage(msg)).toBeNull();
    expect(await fixture.prisma.contact.count({ where: { orgId: a.orgId } })).toBe(0);
    expect(await fixture.prisma.conversation.count({ where: { orgId: a.orgId } })).toBe(0);
    expect(await fixture.prisma.message.count({ where: { zaloMsgId: msg.msgId } })).toBe(0);
    expect(deliveries).toEqual([]);
  } finally {
    await fixture.prisma.$executeRawUnsafe('DROP TRIGGER reject_replay_message ON messages');
    await fixture.prisma.$executeRawUnsafe('DROP FUNCTION reject_replay_message()');
  }
  const saved = await handler.handleIncomingMessage(msg);
  expect(saved).not.toBeNull();
  expect(await handler.handleIncomingMessage(msg)).toBeNull();
  await vi.waitFor(() => expect(deliveries.map(delivery => delivery.event).sort()).toEqual(['contact.created', 'message.received']));
  expect(deliveries.find(delivery => delivery.event === 'contact.created')?.data).toEqual({
    contactId: saved!.contactId, fullName: threadType === 'group' ? msg.groupName : msg.senderName,
  });
  expect(await fixture.prisma.contact.count({ where: { orgId: a.orgId } })).toBe(1);
  expect(await fixture.prisma.message.count({ where: { zaloMsgId: msg.msgId } })).toBe(1);
  expect(await fixture.prisma.conversation.findUniqueOrThrow({ where: { id: saved!.conversationId } })).toMatchObject({ unreadCount: 1 });
});
