import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createTestApp } from '../helpers/test-app.js';
let fixture: Awaited<ReturnType<typeof createTestApp>>;
const sockets: Socket[] = [];
beforeAll(async () => { fixture = await createTestApp(); }, 120_000);
afterAll(async () => { for (const s of sockets) s.disconnect(); await fixture?.close(); });
async function member(orgId: string, role = 'member') {
  const user = await fixture.prisma.user.create({ data: { orgId, role, email: `${randomUUID()}@test.invalid`, passwordHash: 'unused', fullName: role } });
  const { createSession } = await import('../../src/modules/auth/auth-service.js');
  const tokens = await createSession(fixture.app, user);
  const socket = io(fixture.url, { transports: ['websocket'], reconnection: false, auth: { token: tokens.accessToken } }); sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  return { user, socket, tokens };
}
async function flush() { await Promise.all(sockets.map(s => s.timeout(2000).emitWithAck('zalo:unsubscribe', { accountId: 'barrier' }))); }

it('actual SDK listener persists message before same-ID undo despite delayed profile lookup and isolates disconnected events', async () => {
  const org = await fixture.prisma.organization.create({ data: { name: 'Producer' } });
  const owner = await member(org.id, 'owner'); const denied = await member(org.id);
  const account = await fixture.prisma.zaloAccount.create({ data: { orgId: org.id, ownerUserId: owner.user.id } });
  const listener = Object.assign(new EventEmitter(), { start() {} });
  let release!: () => void; const profile = new Promise<void>(resolve => { release = resolve; });
  const { attachZaloListener } = await import('../../src/modules/zalo/zalo-listener-factory.js');
  const dispose = attachZaloListener({ accountId: account.id, orgId: org.id, io: fixture.app.io, userInfoCache: new Map(), onDisconnected() {}, api: { listener, getUserInfo: async () => { await profile; return {}; } } });
  const events: string[] = []; const deniedEvents: string[] = [];
  for (const event of ['chat:message', 'chat:deleted', 'zalo:disconnected']) { owner.socket.on(event, () => events.push(event)); denied.socket.on(event, () => deniedEvents.push(event)); }
  const deleted = new Promise<void>(resolve => owner.socket.once('chat:deleted', () => resolve()));
  try {
    listener.emit('message', { type: 0, threadId: 'contact-1', data: { msgId: 'same-id', uidFrom: 'contact-1', content: 'hello', ts: String(Date.now()) } });
    listener.emit('undo', { msgId: 'same-id', threadId: 'contact-1' });
    expect(await fixture.prisma.message.count({ where: { conversation: { zaloAccountId: account.id } } })).toBe(0);
    release(); await deleted;
    const disconnected = new Promise<void>(resolve => owner.socket.once('zalo:disconnected', () => resolve()));
    listener.emit('closed', 1000, 'test'); await disconnected; await flush();
    expect(events).toEqual(['chat:message', 'chat:deleted', 'zalo:disconnected']); expect(deniedEvents).toEqual([]);
    expect(await fixture.prisma.message.findFirst({ where: { zaloMsgId: 'same-id', conversation: { zaloAccountId: account.id } } })).toMatchObject({ isDeleted: true });
  } finally { release(); await dispose(); listener.removeAllListeners(); }
});

it('reminder batch retains same-org non-assignee visibility and excludes completed/cancelled/already-reminded/outside-window records', async () => {
  const now = new Date(2026, 8, 8, 12); const tomorrow = new Date(2026, 8, 9, 12);
  const expected: string[] = [];
  for (const name of ['reminder-A', 'reminder-B']) {
    const org = await fixture.prisma.organization.create({ data: { name } });
    const assignee = await member(org.id); const colleague = await member(org.id);
    const contact = await fixture.prisma.contact.create({ data: { orgId: org.id, fullName: name } });
    const apt = await fixture.prisma.appointment.create({ data: { orgId: org.id, contactId: contact.id, assignedUserId: assignee.user.id, appointmentDate: tomorrow } }); expected.push(apt.id);
    for (const data of [{ status: 'completed' }, { status: 'cancelled' }, { reminderSent: true }, { appointmentDate: new Date(2026, 8, 20, 12) }]) await fixture.prisma.appointment.create({ data: { orgId: org.id, contactId: contact.id, appointmentDate: tomorrow, ...data } });
    for (const person of [assignee, colleague]) { const packets: any[] = []; person.socket.on('appointment:reminder', p => packets.push(p)); (person.socket as any).reminders = { packets, id: apt.id }; }
  }
  const { runAppointmentReminders } = await import('../../src/modules/contacts/appointment-reminder.js');
  await runAppointmentReminders(fixture.app.io, now); await runAppointmentReminders(fixture.app.io, now); await flush();
  for (const socket of sockets) { const reminders = (socket as any).reminders; if (reminders) expect(reminders.packets.map((p: any) => p.appointmentId)).toEqual([reminders.id]); }
  expect(await fixture.prisma.appointment.count({ where: { id: { in: expected }, reminderSent: true } })).toBe(2);
});
