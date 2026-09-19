import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import nodemailer from 'nodemailer';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';

const { Zalo } = createRequire(import.meta.url)('zca-js');
let fixture: Awaited<ReturnType<typeof createTestApp>>;
let pool: typeof import('../../src/modules/zalo/zalo-pool.js').zaloPool;
let resendReport: typeof import('../../src/modules/ai-reports/report-resend-service.js').resendReport;
beforeAll(async () => {
  fixture = await createTestApp();
  pool = (await import('../../src/modules/zalo/zalo-pool.js')).zaloPool;
  pool.setIO(fixture.app.io);
  resendReport = (await import('../../src/modules/ai-reports/report-resend-service.js')).resendReport;
}, 120_000);
afterEach(async () => { pool?.disconnectAll(); await pool?.drain(); vi.restoreAllMocks(); });
afterAll(async () => { await fixture?.close(); });

async function setup(content = 'archived report') {
  const org = await fixture.prisma.organization.create({ data: { name: 'Resend lifecycle' } });
  const user = await fixture.prisma.user.create({ data: { orgId: org.id, role: 'member', email: `${randomUUID()}@test.invalid`, fullName: 'Reporter', passwordHash: 'unused' } });
  const account = await fixture.prisma.zaloAccount.create({ data: { orgId: org.id, ownerUserId: user.id } });
  const source = await fixture.prisma.zaloAccount.create({ data: { orgId: org.id, ownerUserId: user.id } });
  const sourceGrant = await fixture.prisma.zaloAccountAccess.create({ data: { userId: user.id, zaloAccountId: source.id, permission: 'chat' } });
  await fixture.prisma.zaloAccountAccess.create({ data: { userId: user.id, zaloAccountId: account.id, permission: 'chat' } });
  const conversation = await fixture.prisma.conversation.create({ data: { orgId: org.id, zaloAccountId: source.id, externalThreadId: 'group', threadType: 'group' } });
  const report = await fixture.prisma.generatedReport.create({ data: {
    orgId: org.id, createdById: user.id, title: 'Archive', periodFrom: new Date('2026-09-01'), periodTo: new Date('2026-09-01'), summaryContent: content,
    targetSchemaVersion: 2, targetResolutionStatus: 'verified', sourceTargets: [{ zaloAccountId: source.id, groupThreadId: 'group', conversationId: conversation.id }],
  } });
  const api = {
    listener: Object.assign(new EventEmitter(), { start: vi.fn(), stop: vi.fn() }),
    getOwnId: async () => account.id, getUserInfo: async () => ({}), sendMessage: vi.fn(async () => ({})),
  };
  vi.spyOn(Zalo.prototype, 'login').mockResolvedValue(api);
  await pool.reconnect(account.id, { cookie: [], imei: 'test-imei', userAgent: 'test-agent' });
  const body = { send_zalo: true, zalo_account_id: account.id, zalo_destination_type: 'uid', zalo_target_uid: 'recipient', zalo_delivery_mode: 'full_text' };
  return { org, user, account, sourceGrant, report, api, body, key: randomUUID() };
}

it('replays the same key without another SDK call and rejects conflicting payload with 409', async () => {
  const s = await setup();
  const first = await resendReport(s.user, s.report, s.body, s.key);
  const replay = await resendReport(s.user, s.report, s.body, s.key);
  expect(first).toMatchObject({ success: true, replay: false, zalo: { success: true, partsSent: 1, totalParts: 1 } });
  expect(replay).toMatchObject({ ...first, replay: true });
  await expect(resendReport(s.user, s.report, { ...s.body, zalo_target_uid: 'different' }, s.key)).rejects.toMatchObject({ statusCode: 409 });
  expect(s.api.sendMessage).toHaveBeenCalledOnce();
  expect(await fixture.prisma.aiReportResend.count({ where: { reportId: s.report.id } })).toBe(1);
  expect(await fixture.prisma.aiReportResendDispatch.count({ where: { resendId: first.resendId } })).toBe(1);
});

it.each(['source_revoked', 'cancelled', 'lease_expired', 'dispatch_lease_expired'])('stops after the acknowledged first part when %s changes during pacing', async (change) => {
  const s = await setup('x'.repeat(3000));
  const pending = resendReport(s.user, s.report, s.body, s.key);
  let attemptId = '';
  // Observe the real persisted acknowledgment before modifying state during pacing.
  await vi.waitFor(async () => {
    const row = await fixture.prisma.aiReportResendDispatch.findFirst({ where: { resend: { reportId: s.report.id }, sentParts: 1 } });
    expect(row).not.toBeNull(); attemptId = row!.resendId;
  }, { interval: 10, timeout: 1500 });
  if (change === 'source_revoked') await fixture.prisma.zaloAccountAccess.delete({ where: { id: s.sourceGrant.id } });
  else if (change === 'dispatch_lease_expired') await fixture.prisma.aiReportResendDispatch.updateMany({ where: { resendId: attemptId }, data: { leaseExpiresAt: new Date(0) } });
  else await fixture.prisma.aiReportResend.update({ where: { id: attemptId }, data: change === 'cancelled' ? { status: 'cancelled' } : { leaseExpiresAt: new Date(0) } });
  const result = await pending;
  expect(result).toMatchObject({ success: false, zalo: { success: false, partsSent: 1, totalParts: 2 } });
  expect(s.api.sendMessage).toHaveBeenCalledOnce();
  const dispatch = await fixture.prisma.aiReportResendDispatch.findUniqueOrThrow({ where: { resendId_channel: { resendId: attemptId, channel: 'zalo' } } });
  expect(dispatch.sentParts).toBe(1);
  expect(['partial', 'uncertain']).toContain(dispatch.status);
  expect(await fixture.prisma.generatedReport.findUniqueOrThrow({ where: { id: s.report.id } })).toMatchObject({ sentZalo: false });
});

it('persists provider uncertainty and a same-key replay never retries the send', async () => {
  const s = await setup();
  s.api.sendMessage.mockRejectedValue(new Error('provider connection lost after request'));
  const result = await resendReport(s.user, s.report, s.body, s.key);
  expect(result).toMatchObject({ success: false, zalo: { success: false, partsSent: 0, deliveryUncertain: true } });
  const replay = await resendReport(s.user, s.report, s.body, s.key);
  expect(replay).toMatchObject({ ...result, replay: true });
  expect(s.api.sendMessage).toHaveBeenCalledOnce();
  expect(await fixture.prisma.aiReportResendDispatch.findUniqueOrThrow({ where: { resendId_channel: { resendId: result.resendId, channel: 'zalo' } } })).toMatchObject({ status: 'uncertain', deliveryUncertain: true });
});

it('sends an email-only resend through its current guard once and replays without delivery', async () => {
  const s = await setup();
  const sendMail = vi.fn(async () => ({ messageId: 'fixture-mail' }));
  vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
  await fixture.prisma.appSetting.create({ data: { orgId: s.org.id, settingKey: 'ai_report_smtp_config', valuePlain: JSON.stringify({ host: 'smtp.test.invalid', port: 587, auth: { user: 'test', pass: 'fixture' } }) } });
  const body = { send_email: true, email_recipients: [s.user.email] };
  const result = await resendReport(s.user, s.report, body, s.key);
  expect(result).toMatchObject({ success: true, zalo: null, email: { success: true, partsSent: 1, totalParts: 1 } });
  expect(await resendReport(s.user, s.report, body, s.key)).toMatchObject({ ...result, replay: true });
  expect(sendMail).toHaveBeenCalledOnce();
  expect(s.api.sendMessage).not.toHaveBeenCalled();
});

it('email adapter checks current source access immediately before sendMail', async () => {
  const s = await setup();
  const { sendReportEmail } = await import('../../src/modules/ai-reports/email-service.js');
  const { authorizeReportTargets, decodeReportTargets } = await import('../../src/modules/ai-reports/report-target-service.js');
  const sendMail = vi.fn(async () => ({ messageId: 'must-not-send' }));
  let revocation: Promise<unknown>;
  vi.spyOn(nodemailer, 'createTransport').mockImplementation(() => {
    revocation = fixture.prisma.zaloAccountAccess.delete({ where: { id: s.sourceGrant.id } });
    return { sendMail } as never;
  });
  const result = await sendReportEmail({ orgId: s.org.id, toEmail: s.user.email, reportTitle: s.report.title, markdownContent: s.report.summaryContent,
    smtpConfig: { host: 'smtp.test.invalid', port: 587, auth: { user: 'fixture', pass: 'fixture' } },
    executionGuard: async () => {
      await revocation;
      if (!await authorizeReportTargets(s.org.id, decodeReportTargets(s.report.sourceTargets), s.user, 'chat')) throw new Error('source_access_revoked');
    },
  });
  expect(result).toMatchObject({ success: false, error: 'source_access_revoked' });
  expect(sendMail).not.toHaveBeenCalled();
});

it('rejects resend when sender account is disconnected', async () => {
  const s = await setup();
  await fixture.prisma.zaloAccount.update({ where: { id: s.account.id }, data: { status: 'disconnected' } });
  await expect(resendReport(s.user, s.report, s.body, randomUUID())).rejects.toMatchObject({
    statusCode: 400,
    message: expect.stringContaining('mất kết nối'),
  });
});
