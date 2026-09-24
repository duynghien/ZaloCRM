import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';

let fixture: Awaited<ReturnType<typeof createTestApp>>;
let orgId: string;
let contactId: string;
let accountId: string;
let foreignContactId: string;
let foreignAccountId: string;
const key = randomUUID();
const headers = { 'x-api-key': key };

beforeAll(async () => {
  fixture = await createTestApp();
  const db = fixture.prisma;
  const org = await db.organization.create({ data: { name: 'Public validation' } });
  orgId = org.id;
  const hashedKey = createHash('sha256').update(key).digest('hex');
  await db.appSetting.create({ data: { orgId, settingKey: 'public_api_key_hash', valuePlain: hashedKey } });
  await db.appSetting.create({ data: { orgId, settingKey: 'public_api_key_prefix', valuePlain: key.slice(0, 10) } });
  contactId = (await db.contact.create({ data: { orgId, fullName: 'Contact' } })).id;
  const owner = await db.user.create({ data: { orgId, email: `${randomUUID()}@test.invalid`, fullName: 'Owner', passwordHash: 'unused', role: 'owner' } });
  accountId = (await db.zaloAccount.create({ data: { orgId, ownerUserId: owner.id, status: 'connected' } })).id;
  const foreign = await db.organization.create({ data: { name: 'Foreign' } });
  foreignContactId = (await db.contact.create({ data: { orgId: foreign.id } })).id;
  const foreignOwner = await db.user.create({ data: { orgId: foreign.id, email: `${randomUUID()}@test.invalid`, fullName: 'Owner', passwordHash: 'unused', role: 'owner' } });
  foreignAccountId = (await db.zaloAccount.create({ data: { orgId: foreign.id, ownerUserId: foreignOwner.id, status: 'connected' } })).id;
}, 120_000);
afterAll(async () => { await fixture?.close(); });

const post = (url: string, payload: unknown, extraHeaders?: Record<string, string>) =>
  fixture.app.inject({
    method: 'POST',
    url,
    headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...extraHeaders },
    payload: JSON.stringify(payload),
  });

describe('public request boundaries against PostgreSQL', () => {
  it('rejects malformed contacts before inserts or updates, preserving nullable clears', async () => {
    const before = await fixture.prisma.contact.count({ where: { orgId } });
    for (const payload of [null, [], {}, { fullName: 42 }, { fullName: {} }, { fullName: 'A', tags: {} }, { fullName: 'A', tags: [1] }, { phone: '1', status: 'invalid' }, { fullName: 'x'.repeat(256) }]) {
      expect((await post('/api/public/contacts', payload)).statusCode).toBe(400);
    }
    expect(await fixture.prisma.contact.count({ where: { orgId } })).toBe(before);
    for (const payload of [null, [], { fullName: false }, { tags: null }, { notes: {} }]) {
      expect((await fixture.app.inject({ method: 'PUT', url: `/api/public/contacts/${contactId}`, headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify(payload) })).statusCode).toBe(400);
    }
    expect((await fixture.prisma.contact.findUniqueOrThrow({ where: { id: contactId } })).fullName).toBe('Contact');
    expect((await post('/api/public/contacts', { fullName: 'Valid', notes: null, tags: ['lead'], status: 'new' })).statusCode).toBe(201);
    const clear = await fixture.app.inject({ method: 'PUT', url: `/api/public/contacts/${contactId}`, headers, payload: { notes: null, email: null } });
    expect(clear.statusCode).toBe(200);
  });

  it('rejects impossible calendar dates and reversed ranges while accepting leap dates and instants', async () => {
    const before = await fixture.prisma.appointment.count({ where: { orgId } });
    for (const appointmentDate of ['2025-02-29', '2024-02-30', '2024-13-01', '2024-01-01T10:00:00', '', null, 1, {}]) {
      expect((await post('/api/public/appointments', { contactId, appointmentDate })).statusCode).toBe(400);
    }
    expect(await fixture.prisma.appointment.count({ where: { orgId } })).toBe(before);
    for (const appointmentDate of ['2024-02-29', '2024-02-29T10:30:00+07:00']) {
      const response = await post('/api/public/appointments', { contactId, appointmentDate, notes: null });
      expect(response.statusCode).toBe(201);
      expect(response.json().appointmentDate).toBe(new Date(appointmentDate).toISOString());
    }
    for (const query of ['from=2024-03-01&to=2024-02-29', 'from=', 'from=2024-02-30', 'from=2024-02-29&from=2024-03-01']) {
      expect((await fixture.app.inject({ url: `/api/public/appointments?${query}`, headers })).statusCode).toBe(400);
    }
  });

  it('keeps bounds strict and public message limit 200', async () => {
    const conversation = await fixture.prisma.conversation.create({ data: { orgId, zaloAccountId: accountId, externalThreadId: 'limit' } });
    for (const route of ['/api/public/contacts', '/api/public/conversations', `/api/public/conversations/${conversation.id}/messages`]) {
      for (const query of ['limit=0', 'limit=-1', 'limit=1.5', 'limit=', 'limit=nope', 'limit=999999', 'limit=1&limit=2']) {
        expect((await fixture.app.inject({ url: `${route}?${query}`, headers })).statusCode).toBe(400);
      }
      expect((await fixture.app.inject({ url: route, headers })).statusCode).toBe(200);
    }
    expect((await fixture.app.inject({ url: `/api/public/conversations/${conversation.id}/messages?limit=200`, headers })).statusCode).toBe(200);
    expect((await fixture.app.inject({ url: '/api/public/contacts/%20invalid', headers })).statusCode).toBe(400);
    // The production router rejects oversized URL parameters before route validation.
    expect([400, 414]).toContain((await fixture.app.inject({ url: `/api/public/contacts/${'x'.repeat(129)}`, headers })).statusCode);
  });

  it('rejects malformed sends before SDK calls and preserves auth and tenant 404s', async () => {
    const { zaloPool } = await import('../../src/modules/zalo/zalo-pool.js');
    const sendMessage = vi.fn().mockResolvedValue({});
    vi.spyOn(zaloPool, 'getInstance').mockReturnValue({ api: { sendMessage } } as never);
    vi.spyOn(zaloPool, 'getApi').mockReturnValue({ sendMessage } as never);
    const valid = { zaloAccountId: accountId, threadId: 'thread', content: 'hello' };

    // Missing Idempotency-Key header is rejected with 400
    expect(
      (
        await fixture.app.inject({
          method: 'POST',
          url: '/api/public/messages/send',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: JSON.stringify(valid),
        })
      ).statusCode
    ).toBe(400);

    // Invalid Idempotency-Key headers (spaces, empty, invalid chars) are rejected with 400
    for (const badKey of ['', '   ', 'key with space', 'invalid@char', 'x'.repeat(257)]) {
      expect(
        (
          await fixture.app.inject({
            method: 'POST',
            url: '/api/public/messages/send',
            headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': badKey },
            payload: JSON.stringify(valid),
          })
        ).statusCode
      ).toBe(400);
    }

    for (const payload of [null, [], { ...valid, content: 1 }, { ...valid, content: {} }, { ...valid, content: null }, { ...valid, threadType: true }, { ...valid, threadType: 'bad' }, { ...valid, zaloAccountId: {} }, { ...valid, threadId: 'x'.repeat(129) }]) {
      expect((await post('/api/public/messages/send', payload)).statusCode).toBe(400);
    }
    expect(sendMessage).not.toHaveBeenCalled();
    expect((await post('/api/public/messages/send', { ...valid, zaloAccountId: foreignAccountId })).statusCode).toBe(404);
    expect((await post('/api/public/appointments', { contactId: foreignContactId, appointmentDate: '2024-01-01' })).statusCode).toBe(404);
    expect((await fixture.app.inject({ method: 'PUT', url: `/api/public/contacts/${foreignContactId}`, headers, payload: { notes: 'cross org' } })).statusCode).toBe(404);
    expect((await fixture.app.inject({ url: '/api/public/contacts' })).statusCode).toBe(401);
    expect((await post('/api/public/messages/send', { ...valid, threadType: 'group' })).statusCode).toBe(200);
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({ msg: 'hello' }, 'thread', 1);
  });
});
