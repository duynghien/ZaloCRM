import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';
let fixture: Awaited<ReturnType<typeof createTestApp>>;
let headers: { authorization: string }; let contactId: string; let orgId: string;
beforeAll(async () => {
  fixture = await createTestApp();
  const org = await fixture.prisma.organization.create({ data: { name: 'Input fixture' } }); orgId = org.id;
  const user = await fixture.prisma.user.create({ data: { orgId, role: 'owner', fullName: 'Owner', email: `${randomUUID()}@test.invalid`, passwordHash: 'unused' } });
  contactId = (await fixture.prisma.contact.create({ data: { orgId, fullName: 'Contact' } })).id;
  const { createSession } = await import('../../src/modules/auth/auth-service.js');
  headers = { authorization: `Bearer ${(await createSession(fixture.app, user)).accessToken}` };
}, 120_000);
afterAll(async () => { await fixture?.close(); });
it.each([null, [], { totalAmount: 1 }, { contactId: {}, totalAmount: 1 }, { contactId: 'x', totalAmount: '1' }, { contactId: 'x', totalAmount: 1, status: null }, { contactId: 'x', totalAmount: 1, notes: [] }])('rejects malformed order before mutation %j', async payload => {
  const before = await fixture.prisma.order.count();
  const response = await fixture.app.inject({ method: 'POST', url: '/api/v1/orders', headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
  expect(response.statusCode).toBe(400); expect(await fixture.prisma.order.count()).toBe(before);
});
it('preserves both existing nullable order callers and distinguishes omitted notes', async () => {
  const created = await fixture.app.inject({ method: 'POST', url: '/api/v1/orders', headers, payload: { contactId, totalAmount: 100, notes: null, conversationId: null } });
  expect(created.statusCode).toBe(200); const order = created.json();
  expect(order).toMatchObject({ notes: null, conversationId: null });
  const update = (payload: unknown) => fixture.app.inject({ method: 'PUT', url: `/api/v1/orders/${order.id}`, headers, payload: payload as object });
  expect((await update({ notes: 'Keep' })).json().notes).toBe('Keep');
  expect((await update({ status: 'paid' })).json().notes).toBe('Keep');
  expect((await update({ notes: null })).json().notes).toBeNull();
  expect((await update({ conversationId: null })).statusCode).toBe(400);
});
it('rejects foreign related IDs without allocating an order code', async () => {
  const foreign = await fixture.prisma.organization.create({ data: { name: 'Foreign' } });
  const contact = await fixture.prisma.contact.create({ data: { orgId: foreign.id, fullName: 'Foreign' } });
  const before = await fixture.prisma.orderCodeCounter.findMany({ where: { orgId } });
  expect((await fixture.app.inject({ method: 'POST', url: '/api/v1/orders', headers, payload: { contactId: contact.id, totalAmount: 1 } })).statusCode).toBe(404);
  expect(await fixture.prisma.orderCodeCounter.findMany({ where: { orgId } })).toEqual(before);
});
it.each(['/api/v1/orders?page=0', '/api/v1/conversations?limit=101', '/api/v1/ai-reports?page=1.5', '/api/v1/orders/stats?from=2026-02-29', '/api/v1/orders/stats?from=2026-09-02&to=2026-09-01'])('rejects supplied invalid query %s', async url => {
  expect((await fixture.app.inject({ method: 'GET', url, headers })).statusCode).toBe(400);
});
it.each([null, [], { automation: null }, { automation: { sendZalo: 'false' } }, { automation: { emailRecipients: ['A@x.test', 'a@x.test'] } }, { smtp: { port: '587' } }, { smtp: { secure: null } }])('rejects malformed AI settings %j', async payload => {
  const before = await fixture.prisma.appSetting.count();
  expect((await fixture.app.inject({ method: 'PUT', url: '/api/v1/ai-reports/settings', headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify(payload) })).statusCode).toBe(400);
  expect(await fixture.prisma.appSetting.count()).toBe(before);
});
it('creates 50 concurrent HTTP orders with unique codes and no collision errors', async () => {
  const results = await Promise.all(Array.from({ length: 50 }, () => fixture.app.inject({ method: 'POST', url: '/api/v1/orders', headers, payload: { contactId, totalAmount: 1, notes: null } })));
  expect(results.map(response => response.statusCode)).toEqual(Array(50).fill(200));
  expect(new Set(results.map(response => response.json().orderCode)).size).toBe(50);
}, 30_000);
it('isolates order lists, contact orders, updates and deletes between two real organizations', async () => {
  const foreignOrg = await fixture.prisma.organization.create({ data: { name: 'Order isolation foreign' } });
  const foreignUser = await fixture.prisma.user.create({ data: { orgId: foreignOrg.id, role: 'owner', fullName: 'Foreign owner', email: `${randomUUID()}@test.invalid`, passwordHash: 'unused' } });
  const foreignContact = await fixture.prisma.contact.create({ data: { orgId: foreignOrg.id, fullName: 'Private foreign contact' } });
  const { createSession } = await import('../../src/modules/auth/auth-service.js');
  const foreignHeaders = { authorization: `Bearer ${(await createSession(fixture.app, foreignUser)).accessToken}` };
  const ownCreated = await fixture.app.inject({ method: 'POST', url: '/api/v1/orders', headers, payload: { contactId, totalAmount: 12 } });
  const foreignCreated = await fixture.app.inject({ method: 'POST', url: '/api/v1/orders', headers: foreignHeaders, payload: { contactId: foreignContact.id, totalAmount: 34, notes: 'Foreign private notes' } });
  expect(ownCreated.statusCode).toBe(200); expect(foreignCreated.statusCode).toBe(200);
  const own = ownCreated.json(); const foreign = foreignCreated.json();
  const ordersBeforeDeniedWrites = await fixture.prisma.order.findMany({ orderBy: { id: 'asc' } });
  for (const [actorHeaders, ownOrder, otherOrder, ownContact, otherContact] of [
    [headers, own, foreign, contactId, foreignContact.id],
    [foreignHeaders, foreign, own, foreignContact.id, contactId],
  ] as const) {
    const listed = await fixture.app.inject({ url: '/api/v1/orders?limit=100', headers: actorHeaders });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().orders.map((row: { id: string }) => row.id)).toContain(ownOrder.id);
    expect(listed.body).not.toContain(otherOrder.id);
    const filtered = await fixture.app.inject({ url: `/api/v1/orders?contactId=${otherContact}`, headers: actorHeaders });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json()).toMatchObject({ orders: [], total: 0 });
    const foreignContactOrders = await fixture.app.inject({ url: `/api/v1/contacts/${otherContact}/orders`, headers: actorHeaders });
    expect(foreignContactOrders.statusCode).toBe(200);
    expect(foreignContactOrders.json()).toEqual({ orders: [] });
    const contactOrders = await fixture.app.inject({ url: `/api/v1/contacts/${ownContact}/orders`, headers: actorHeaders });
    expect(contactOrders.statusCode).toBe(200);
    expect(contactOrders.json().orders.map((row: { id: string }) => row.id)).toContain(ownOrder.id);
    expect((await fixture.app.inject({ method: 'PUT', url: `/api/v1/orders/${otherOrder.id}`, headers: actorHeaders, payload: { notes: 'Takeover', totalAmount: 999 } })).statusCode).toBe(404);
    expect((await fixture.app.inject({ method: 'DELETE', url: `/api/v1/orders/${otherOrder.id}`, headers: actorHeaders })).statusCode).toBe(404);
  }
  expect(await fixture.prisma.order.findMany({ orderBy: { id: 'asc' } })).toEqual(ordersBeforeDeniedWrites);
  expect((await fixture.app.inject({ method: 'PUT', url: `/api/v1/orders/${own.id}`, headers, payload: { notes: 'Allowed' } })).json().notes).toBe('Allowed');
  expect((await fixture.app.inject({ method: 'DELETE', url: `/api/v1/orders/${own.id}`, headers })).statusCode).toBe(200);
  expect(await fixture.prisma.order.findUnique({ where: { id: own.id } })).toBeNull();
});
it('rejects a foreign conversation on order creation before incrementing the tenant counter', async () => {
  const other = await fixture.prisma.organization.create({ data: { name: 'Foreign conversation' } });
  const owner = await fixture.prisma.user.create({ data: { orgId: other.id, role: 'owner', fullName: 'Foreign owner', email: `${randomUUID()}@test.invalid`, passwordHash: 'unused' } });
  const account = await fixture.prisma.zaloAccount.create({ data: { orgId: other.id, ownerUserId: owner.id } });
  const conversation = await fixture.prisma.conversation.create({ data: { orgId: other.id, zaloAccountId: account.id } });
  const before = await fixture.prisma.orderCodeCounter.findMany({ where: { orgId } });
  const orders = await fixture.prisma.order.count({ where: { orgId } });
  expect((await fixture.app.inject({ method: 'POST', url: '/api/v1/orders', headers, payload: { contactId, conversationId: conversation.id, totalAmount: 1 } })).statusCode).toBe(404);
  expect(await fixture.prisma.order.count({ where: { orgId } })).toBe(orders);
  expect(await fixture.prisma.orderCodeCounter.findMany({ where: { orgId } })).toEqual(before);
});
it('rejects invalid merged automation dependencies and preserves every persisted setting', async () => {
  const where = { orgId_settingKey: { orgId, settingKey: 'ai_report_automation_settings' } };
  // Legacy stored dependencies force validation to consider the merged state, not just the patch.
  for (const [stored, patch] of [
    [{ sendZalo: true, zaloDestinationType: 'uid', zaloTargetUid: '' }, { sendEmail: false }],
    [{ sendEmail: true, emailRecipients: [] }, { sendZalo: false }],
    [{ sendZalo: false, zaloDestinationType: 'uid', zaloTargetUid: '' }, { sendZalo: true }],
    [{ sendEmail: false, emailRecipients: [] }, { sendEmail: true }],
  ]) {
    await fixture.prisma.appSetting.upsert({ where, create: { orgId, settingKey: 'ai_report_automation_settings', valuePlain: JSON.stringify(stored) }, update: { valuePlain: JSON.stringify(stored) } });
    const before = await fixture.prisma.appSetting.findMany({ where: { orgId }, orderBy: { settingKey: 'asc' } });
    const response = await fixture.app.inject({ method: 'PUT', url: '/api/v1/ai-reports/settings', headers, payload: { automation: patch, smtp: { host: 'must-not-save.test.invalid' } } });
    expect(response.statusCode).toBe(400);
    expect(await fixture.prisma.appSetting.findMany({ where: { orgId }, orderBy: { settingKey: 'asc' } })).toEqual(before);
  }
});
