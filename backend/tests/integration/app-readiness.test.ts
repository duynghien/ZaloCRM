import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { createTestApp } from '../helpers/test-app.js';

it('reports ready with migrated PostgreSQL and 503 after the real database becomes unavailable', async () => {
  const fixture = await createTestApp();
  let socket: Socket | undefined;
  try {
    const org = await fixture.prisma.organization.create({ data: { name: 'Database failure fixture' } });
    const user = await fixture.prisma.user.create({ data: { orgId: org.id, email: `${randomUUID()}@test.invalid`, fullName: 'Owner', role: 'owner', passwordHash: 'unused' } });
    const account = await fixture.prisma.zaloAccount.create({ data: { orgId: org.id, ownerUserId: user.id } });
    const { createSession } = await import('../../src/modules/auth/auth-service.js');
    const tokens = await createSession(fixture.app, user);
    socket = io(fixture.url, { transports: ['websocket'], reconnection: false, auth: { token: tokens.accessToken } });
    await new Promise<void>((resolve, reject) => { socket!.once('connect', resolve); socket!.once('connect_error', reject); });
    const packets: unknown[] = [];
    socket.on('chat:message', packet => packets.push(packet));
    socket.on('appointment:reminder', packet => packets.push(packet));
    const ready = await fixture.app.inject({ method: 'GET', url: '/health' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'ok', db: 'connected' });
    const [migration] = await fixture.prisma.$queryRaw<Array<{ id: string; checksum: string }>>`SELECT id, checksum FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 1`;
    await fixture.prisma.$executeRaw`UPDATE _prisma_migrations SET checksum='incompatible-fixture' WHERE id=${migration.id}`;
    const incompatible = await fixture.app.inject({ method: 'GET', url: '/health' });
    expect(incompatible.statusCode).toBe(503); expect(incompatible.json()).toMatchObject({ db: 'connected', schema: 'incompatible' });
    await fixture.prisma.$executeRaw`UPDATE _prisma_migrations SET checksum=${migration.checksum} WHERE id=${migration.id}`;
    expect((await fixture.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    // Disconnect this owned pool before stopping its container so no idle error event is orphaned.
    await fixture.prisma.$disconnect();
    await fixture.stopDatabase();
    const unavailable = await fixture.app.inject({ method: 'GET', url: '/health' });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({ status: 'error', db: 'disconnected' });
    const { emitAccountEvent, emitOrganizationEvent } = await import('../../src/shared/realtime/socket-event-delivery.js');
    await emitAccountEvent(fixture.app.io, account.id, 'chat:message', { secret: 'fixture-only' });
    await emitOrganizationEvent(fixture.app.io, org.id, 'appointment:reminder', { secret: 'fixture-only' });
    await socket.timeout(2000).emitWithAck('zalo:unsubscribe', { accountId: 'transport-barrier' });
    expect(packets).toEqual([]);
  } finally { socket?.disconnect(); await fixture.close(); }
}, 120_000);
