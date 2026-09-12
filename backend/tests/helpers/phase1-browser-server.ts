/** Owned loopback browser fixture: production app/DB/auth, only SDK transport doubled. */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import bcrypt from 'bcryptjs';
import { createBrowserTls } from './browser-tls.js';
import { startDisposablePostgres, migrateDisposablePostgres, seedBackendTestEnv } from './disposable-postgres.js';

await new Promise<void>((resolve, reject) => {
  const probe = net.createServer(); probe.once('error', reject);
  probe.listen(4183, '127.0.0.1', () => probe.close(error => error ? reject(error) : resolve()));
});
const database = await startDisposablePostgres();
seedBackendTestEnv(database.databaseUrl);
process.env.NODE_ENV = 'production';
process.env.APP_URL = 'https://127.0.0.1:4183';
let tls: Awaited<ReturnType<typeof createBrowserTls>> | undefined;
let cleanup = async () => { try { await database.stop(); } finally { await tls?.cleanup(); } };
let closing = false;
async function shutdown() { if (closing) return; closing = true; await cleanup(); process.exit(0); }
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
try {
  tls = await createBrowserTls();
  await migrateDisposablePostgres(database.databaseUrl);
  const { prisma } = await import('../../src/shared/database/prisma-client.js');
  const { createApp } = await import('../../src/app-factory.js');
  const { zaloPool } = await import('../../src/modules/zalo/zalo-pool.js');
  const { accountSubscription } = await import('../../src/modules/zalo/zalo-socket.js');
  const { emitAccountEvent, ACCOUNT_EVENT_QUEUE_LIMIT } = await import('../../src/shared/realtime/socket-event-delivery.js');
  const { createSession } = await import('../../src/modules/auth/auth-service.js');
  const app = await createApp({ https: tls, staticRoot: fileURLToPath(new URL('../../../frontend/dist', import.meta.url)) }); zaloPool.setIO(app.io);
  cleanup = async () => {
    zaloPool.disconnectAll(); await zaloPool.drain();
    try { await app.close(); } finally { try { await prisma.$disconnect(); } finally { try { await database.stop(); } finally { await tls?.cleanup(); } } }
  };
  const callbacks: Array<(event: unknown) => void> = [];
  const { Zalo } = createRequire(import.meta.url)('zca-js');
  Zalo.prototype.loginQR = function (_options: unknown, callback: (event: unknown) => void) {
    callbacks.push(callback);
    callback({ type: 0, data: { image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg==' } });
    return new Promise(() => {});
  };
  const loginChecks: boolean[] = [];
  let connections = 0;
  app.io.on('connection', () => { connections++; });
  app.addHook('onRequest', async request => {
    const match = request.url.match(/^\/api\/v1\/zalo-accounts\/([^/]+)\/login$/);
    if (match) loginChecks.push([...app.io.sockets.sockets.values()].some(socket => !!accountSubscription(socket, match[1])));
  });
  app.post<{ Body: { permission?: string } }>('/__fixture/seed', async request => {
    const org = await prisma.organization.create({ data: { name: 'Browser fixture' } });
    const password = 'Browser-fixture-2026!';
    const passwordHash = await bcrypt.hash(password, 4);
    const owner = await prisma.user.create({ data: { orgId: org.id, email: `${randomUUID()}@test.invalid`, passwordHash, fullName: 'Owner', role: 'owner' } });
    const member = await prisma.user.create({ data: { orgId: org.id, email: `${randomUUID()}@test.invalid`, passwordHash, fullName: 'Member', role: 'member' } });
    const account = await prisma.zaloAccount.create({ data: { orgId: org.id, ownerUserId: owner.id, displayName: 'Browser Zalo' } });
    const grant = await prisma.zaloAccountAccess.create({ data: { zaloAccountId: account.id, userId: member.id, permission: request.body?.permission ?? 'admin' } });
    const contact = await prisma.contact.create({ data: { orgId: org.id, fullName: 'Browser Contact' } });
    const conversation = await prisma.conversation.create({ data: { orgId: org.id, zaloAccountId: account.id, contactId: contact.id, externalThreadId: randomUUID(), lastMessageAt: new Date() } });
    const message = await prisma.message.create({ data: { conversationId: conversation.id, zaloMsgId: randomUUID(), senderType: 'contact', content: 'Original browser message', sentAt: new Date() } });
    const ownerSession = await createSession(app, owner);
    return { email: member.email, password, accountId: account.id, grantId: grant.id, conversationId: conversation.id, messageId: message.id, ownerToken: ownerSession.accessToken, loginOffset: loginChecks.length };
  });
  app.post<{ Body: { token: string } }>('/__fixture/expired-token', async request => ({ token: app.jwt.sign({ ...app.jwt.decode(request.body.token) as object, exp: Math.floor(Date.now() / 1000) - 5 }) }));
  app.post('/__fixture/ai-seed', async () => {
    const org = await prisma.organization.create({ data: { name: 'AI browser fixture' } });
    const password = 'Browser-fixture-2026!';
    const owner = await prisma.user.create({ data: { orgId: org.id, email: `${randomUUID()}@test.invalid`, passwordHash: await bcrypt.hash(password, 4), fullName: 'AI Owner', role: 'owner' } });
    const targets = [];
    const threadId = 'same-browser-group';
    for (const name of ['Alpha', 'Beta']) {
      const account = await prisma.zaloAccount.create({ data: { orgId: org.id, ownerUserId: owner.id, displayName: `Account ${name}` } });
      const contact = await prisma.contact.create({ data: { orgId: org.id, fullName: 'Shared Group' } });
      const conversation = await prisma.conversation.create({ data: { orgId: org.id, zaloAccountId: account.id, contactId: contact.id, threadType: 'group', externalThreadId: threadId } });
      await prisma.groupReportConfig.create({ data: { orgId: org.id, zaloAccountId: account.id, groupThreadId: threadId, groupName: 'Shared Group', customPrompt: `Prompt ${name}`, targetResolutionStatus: 'resolved' } });
      targets.push({ zaloAccountId: account.id, groupThreadId: threadId, conversationId: conversation.id });
    }
    const legacy = await prisma.generatedReport.create({ data: { orgId: org.id, createdById: owner.id, title: 'Legacy browser report', periodFrom: new Date(), periodTo: new Date(), summaryContent: 'Legacy fixture text', groupThreadIds: [threadId], targetResolutionStatus: 'legacy_unverified' } });
    return { orgId: org.id, email: owner.email, password, targets, legacyId: legacy.id };
  });
  app.get<{ Params: { orgId: string } }>('/__fixture/ai-state/:orgId', async request => ({
    configs: await prisma.groupReportConfig.findMany({ where: { orgId: request.params.orgId } }),
    jobs: await prisma.aiReportJob.findMany({ where: { orgId: request.params.orgId }, orderBy: { createdAt: 'asc' } }),
  }));
  app.get('/__fixture/state', async () => ({ loginChecks, connections, subscriptions: [...app.io.sockets.sockets.values()].flatMap(socket => [...socket.rooms].filter(room => room.startsWith('account:'))), sockets: app.io.sockets.sockets.size }));
  app.post<{ Body: { action: string; conversationId?: string; messageId?: string } }>('/__fixture/control', async request => {
    const { action, conversationId, messageId } = request.body;
    if (action === 'other-account-undo') {
      const original = await prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: { conversation: { include: { zaloAccount: true } } } });
      const source = original.conversation;
      const account = await prisma.zaloAccount.create({ data: { orgId: source.orgId, ownerUserId: source.zaloAccount.ownerUserId, displayName: 'Other browser account' } });
      const grants = await prisma.zaloAccountAccess.findMany({ where: { zaloAccountId: source.zaloAccountId } });
      await prisma.zaloAccountAccess.createMany({ data: grants.map(grant => ({ zaloAccountId: account.id, userId: grant.userId, permission: 'read' })) });
      const conversation = await prisma.conversation.create({ data: { orgId: source.orgId, zaloAccountId: account.id, externalThreadId: source.externalThreadId } });
      await prisma.message.create({ data: { conversationId: conversation.id, zaloMsgId: original.zaloMsgId, senderType: 'contact', content: 'Other account message', sentAt: new Date(), isDeleted: true, deletedAt: new Date() } });
      await emitAccountEvent(app.io, account.id, 'chat:deleted', { accountId: account.id, conversationId: conversation.id, msgId: original.zaloMsgId });
      // A later packet on the same transport proves the undo reached the browser.
      const message = await prisma.message.create({ data: { conversationId: source.id, zaloMsgId: randomUUID(), senderType: 'contact', content: 'Undo transport barrier', sentAt: new Date() } });
      await emitAccountEvent(app.io, source.zaloAccountId, 'chat:message', { accountId: source.zaloAccountId, conversationId: source.id, message });
    }
    if (action === 'disconnect') for (const socket of app.io.sockets.sockets.values()) socket.conn.close();
    if (action === 'qr') for (const callback of callbacks) callback({ type: 2, data: { display_name: 'Restored QR intent' } });
    if (action === 'change' || action === 'overflow') {
      const original = await prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: { conversation: true } });
      await prisma.message.update({ where: { id: messageId }, data: { isDeleted: true, deletedAt: new Date() } });
      await prisma.message.create({ data: { conversationId: conversationId!, zaloMsgId: randomUUID(), senderType: 'contact', content: 'Recovered browser message', sentAt: new Date() } });
      if (action === 'overflow') {
        const accountId = original.conversation.zaloAccountId;
        const { conversation: _conversation, ...message } = original;
        // Queue admission is synchronous. Fill the bound before the first DB read
        // can resolve, then drop the undo while REST already contains its truth.
        const backlog = Array.from({ length: ACCOUNT_EVENT_QUEUE_LIMIT }, () =>
          emitAccountEvent(app.io, accountId, 'chat:message', { accountId, conversationId, message }));
        backlog.push(emitAccountEvent(app.io, accountId, 'chat:deleted', { accountId, conversationId, msgId: original.zaloMsgId }));
        await Promise.all(backlog);
      }
    }
    // No content is carried by this control event. REST still validates every ACL.
    if (action === 'resync') for (const socket of app.io.sockets.sockets.values()) socket.emit('realtime:resync-required', { reason: 'backlog', generation: 1 });
    return { ok: true };
  });
  await app.listen({ port: 4183, host: '127.0.0.1' });
} catch (error) { await cleanup(); throw error; }
