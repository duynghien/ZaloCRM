import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';

const { Zalo } = createRequire(import.meta.url)('zca-js');
let fixture: Awaited<ReturnType<typeof createTestApp>>;
let pool: typeof import('../../src/modules/zalo/zalo-pool.js').zaloPool;
let sender: typeof import('../../src/modules/ai-reports/zalo-report-sender.js');
beforeAll(async () => {
  fixture = await createTestApp();
  pool = (await import('../../src/modules/zalo/zalo-pool.js')).zaloPool;
  pool.setIO(fixture.app.io);
  sender = await import('../../src/modules/ai-reports/zalo-report-sender.js');
}, 120_000);
afterEach(async () => { pool?.disconnectAll(); await pool?.drain(); vi.restoreAllMocks(); });
afterAll(async () => { await fixture?.close(); });

async function setup() {
  const org = await fixture.prisma.organization.create({ data: { name: 'Sender guards' } });
  const user = await fixture.prisma.user.create({ data: { orgId: org.id, role: 'member', email: `${randomUUID()}@test.invalid`, fullName: 'Sender', passwordHash: 'unused' } });
  const account = await fixture.prisma.zaloAccount.create({ data: { orgId: org.id, ownerUserId: user.id } });
  const api = {
    listener: Object.assign(new EventEmitter(), { start: vi.fn(), stop: vi.fn() }),
    getOwnId: async () => account.id, getUserInfo: async () => ({}),
    sendMessage: vi.fn(async () => ({})),
  };
  vi.spyOn(Zalo.prototype, 'login').mockResolvedValue(api);
  await pool.reconnect(account.id, { cookie: [], imei: 'test-imei', userAgent: 'test-agent' });
  const options = { accountId: account.id, orgId: org.id, destinationType: 'uid' as const, targetUid: 'recipient', markdownContent: 'x'.repeat(3000), executionGuard: async () => {} };
  return { account, org, user, api, options };
}

it.each(['cancelled', 'source_grant_revoked', 'lease_lost'])('stops all later parts when the live guard rejects %s after the first part', async (reason) => {
  const s = await setup();
  let reject!: () => void;
  const changed = new Promise<void>(resolve => { reject = resolve; });
  let checks = 0;
  const result = await sender.sendReportToZalo({ ...s.options,
    executionGuard: async () => { if (++checks > 1) { await changed; throw new Error(reason); } },
    onPartSent: async () => { reject(); },
  });
  expect(result).toEqual({ success: false, partsSent: 1, totalParts: 2, deliveryUncertain: false, error: reason });
  expect(s.api.sendMessage).toHaveBeenCalledOnce();
  expect(checks).toBe(2);
});

it('rechecks database sender tenancy after pacing, without using another connected account', async () => {
  const s = await setup();
  const foreign = await fixture.prisma.organization.create({ data: { name: 'Foreign' } });
  const result = await sender.sendReportToZalo({ ...s.options, onPartSent: async () => {
    await fixture.prisma.zaloAccount.update({ where: { id: s.account.id }, data: { orgId: foreign.id } });
  } });
  expect(result).toMatchObject({ success: false, partsSent: 1, totalParts: 2, deliveryUncertain: false, error: 'report_sender_unavailable' });
  expect(s.api.sendMessage).toHaveBeenCalledOnce();
});

it('rejects a wrong-org or offline selected sender even when another sender is connected', async () => {
  const s = await setup();
  const other = await fixture.prisma.zaloAccount.create({ data: { orgId: s.org.id, ownerUserId: s.user.id } });
  for (const overrides of [{ orgId: randomUUID() }, { accountId: other.id }, { accountId: '' }]) {
    const result = await sender.sendReportToZalo({ ...s.options, ...overrides });
    expect(result).toMatchObject({ success: false, partsSent: 0, deliveryUncertain: false });
  }
  expect(s.api.sendMessage).not.toHaveBeenCalled();
});

it('detects a disconnect inside the asynchronous guard before the SDK call', async () => {
  const s = await setup();
  const result = await sender.sendReportToZalo({ ...s.options, executionGuard: async () => { pool.disconnect(s.account.id); } });
  expect(result).toMatchObject({ success: false, partsSent: 0, deliveryUncertain: false, error: 'report_sender_unavailable' });
  expect(s.api.sendMessage).not.toHaveBeenCalled();
});

it('uses the replacement current pool API for the next part', async () => {
  const s = await setup();
  const replacement = { ...s.api, sendMessage: vi.fn(async () => ({})) };
  const result = await sender.sendReportToZalo({ ...s.options, onPartSent: async (count) => {
    if (count !== 1) return;
    vi.mocked(Zalo.prototype.login).mockResolvedValue(replacement);
    await pool.reconnect(s.account.id, { cookie: [], imei: 'test-imei', userAgent: 'test-agent' });
  } });
  expect(result).toEqual({ success: true, partsSent: 2, totalParts: 2, deliveryUncertain: false });
  expect(s.api.sendMessage).toHaveBeenCalledOnce();
  expect(replacement.sendMessage).toHaveBeenCalledOnce();
});

it.each(['provider', 'ledger'])('reports uncertainty and acknowledged part counts after a %s failure', async (failure) => {
  const s = await setup();
  if (failure === 'provider') s.api.sendMessage.mockRejectedValue(new Error('provider_failed'));
  const result = await sender.sendReportToZalo({ ...s.options,
    onPartSent: async () => { throw new Error('ledger_failed'); },
  });
  expect(result).toMatchObject({ success: false, partsSent: failure === 'provider' ? 0 : 1, totalParts: 2, deliveryUncertain: true, error: `${failure}_failed` });
  expect(s.api.sendMessage).toHaveBeenCalledOnce();
});

it('keeps numbered chunks within 2500 UTF-16 units without losing huge paragraphs or emoji', () => {
  for (const markdown of ['x'.repeat(300_000), '🙂'.repeat(5000), 'paragraph\n\n'.repeat(5000)]) {
    const parts = sender.splitReportForZalo(markdown);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every(part => part.length <= 2500)).toBe(true);
    expect(parts.map(part => part.replace(/^📋 \[BÁO CÁO ĐIỀU HÀNH - PHẦN \d+\/\d+\]\n\n/, '')).join('')).toBe(markdown);
    expect(parts.every(part => !/[\uD800-\uDBFF]$/.test(part))).toBe(true);
  }
});

it('stops at the next guard after a real source chat grant is revoked at the part ledger barrier', async () => {
  const s = await setup();
  const { authorizeReportTargets } = await import('../../src/modules/ai-reports/report-target-service.js');
  const conversation = await fixture.prisma.conversation.create({ data: {
    orgId: s.org.id, zaloAccountId: s.account.id, externalThreadId: 'source-group', threadType: 'group',
  } });
  const grant = await fixture.prisma.zaloAccountAccess.create({ data: { userId: s.user.id, zaloAccountId: s.account.id, permission: 'chat' } });
  const targets = [{ zaloAccountId: s.account.id, groupThreadId: 'source-group', conversationId: conversation.id }];
  let atFirstPart!: () => void; let release!: () => void;
  const firstPart = new Promise<void>(resolve => { atFirstPart = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const pending = sender.sendReportToZalo({ ...s.options,
    executionGuard: async () => {
      if (!await authorizeReportTargets(s.org.id, targets, s.user, 'chat')) throw new Error('report_source_access_revoked');
    },
    onPartSent: async (count) => { if (count === 1) { atFirstPart(); await barrier; } },
  });
  await firstPart;
  try { await fixture.prisma.zaloAccountAccess.delete({ where: { id: grant.id } }); }
  finally { release(); }
  expect(await pending).toMatchObject({ success: false, partsSent: 1, deliveryUncertain: false, error: 'report_source_access_revoked' });
  expect(s.api.sendMessage).toHaveBeenCalledOnce();
});
