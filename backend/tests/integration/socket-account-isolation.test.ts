import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createTestApp } from '../helpers/test-app.js';

let fixture: Awaited<ReturnType<typeof createTestApp>>;
let emit: typeof import('../../src/shared/realtime/socket-event-delivery.js').emitAccountEvent;
const clients: Socket[] = [];
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
async function person(orgId: string, role = 'member') {
  const user = await fixture.prisma.user.create({ data: { orgId, role, email: `${randomUUID()}@test.invalid`, fullName: role, passwordHash: 'unused' } });
  const { createSession } = await import('../../src/modules/auth/auth-service.js');
  const tokens = await createSession(fixture.app, user);
  const socket = io(fixture.url, { auth: { token: tokens.accessToken }, transports: ['websocket'], reconnection: false });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  return { user, tokens, socket, sessionId: tokens.refreshToken.split('.')[0] };
}
async function seed() {
  const a = await fixture.prisma.organization.create({ data: { name: 'A' } });
  const b = await fixture.prisma.organization.create({ data: { name: 'B' } });
  const owner = await person(a.id, 'owner'); const admin = await person(a.id, 'admin');
  const reader = await person(a.id); const other = await person(a.id); const none = await person(a.id); const foreign = await person(b.id, 'owner');
  const account = await fixture.prisma.zaloAccount.create({ data: { orgId: a.id, ownerUserId: owner.user.id } });
  const second = await fixture.prisma.zaloAccount.create({ data: { orgId: a.id, ownerUserId: owner.user.id } });
  const foreignAccount = await fixture.prisma.zaloAccount.create({ data: { orgId: b.id, ownerUserId: foreign.user.id } });
  const grant = await fixture.prisma.zaloAccountAccess.create({ data: { userId: reader.user.id, zaloAccountId: account.id, permission: 'admin' } });
  await fixture.prisma.zaloAccountAccess.create({ data: { userId: other.user.id, zaloAccountId: second.id, permission: 'read' } });
  return { owner, admin, reader, other, none, foreign, account, second, foreignAccount, grant };
}
const ack = (socket: Socket, event: string, accountId: string) => socket.timeout(2000).emitWithAck(event, { accountId });
async function flush() { await Promise.all(clients.filter(c => c.connected).map(c => ack(c, 'zalo:unsubscribe', 'transport-barrier'))); }
const collect = (socket: Socket, event: string) => { const values: unknown[] = []; socket.on(event, value => values.push(value)); return values; };
async function mutate(s: Awaited<ReturnType<typeof seed>>, method: 'DELETE' | 'PUT', permission?: string) {
  const response = await fixture.app.inject({ method, url: `/api/v1/zalo-accounts/${s.account.id}/access/${s.grant.id}`, headers: { authorization: `Bearer ${s.owner.tokens.accessToken}` }, ...(permission ? { payload: { permission } } : {}) });
  expect(response.statusCode).toBe(method === 'DELETE' ? 204 : 200);
}

beforeAll(async () => { fixture = await createTestApp(); emit = (await import('../../src/shared/realtime/socket-event-delivery.js')).emitAccountEvent; }, 120_000);
afterEach(() => { vi.restoreAllMocks(); for (const socket of clients.splice(0)) socket.disconnect(); });
afterAll(async () => { await fixture?.close(); });

describe('production socket account authorization with PostgreSQL', () => {
  it('checks current ACL without subscriptions, including forged rooms and symmetric tenants', async () => {
    const s = await seed(); const people = [s.owner, s.admin, s.reader, s.other, s.none, s.foreign];
    const seen = people.map(p => collect(p.socket, 'chat:message'));
    await fixture.app.io.sockets.sockets.get(s.foreign.socket.id!)!.join(`org:${s.owner.user.orgId}`);
    for (const account of [s.account, s.second, s.foreignAccount]) await emit(fixture.app.io, account.id, 'chat:message', { accountId: account.id });
    await flush();
    expect(seen.map(values => values.length)).toEqual([2, 2, 1, 1, 0, 1]);
    expect(seen[2]).toEqual([{ accountId: s.account.id }]);
    expect(seen[5]).toEqual([{ accountId: s.foreignAccount.id }]);
  });

  it('keeps unaffected owner delivery while revoke invalidates a held real ACL result', async () => {
    const s = await seed(); const owner = collect(s.owner.socket, 'chat:message'); const reader = collect(s.reader.socket, 'chat:message');
    const entered = deferred(); const release = deferred(); const original = fixture.prisma.zaloAccountAccess.findFirst.bind(fixture.prisma.zaloAccountAccess);
    let held = false;
    vi.spyOn(fixture.prisma.zaloAccountAccess, 'findFirst').mockImplementation((async (args: any) => {
      const result = await original(args);
      if (!held && args.where.userId === s.reader.user.id) { held = true; entered.resolve(); await release.promise; }
      return result;
    }) as any);
    const delivery = emit(fixture.app.io, s.account.id, 'chat:message', { id: 'held' });
    await entered.promise;
    try { await mutate(s, 'DELETE'); } finally { release.resolve(); }
    await delivery; await emit(fixture.app.io, s.account.id, 'chat:message', { id: 'after-204' }); await flush();
    expect(reader).toEqual([]); expect(owner).toEqual([{ id: 'held' }, { id: 'after-204' }]);
  });

  it('requires QR admin ack, cancels intent on unsubscribe and downgrade while retaining reads', async () => {
    const s = await seed(); const qr = collect(s.reader.socket, 'zalo:qr'); const messages = collect(s.reader.socket, 'chat:message');
    await emit(fixture.app.io, s.account.id, 'zalo:qr', { qr: 'before' });
    expect(await ack(s.reader.socket, 'zalo:subscribe', s.account.id)).toEqual({ ok: true });
    expect((await ack(s.other.socket, 'zalo:subscribe', s.account.id)).ok).toBe(false);
    expect((await ack(s.foreign.socket, 'zalo:subscribe', s.account.id)).ok).toBe(false);
    await emit(fixture.app.io, s.account.id, 'zalo:qr', { qr: 'allowed' });
    await ack(s.reader.socket, 'zalo:unsubscribe', s.account.id);
    await emit(fixture.app.io, s.account.id, 'zalo:qr', { qr: 'cancelled' });
    await ack(s.reader.socket, 'zalo:subscribe', s.account.id); await mutate(s, 'PUT', 'read');
    await emit(fixture.app.io, s.account.id, 'zalo:qr', { qr: 'downgraded' });
    await emit(fixture.app.io, s.account.id, 'chat:message', { id: 'read-remains' }); await flush();
    expect(qr).toEqual([{ qr: 'allowed' }]); expect(messages).toEqual([{ id: 'read-remains' }]);
    expect((await ack(s.reader.socket, 'zalo:subscribe', s.account.id)).ok).toBe(false);
  });

  it('cannot restore subscription after unsubscribe or HTTP downgrade during a real pending ACL read', async () => {
    for (const action of ['unsubscribe', 'downgrade', 'delete']) {
      const s = await seed(); const entered = deferred(); const release = deferred();
      const original = fixture.prisma.zaloAccountAccess.findFirst.bind(fixture.prisma.zaloAccountAccess); let held = false;
      const spy = vi.spyOn(fixture.prisma.zaloAccountAccess, 'findFirst').mockImplementation((async (args: any) => {
        const result = await original(args);
        if (!held && args.where.userId === s.reader.user.id) { held = true; entered.resolve(); await release.promise; }
        return result;
      }) as any);
      const subscribing = ack(s.reader.socket, 'zalo:subscribe', s.account.id); await entered.promise;
      try {
        if (action === 'unsubscribe') await ack(s.reader.socket, 'zalo:unsubscribe', s.account.id);
        else if (action === 'downgrade') await mutate(s, 'PUT', 'read');
        else expect((await fixture.app.inject({ method: 'DELETE', url: `/api/v1/zalo-accounts/${s.account.id}`, headers: { authorization: `Bearer ${s.owner.tokens.accessToken}` } })).statusCode).toBe(204);
      } finally { release.resolve(); }
      expect((await subscribing).ok).toBe(false); spy.mockRestore();
      const packets = collect(s.reader.socket, 'zalo:qr'); await emit(fixture.app.io, s.account.id, 'zalo:qr', { secret: true }); await flush(); expect(packets).toEqual([]);
    }
  });

  it('rejects a handshake whose real persisted session read completes after revocation', async () => {
    const s = await seed(); const entered = deferred(); const release = deferred();
    const original = fixture.prisma.authSession.findFirst.bind(fixture.prisma.authSession); let held = false;
    vi.spyOn(fixture.prisma.authSession, 'findFirst').mockImplementation((async (args: any) => {
      const result = await original(args);
      if (!held && args.where.id === s.reader.sessionId) { held = true; entered.resolve(); await release.promise; }
      return result;
    }) as any);
    const candidate = io(fixture.url, { auth: { token: s.reader.tokens.accessToken }, transports: ['websocket'], reconnection: false }); clients.push(candidate);
    const rejected = new Promise<void>((resolve, reject) => { candidate.once('connect_error', () => resolve()); candidate.once('connect', () => reject(new Error('Revoked pending handshake connected'))); });
    await entered.promise;
    try { const { revokeSession } = await import('../../src/modules/auth/auth-service.js'); await revokeSession(s.reader.sessionId, 'pending-handshake-test'); }
    finally { release.resolve(); }
    await rejected; expect(candidate.connected).toBe(false);
  });

  it('denies idle expired DB sessions and revoked handshakes', async () => {
    const s = await seed(); const seen = collect(s.reader.socket, 'chat:message');
    await fixture.prisma.authSession.update({ where: { id: s.reader.sessionId }, data: { expiresAt: new Date(0) } });
    await emit(fixture.app.io, s.account.id, 'chat:message', { secret: true }); await flush(); expect(seen).toEqual([]);
    const { revokeSession } = await import('../../src/modules/auth/auth-service.js');
    await revokeSession(s.other.sessionId, 'test');
    const rejected = io(fixture.url, { auth: { token: s.other.tokens.accessToken }, transports: ['websocket'], reconnection: false }); clients.push(rejected);
    await new Promise<void>((resolve, reject) => { rejected.once('connect_error', () => resolve()); rejected.once('connect', () => reject(new Error('Revoked session connected'))); });
    expect(rejected.connected).toBe(false);
  });

  it('bounds overflow and delivers the latest QR snapshot plus content-free recovery only to authorized clients', async () => {
    const s = await seed(); await ack(s.reader.socket, 'zalo:subscribe', s.account.id);
    const qr = collect(s.reader.socket, 'zalo:qr'); const recovery = collect(s.reader.socket, 'realtime:resync-required'); const denied = collect(s.none.socket, 'realtime:resync-required');
    const entered = deferred(); const release = deferred(); const original = fixture.prisma.zaloAccount.findUnique.bind(fixture.prisma.zaloAccount); let held = false;
    vi.spyOn(fixture.prisma.zaloAccount, 'findUnique').mockImplementation((async (args: any) => { const result = await original(args); if (!held && args.where.id === s.account.id) { held = true; entered.resolve(); await release.promise; } return result; }) as any);
    const first = emit(fixture.app.io, s.account.id, 'chat:message', { id: 'first' }); await entered.promise;
    const queued = Array.from({ length: 99 }, (_, id) => emit(fixture.app.io, s.account.id, 'chat:message', { id }));
    await emit(fixture.app.io, s.account.id, 'zalo:qr', { qr: 'old' }); await emit(fixture.app.io, s.account.id, 'zalo:qr', { qr: 'latest' });
    release.resolve(); await Promise.all([first, ...queued]); await flush();
    expect(qr).toEqual([{ qr: 'latest' }]); expect(recovery.length).toBeGreaterThan(0); expect(recovery.length).toBeLessThanOrEqual(2); expect(denied).toEqual([]);
    for (const packet of recovery) expect(Object.keys(packet as object).sort()).toEqual(['generation', 'reason']);
  }, 30_000);

  it('measures current authorization fanout without a positive permission cache', async () => {
    const s = await seed();
    for (let index = 0; index < 14; index++) {
      const extra = await person(s.owner.user.orgId);
      await fixture.prisma.zaloAccountAccess.create({ data: { userId: extra.user.id, zaloAccountId: s.account.id, permission: 'read' } });
    }
    const sessionReads = vi.spyOn(fixture.prisma.authSession, 'findFirst');
    const accountReads = vi.spyOn(fixture.prisma.zaloAccount, 'findFirst');
    const grantReads = vi.spyOn(fixture.prisma.zaloAccountAccess, 'findFirst');
    const start = performance.now();
    await emit(fixture.app.io, s.account.id, 'chat:message', { id: 'measurement' });
    const durationMs = Math.round(performance.now() - start);
    expect(sessionReads.mock.calls.length).toBe(19);
    expect(accountReads.mock.calls.length).toBe(19);
    expect(grantReads.mock.calls.length).toBe(17);
    const { logger } = await import('../../src/shared/utils/logger.js');
    logger.info(`[realtime-test] 19 candidates: ${durationMs}ms, 56 DB reads including account lookup; no cached grant`);
  });


  it('deleted or missing account never falls back to global delivery, including a held lookup', async () => {
    const s = await seed(); const packets = collect(s.owner.socket, 'chat:message');
    const entered = deferred(); const release = deferred();
    const original = fixture.prisma.zaloAccount.findUnique.bind(fixture.prisma.zaloAccount); let held = false;
    vi.spyOn(fixture.prisma.zaloAccount, 'findUnique').mockImplementation((async (args: any) => {
      const result = await original(args);
      if (!held && args.where.id === s.account.id) { held = true; entered.resolve(); await release.promise; }
      return result;
    }) as any);
    const delivery = emit(fixture.app.io, s.account.id, 'chat:message', { id: 'pending-delete' });
    await entered.promise;
    try {
      const response = await fixture.app.inject({ method: 'DELETE', url: `/api/v1/zalo-accounts/${s.account.id}`, headers: { authorization: `Bearer ${s.owner.tokens.accessToken}` } });
      expect(response.statusCode).toBe(204);
    } finally { release.resolve(); }
    await delivery; await emit(fixture.app.io, randomUUID(), 'chat:message', { id: 'missing' }); await flush();
    expect(packets).toEqual([]);
  });

  it('a newly granted reader receives data without reconnecting or subscribing', async () => {
    const s = await seed(); const packets = collect(s.none.socket, 'chat:message'); const socketId = s.none.socket.id;
    const response = await fixture.app.inject({ method: 'POST', url: `/api/v1/zalo-accounts/${s.account.id}/access`, headers: { authorization: `Bearer ${s.owner.tokens.accessToken}` }, payload: { userId: s.none.user.id, permission: 'read' } });
    expect(response.statusCode).toBe(201);
    await emit(fixture.app.io, s.account.id, 'chat:message', { id: 'new-grant' }); await flush();
    expect(packets).toEqual([{ id: 'new-grant' }]); expect(s.none.socket.id).toBe(socketId);
  });


  it('drops QR delivery held across an HTTP admin downgrade', async () => {
    const s = await seed(); await ack(s.reader.socket, 'zalo:subscribe', s.account.id);
    const packets = collect(s.reader.socket, 'zalo:qr');
    const entered = deferred(); const release = deferred();
    const original = fixture.prisma.zaloAccountAccess.findFirst.bind(fixture.prisma.zaloAccountAccess); let held = false;
    vi.spyOn(fixture.prisma.zaloAccountAccess, 'findFirst').mockImplementation((async (args: any) => {
      const result = await original(args);
      if (!held && args.where.userId === s.reader.user.id) { held = true; entered.resolve(); await release.promise; }
      return result;
    }) as any);
    const delivery = emit(fixture.app.io, s.account.id, 'zalo:qr', { secret: 'pending-qr' });
    await entered.promise;
    try { await mutate(s, 'PUT', 'read'); } finally { release.resolve(); }
    await delivery; await flush(); expect(packets).toEqual([]);
  });

  it.each(['account', 'organization'])('revocation fences a pending %s event session validation', async scope => {
    const s = await seed(); const event = scope === 'account' ? 'chat:message' : 'appointment:reminder';
    const packets = collect(s.reader.socket, event);
    const entered = deferred(); const release = deferred();
    const original = fixture.prisma.authSession.findFirst.bind(fixture.prisma.authSession); let held = false;
    vi.spyOn(fixture.prisma.authSession, 'findFirst').mockImplementation((async (args: any) => {
      const result = await original(args);
      if (!held && args.where.id === s.reader.sessionId) { held = true; entered.resolve(); await release.promise; }
      return result;
    }) as any);
    const { emitOrganizationEvent } = await import('../../src/shared/realtime/socket-event-delivery.js');
    const delivery = scope === 'account'
      ? emit(fixture.app.io, s.account.id, event, { secret: 'pending-session' })
      : emitOrganizationEvent(fixture.app.io, s.owner.user.orgId, event, { secret: 'pending-session' });
    await entered.promise;
    const disconnected = new Promise<void>(resolve => s.reader.socket.once('disconnect', () => resolve()));
    try { const { revokeSession } = await import('../../src/modules/auth/auth-service.js'); await revokeSession(s.reader.sessionId, 'delivery-revocation'); }
    finally { release.resolve(); }
    await delivery; await disconnected; await flush(); expect(packets).toEqual([]);
  });

});
