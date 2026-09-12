import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createTestApp } from '../helpers/test-app.js';

let fixture: Awaited<ReturnType<typeof createTestApp>>;
const clients: Socket[] = [];
beforeAll(async () => { fixture = await createTestApp(); }, 120_000);
afterEach(() => { for (const client of clients.splice(0)) client.disconnect(); });
afterAll(async () => { await fixture?.close(); });

async function identity() {
  const org = await fixture.prisma.organization.create({ data: { name: 'Session fixture' } });
  return fixture.prisma.user.create({ data: {
    orgId: org.id, email: `${randomUUID()}@test.invalid`, fullName: 'Owner', role: 'owner', passwordHash: 'unused',
  } });
}

async function connect(token: string) {
  const client = io(fixture.url, { auth: { token }, transports: ['websocket'], reconnection: false });
  clients.push(client);
  await new Promise<void>((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
  });
  return client;
}

it('disconnects an idle socket at JWT expiry while its persisted refresh session remains valid', async () => {
  const user = await identity();
  const { createSession } = await import('../../src/modules/auth/auth-service.js');
  const tokens = await createSession(fixture.app, user);
  const sessionId = tokens.refreshToken.split('.')[0];
  const token = fixture.app.jwt.sign({ id: user.id, orgId: user.orgId, role: user.role, email: user.email, sessionId }, { expiresIn: 2 });
  const client = await connect(token);
  const disconnected = new Promise<string>(resolve => client.once('disconnect', resolve));
  expect(await disconnected).toBe('io server disconnect');
  expect(client.connected).toBe(false);
  const session = await fixture.prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } });
  expect(session.revokedAt).toBeNull();
  expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
});

it('rotation disconnects the old socket and replay revokes the replacement family', async () => {
  const user = await identity();
  const { createSession, rotateSession } = await import('../../src/modules/auth/auth-service.js');
  const original = await createSession(fixture.app, user);
  const oldClient = await connect(original.accessToken);
  const oldDisconnected = new Promise<void>(resolve => oldClient.once('disconnect', () => resolve()));
  const rotated = await rotateSession(fixture.app, original.refreshToken);
  await oldDisconnected;
  const replacement = await connect(rotated.tokens.accessToken);
  const replacementDisconnected = new Promise<void>(resolve => replacement.once('disconnect', () => resolve()));
  await expect(rotateSession(fixture.app, original.refreshToken)).rejects.toThrow('Invalid refresh session');
  await replacementDisconnected;
  expect(await fixture.prisma.authSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
});

it('notifies exactly the revoked user sessions and unregistering one listener preserves the others', async () => {
  const user = await identity();
  const { createSession, registerSessionRevocationListener, revokeUserSessions } = await import('../../src/modules/auth/auth-service.js');
  const first = await createSession(fixture.app, user);
  const second = await createSession(fixture.app, user);
  const unrelated = await createSession(fixture.app, await identity());
  const client = await connect(first.accessToken);
  const disconnected = new Promise<void>(resolve => client.once('disconnect', () => resolve()));
  const removed: string[] = []; const retained: string[] = [];
  const removeFirst = registerSessionRevocationListener(ids => removed.push(...ids));
  const removeSecond = registerSessionRevocationListener(ids => retained.push(...ids));
  removeFirst();
  try {
    await revokeUserSessions(user.id, 'test-user-revocation');
    await disconnected;
    expect(removed).toEqual([]);
    expect(retained.sort()).toEqual([first, second].map(item => item.refreshToken.split('.')[0]).sort());
    expect(await fixture.prisma.authSession.findUnique({ where: { id: unrelated.refreshToken.split('.')[0] } })).toMatchObject({ revokedAt: null });
  } finally { removeSecond(); }
});


it.each(['demotion', 'deactivation', 'password-reset'])('HTTP %s disconnects every old target socket before returning success', async action => {
  const owner = await identity();
  const target = await fixture.prisma.user.create({ data: {
    orgId: owner.orgId, email: `${randomUUID()}@test.invalid`, fullName: 'Admin', role: 'admin', passwordHash: 'unused',
  } });
  const { createSession } = await import('../../src/modules/auth/auth-service.js');
  const ownerTokens = await createSession(fixture.app, owner);
  const tokens = await createSession(fixture.app, target);
  const client = await connect(tokens.accessToken);
  const disconnected = new Promise<void>(resolve => client.once('disconnect', () => resolve()));
  const response = await fixture.app.inject({ method: 'PUT',
    url: `/api/v1/users/${target.id}${action === 'password-reset' ? '/password' : ''}`,
    headers: { authorization: `Bearer ${ownerTokens.accessToken}` },
    payload: action === 'demotion' ? { role: 'member' } : action === 'deactivation' ? { isActive: false } : { password: 'Changed-password-2026!' },
  });
  expect(response.statusCode).toBe(200);
  await disconnected;
  expect((await fixture.app.inject({ method: 'GET', url: '/api/v1/profile', headers: { authorization: `Bearer ${tokens.accessToken}` } })).statusCode).toBe(401);
});

it.each(['logout', 'logout-all'])('HTTP %s revokes the intended sessions and removes their live sockets', async action => {
  const user = await identity();
  const { createSession } = await import('../../src/modules/auth/auth-service.js');
  const tokens = await createSession(fixture.app, user);
  const another = await createSession(fixture.app, user);
  const client = await connect(tokens.accessToken);
  const otherClient = await connect(another.accessToken);
  const disconnected = new Promise<void>(resolve => client.once('disconnect', () => resolve()));
  const allDisconnected = action === 'logout-all' ? new Promise<void>(resolve => otherClient.once('disconnect', () => resolve())) : Promise.resolve();
  const response = await fixture.app.inject({ method: 'POST', url: `/api/v1/auth/${action}`, headers: {
    authorization: `Bearer ${tokens.accessToken}`, origin: 'http://127.0.0.1:3000',
    cookie: 'zalo_crm_csrf=fixture-csrf', 'x-csrf-token': 'fixture-csrf',
  } });
  expect(response.statusCode).toBe(200);
  await Promise.all([disconnected, allDisconnected]);
  expect(await fixture.prisma.authSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(action === 'logout' ? 1 : 0);
  if (action === 'logout') {
    expect(otherClient.connected).toBe(true);
    expect(await otherClient.timeout(2000).emitWithAck('zalo:unsubscribe', { accountId: 'transport-barrier' })).toEqual({ ok: true });
  }
});
