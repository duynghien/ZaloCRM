import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createTestApp } from '../helpers/test-app.js';

const { Zalo } = createRequire(import.meta.url)('zca-js');
let fixture: Awaited<ReturnType<typeof createTestApp>>;
let pool: typeof import('../../src/modules/zalo/zalo-pool.js').zaloPool;
const clients: Socket[] = [];
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
beforeAll(async () => { fixture = await createTestApp(); pool = (await import('../../src/modules/zalo/zalo-pool.js')).zaloPool; pool.setIO(fixture.app.io); }, 120_000);
afterEach(async () => { pool.disconnectAll(); await pool.drain(); vi.restoreAllMocks(); for (const socket of clients.splice(0)) socket.disconnect(); });
afterAll(async () => { await fixture?.close(); });
async function person(orgId: string, role = 'member') {
  const user = await fixture.prisma.user.create({ data: { orgId, role, email: `${randomUUID()}@test.invalid`, fullName: role, passwordHash: 'unused' } });
  const { createSession } = await import('../../src/modules/auth/auth-service.js');
  const tokens = await createSession(fixture.app, user);
  const socket = io(fixture.url, { auth: { token: tokens.accessToken }, transports: ['websocket'], reconnection: false }); clients.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  return { user, tokens, socket };
}
async function seed() {
  const org = await fixture.prisma.organization.create({ data: { name: 'Pool A' } });
  const foreignOrg = await fixture.prisma.organization.create({ data: { name: 'Pool B' } });
  const owner = await person(org.id, 'owner'); const reader = await person(org.id); const denied = await person(org.id); const foreign = await person(foreignOrg.id, 'owner');
  const account = await fixture.prisma.zaloAccount.create({ data: { orgId: org.id, ownerUserId: owner.user.id } });
  await fixture.prisma.zaloAccountAccess.create({ data: { zaloAccountId: account.id, userId: reader.user.id, permission: 'read' } });
  return { account, owner, reader, denied, foreign };
}
function provider() {
  const listener = Object.assign(new EventEmitter(), { start: vi.fn(), stop: vi.fn() });
  return { listener, getOwnId: async () => randomUUID(), getUserInfo: async () => ({}), sendMessage: vi.fn(async () => ({})) };
}
const ack = (socket: Socket, event: string, accountId: string) => socket.timeout(3000).emitWithAck(event, { accountId });
async function flush() { await Promise.all(clients.map(socket => ack(socket, 'zalo:unsubscribe', 'barrier'))); }
function packets(socket: Socket) { const seen: Array<{ event: string; payload: any }> = []; socket.onAny((event, payload) => seen.push({ event, payload })); return seen; }
const credentials = { cookie: [], imei: 'test-imei', userAgent: 'test-agent' };

it('real QR login emits ordered QR lifecycle to acknowledged admins and connected status to read clients', async () => {
  const s = await seed(); const people = [s.owner, s.reader, s.denied, s.foreign]; const seen = people.map(p => packets(p.socket));
  expect(await ack(s.owner.socket, 'zalo:subscribe', s.account.id)).toEqual({ ok: true });
  expect((await ack(s.reader.socket, 'zalo:subscribe', s.account.id)).ok).toBe(false);
  expect((await ack(s.foreign.socket, 'zalo:subscribe', s.account.id)).ok).toBe(false);
  const api = provider(); const retry = vi.fn();
  vi.spyOn(Zalo.prototype, 'loginQR').mockImplementation(async (_options: unknown, callback: any) => {
    callback({ type: 0, data: { image: 'private-qr' } });
    callback({ type: 1, actions: { retry } });
    callback({ type: 2, data: { display_name: 'Scanned', avatar: 'avatar' } });
    return api;
  });
  await pool.loginQR(s.account.id); await flush();
  expect(seen[0].map(p => p.event)).toEqual(['zalo:qr', 'zalo:qr-expired', 'zalo:scanned', 'zalo:connected', 'zalo:status-changed']);
  expect(seen[1].map(p => p.event)).toEqual(['zalo:connected', 'zalo:status-changed']); expect(seen[2]).toEqual([]); expect(seen[3]).toEqual([]);
  expect(retry).toHaveBeenCalledOnce(); expect(api.listener.start).toHaveBeenCalledOnce();
  expect(await fixture.prisma.zaloAccount.findUnique({ where: { id: s.account.id } })).toMatchObject({ status: 'connected' });
});

it('real QR failure and reconnect failure/success honor read ACL with their existing payloads', async () => {
  const s = await seed(); const seen = [s.owner, s.reader, s.denied, s.foreign].map(p => packets(p.socket));
  vi.spyOn(Zalo.prototype, 'loginQR').mockRejectedValue(new Error('provider-qr-failed'));
  await expect(pool.loginQR(s.account.id)).rejects.toThrow('provider-qr-failed');
  const login = vi.spyOn(Zalo.prototype, 'login').mockRejectedValueOnce(new Error('provider-reconnect-failed')).mockResolvedValue(provider());
  await pool.reconnect(s.account.id, credentials); await pool.reconnect(s.account.id, credentials); await flush();
  for (const permitted of seen.slice(0, 2)) {
    expect(permitted.map(p => p.event)).toEqual(['zalo:status-changed', 'zalo:error', 'zalo:status-changed', 'zalo:reconnect-failed', 'zalo:connected', 'zalo:status-changed']);
    expect(permitted.find(p => p.event === 'zalo:error')?.payload).toMatchObject({ accountId: s.account.id, error: 'Error: provider-qr-failed' });
  }
  expect(seen[2]).toEqual([]); expect(seen[3]).toEqual([]); expect(login).toHaveBeenCalledTimes(2);
});

it('real REST send persists then emits only to readers and rejects read-only writes before calling the SDK', async () => {
  const s = await seed(); const api = provider(); vi.spyOn(Zalo.prototype, 'login').mockResolvedValue(api);
  await pool.reconnect(s.account.id, credentials);
  const conversation = await fixture.prisma.conversation.create({ data: { orgId: s.owner.user.orgId, zaloAccountId: s.account.id, externalThreadId: 'recipient' } });
  const seen = [s.owner, s.reader, s.denied, s.foreign].map(p => packets(p.socket));
  const url = `/api/v1/conversations/${conversation.id}/messages`;
  const allowed = await fixture.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${s.owner.tokens.accessToken}` }, payload: { content: 'real REST message' } });
  expect(allowed.statusCode).toBe(200);
  const rejected = await fixture.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${s.reader.tokens.accessToken}` }, payload: { content: 'denied write' } });
  expect(rejected.statusCode).toBe(403); await flush();
  expect(api.sendMessage).toHaveBeenCalledExactlyOnceWith({ msg: 'real REST message' }, 'recipient', 0);
  expect(seen.map(p => p.filter(v => v.event === 'chat:message').length)).toEqual([1, 1, 0, 0]);
  expect(await fixture.prisma.message.findUnique({ where: { id: allowed.json().id } })).toMatchObject({ content: 'real REST message' });
});

it('disconnect and HTTP delete cancel login/reconnect during their first real database lookup', async () => {
  const qr = vi.spyOn(Zalo.prototype, 'loginQR').mockResolvedValue(provider()); const login = vi.spyOn(Zalo.prototype, 'login').mockResolvedValue(provider());
  for (const mode of ['qr', 'reconnect']) for (const cancellation of ['disconnect', 'delete']) {
    const s = await seed(); const entered = deferred(); const release = deferred();
    const original = fixture.prisma.zaloAccount.findUnique.bind(fixture.prisma.zaloAccount); let held = false;
    const lookup = vi.spyOn(fixture.prisma.zaloAccount, 'findUnique').mockImplementation((async (args: any) => {
      const result = await original(args);
      if (!held && args.where.id === s.account.id) { held = true; entered.resolve(); await release.promise; }
      return result;
    }) as any);
    const pending = mode === 'qr' ? pool.loginQR(s.account.id) : pool.reconnect(s.account.id, credentials); await entered.promise;
    try {
      if (cancellation === 'disconnect') pool.disconnect(s.account.id);
      else {
        const response = await fixture.app.inject({ method: 'DELETE', url: `/api/v1/zalo-accounts/${s.account.id}`, headers: { authorization: `Bearer ${s.owner.tokens.accessToken}` } });
        expect(response.statusCode).toBe(204);
      }
    } finally { release.resolve(); }
    await pending; lookup.mockRestore(); expect(pool.getInstance(s.account.id)).toBeUndefined();
  }
  expect(qr).not.toHaveBeenCalled(); expect(login).not.toHaveBeenCalled();
});

it('disconnect clears the scheduled reconnect and stale provider close callbacks cannot schedule another', async () => {
  const s = await seed(); const api = provider(); const login = vi.spyOn(Zalo.prototype, 'login').mockResolvedValue(api);
  await pool.reconnect(s.account.id, credentials);
  const schedule = vi.spyOn(globalThis, 'setTimeout'); const cancel = vi.spyOn(globalThis, 'clearTimeout');
  const disconnected = new Promise<void>(resolve => s.owner.socket.once('zalo:disconnected', () => resolve()));
  api.listener.emit('closed', 1000, 'provider-close'); await disconnected;
  const index = schedule.mock.calls.findIndex(call => call[1] === 30_000); expect(index).toBeGreaterThanOrEqual(0);
  const timer = schedule.mock.results[index].value;
  pool.disconnect(s.account.id); expect(cancel).toHaveBeenCalledWith(timer);
  const scheduledBefore = schedule.mock.calls.filter(call => call[1] === 30_000).length;
  api.listener.emit('closed', 1000, 'stale-close'); await flush();
  expect(schedule.mock.calls.filter(call => call[1] === 30_000)).toHaveLength(scheduledBefore);
  expect(pool.getInstance(s.account.id)).toBeUndefined(); expect(api.listener.stop).toHaveBeenCalledOnce(); expect(login).toHaveBeenCalledOnce();
});
