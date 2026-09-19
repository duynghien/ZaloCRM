import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';

const sdk = vi.hoisted(() => ({ generateContent: vi.fn(), countTokens: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = sdk; } }));
let fixture: Awaited<ReturnType<typeof createTestApp>>;
let service: typeof import('../../src/modules/ai-reports/report-job-service.js');
let worker: typeof import('../../src/modules/ai-reports/report-job-worker.js');
beforeAll(async () => {
  process.env.GEMINI_API_KEY = 'test-provider-adapter';
  fixture = await createTestApp();
  service = await import('../../src/modules/ai-reports/report-job-service.js');
  worker = await import('../../src/modules/ai-reports/report-job-worker.js');
}, 120_000);
beforeEach(() => {
  sdk.generateContent.mockReset().mockResolvedValue({ text: 'Lifecycle summary', usageMetadata: { candidatesTokenCount: 5 } });
  sdk.countTokens.mockReset().mockResolvedValue({ totalTokens: 100 });
});
afterAll(async () => { await fixture?.close(); });
async function seed() {
  const db = fixture.prisma;
  const org = await db.organization.create({ data: { name: 'Lifecycle' } });
  const person = (role: string) => db.user.create({ data: { orgId: org.id, role, email: `${randomUUID()}@test.invalid`, fullName: role, passwordHash: 'unused' } });
  const owner = await person('owner'); const member = await person('member');
  const account = await db.zaloAccount.create({ data: { orgId: org.id, ownerUserId: owner.id, status: 'connected' } });
  const group = await db.conversation.create({ data: { orgId: org.id, zaloAccountId: account.id, externalThreadId: 'shared', threadType: 'group' } });
  await db.zaloAccountAccess.create({ data: { zaloAccountId: account.id, userId: member.id, permission: 'chat' } });
  const body = { from_date: '2026-09-01', to_date: '2026-09-02', group_targets: [{ zalo_account_id: account.id, group_thread_id: 'shared' }], title: 'Lifecycle report' };
  const request = service.normalizeReportJobRequest(body);
  const submit = (key = randomUUID(), userId = member.id) => service.submitReportJob(org.id, userId, key, request);
  const claim = async (id: string) => db.aiReportJob.update({ where: { id }, data: { status: 'running', leaseOwner: randomUUID(), leaseExpiresAt: new Date(Date.now() + 300_000) } });
  const headers = async (user = member) => {
    const { createSession } = await import('../../src/modules/auth/auth-service.js');
    return { authorization: `Bearer ${(await createSession(fixture.app, user)).accessToken}` };
  };
  return { org, owner, member, account, group, body, request, submit, claim, headers };
}

describe('persisted report job lifecycle', () => {
  it('freezes v2, replays JSONB data and rejects conflicting keys without another job', async () => {
    const s = await seed(); const key = randomUUID(); const first = await s.submit(key);
    expect(first.job.requestData).toMatchObject({ schemaVersion: 2, origin: 'on_demand', targets: [{ zaloAccountId: s.account.id, groupThreadId: 'shared', conversationId: s.group.id }] });
    const replay = await s.submit(key); expect(replay.replay).toBe(true); expect(replay.job.id).toBe(first.job.id);
    await expect(service.submitReportJob(s.org.id, s.member.id, key, { ...s.request, title: 'Changed' })).rejects.toMatchObject({ statusCode: 409 });
    expect(await fixture.prisma.aiReportJob.count({ where: { orgId: s.org.id } })).toBe(1);
  });

  it('serializes scheduled and on-demand caps in the same organization', async () => {
    const s = await seed(); await s.submit();
    await expect(s.submit()).rejects.toThrow('one active');
    const scheduled = { ...s.request, reportType: 'daily' as const };
    const results = await Promise.allSettled([
      service.submitScheduledReportJob(s.org.id, `${s.org.id}:daily:2026-09-02`, scheduled),
      s.submit(randomUUID(), s.owner.id),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(await fixture.prisma.aiReportJob.count({ where: { orgId: s.org.id, status: 'queued' } })).toBe(2);
  });

  it('never treats a deleted creator as scheduled and never re-resolves replaced sources', async () => {
    for (const change of ['creator', 'conversation']) {
      const s = await seed(); const { job } = await s.submit();
      if (change === 'creator') await fixture.prisma.user.delete({ where: { id: s.member.id } });
      else {
        await fixture.prisma.conversation.delete({ where: { id: s.group.id } });
        await fixture.prisma.conversation.create({ data: { orgId: s.org.id, zaloAccountId: s.account.id, externalThreadId: 'shared', threadType: 'group' } });
      }
      await worker.runReportJob(await s.claim(job.id));
      expect(await fixture.prisma.aiReportJob.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'failed', resultReportId: null });
    }
    expect(sdk.generateContent).not.toHaveBeenCalled();
  });

  it('creates and links one result atomically, then reuses persisted provenance on recovery', async () => {
    const s = await seed(); const { job } = await s.submit();
    await worker.runReportJob(await s.claim(job.id));
    const completed = await fixture.prisma.aiReportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(completed.status).toBe('succeeded'); expect(completed.resultReportId).toBeTruthy();
    expect(await fixture.prisma.generatedReport.count({ where: { orgId: s.org.id } })).toBe(1);
    sdk.generateContent.mockClear();
    await worker.runReportJob(await s.claim(job.id));
    expect((await fixture.prisma.aiReportJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('succeeded');
    expect(await fixture.prisma.generatedReport.count({ where: { orgId: s.org.id } })).toBe(1);
    expect(sdk.generateContent).not.toHaveBeenCalled();
  });

  it('prevents stale workers and cancellation during provider work from publishing results', async () => {
    for (const action of ['lease', 'cancel']) {
      const s = await seed(); const { job } = await s.submit(); const claimed = await s.claim(job.id);
      sdk.generateContent.mockImplementationOnce(async () => {
        await fixture.prisma.aiReportJob.update({ where: { id: job.id }, data: action === 'lease' ? { leaseOwner: 'replacement-worker' } : { cancellationRequestedAt: new Date() } });
        return { text: 'Late provider result' };
      });
      await worker.runReportJob(claimed);
      const after = await fixture.prisma.aiReportJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.resultReportId).toBeNull(); expect(after.status).toBe(action === 'lease' ? 'running' : 'cancelled');
      expect(await fixture.prisma.generatedReport.count({ where: { orgId: s.org.id } })).toBe(0);
    }
  });

  it('allows creator cancellation after revocation, keeps status minimal and protects legacy archive', async () => {
    const s = await seed(); const headers = await s.headers();
    const submitted = await fixture.app.inject({ method: 'POST', url: '/api/v1/ai-reports/generate', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: s.body });
    expect(submitted.statusCode).toBe(202); const { jobId } = submitted.json();
    await fixture.prisma.zaloAccountAccess.deleteMany({ where: { userId: s.member.id } });
    const status = await fixture.app.inject({ method: 'GET', url: `/api/v1/ai-reports/jobs/${jobId}`, headers });
    expect(status.statusCode).toBe(200);
    expect(Object.keys(status.json().job).sort()).toEqual(['cancellationRequestedAt', 'createdAt', 'errorMessage', 'finishedAt', 'id', 'resultReportId', 'status']);
    expect((await fixture.app.inject({ method: 'POST', url: `/api/v1/ai-reports/jobs/${jobId}/cancel`, headers })).statusCode).toBe(200);
    expect((await fixture.prisma.aiReportJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('cancelled');
    const report = await fixture.prisma.generatedReport.create({ data: { orgId: s.org.id, title: 'Legacy', periodFrom: new Date(s.request.fromDate), periodTo: new Date(s.request.toDate), summaryContent: 'Historical private content' } });
    expect((await fixture.app.inject({ method: 'GET', url: `/api/v1/ai-reports/${report.id}`, headers })).statusCode).toBe(404);
    const ownerHeaders = await s.headers(s.owner);
    expect((await fixture.app.inject({ method: 'GET', url: `/api/v1/ai-reports/${report.id}`, headers: ownerHeaders })).statusCode).toBe(200);
    expect((await fixture.app.inject({ method: 'POST', url: `/api/v1/ai-reports/${report.id}/resend`, headers: { ...ownerHeaders, 'idempotency-key': randomUUID() }, payload: { send_email: true } })).statusCode).toBe(404);
  });

  it('does not resurrect a job completed while the cancellation route awaits its initial read', async () => {
    const s = await seed(); const { job } = await s.submit(); const headers = await s.headers();
    const claimed = await s.claim(job.id);
    let enter!: () => void; let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const original = fixture.prisma.aiReportJob.findFirst.bind(fixture.prisma.aiReportJob);
    let held = false;
    const spy = vi.spyOn(fixture.prisma.aiReportJob, 'findFirst').mockImplementation((async (args: any) => {
      const result = await original(args);
      if (!held && args?.where?.id === job.id) { held = true; enter(); await released; }
      return result;
    }) as any);
    const cancelling = fixture.app.inject({ method: 'POST', url: `/api/v1/ai-reports/jobs/${job.id}/cancel`, headers }).then(response => response);
    try {
      await entered;
      const finishedAt = new Date();
      await fixture.prisma.aiReportJob.update({ where: { id: claimed.id }, data: { status: 'succeeded', leaseOwner: null, leaseExpiresAt: null, finishedAt } });
      release();
      expect((await cancelling).statusCode).toBe(409);
      expect(await fixture.prisma.aiReportJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'succeeded', leaseOwner: null, leaseExpiresAt: null, cancellationRequestedAt: null, finishedAt });
    } finally { release(); spy.mockRestore(); }
  });

  it('resolves an ambiguous legacy config in place and schedules only its explicit source', async () => {
    const s = await seed(); const db = fixture.prisma;
    const second = await db.zaloAccount.create({ data: { orgId: s.org.id, ownerUserId: s.owner.id } });
    await db.conversation.create({ data: { orgId: s.org.id, zaloAccountId: second.id, externalThreadId: 'shared', threadType: 'group' } });
    const legacyTargetData = { originalAccountId: null, originalThreadId: 'shared', reason: 'ambiguous' };
    const unresolved = await db.groupReportConfig.create({ data: { orgId: s.org.id, groupThreadId: 'shared', zaloAccountId: null, isEnabled: false, targetResolutionStatus: 'needs_resolution', legacyTargetData } });
    await db.appSetting.create({ data: { orgId: s.org.id, settingKey: 'ai_report_automation_settings', valuePlain: JSON.stringify({ dailyEnabled: true, sendZalo: false, sendEmail: false }) } });
    const { runScheduledOrgReports } = await import('../../src/modules/ai-reports/report-cron.js');
    await runScheduledOrgReports('daily', new Date('2026-09-07'), new Date('2026-09-08'));
    expect(await db.aiReportJob.count({ where: { orgId: s.org.id } })).toBe(0);
    const response = await fixture.app.inject({ method: 'PUT', url: '/api/v1/ai-reports/configs/shared', headers: await s.headers(s.owner), payload: { zalo_account_id: s.account.id, is_enabled: true, group_name: 'Resolved source' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().config).toMatchObject({ id: unresolved.id, zaloAccountId: s.account.id, isEnabled: true, targetResolutionStatus: 'resolved', legacyTargetData });
    expect(await db.groupReportConfig.count({ where: { orgId: s.org.id } })).toBe(1);
    await runScheduledOrgReports('daily', new Date('2026-09-07'), new Date('2026-09-08'));
    const jobs = await db.aiReportJob.findMany({ where: { orgId: s.org.id } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ createdById: null, scheduleKey: `${s.org.id}:daily:2026-09-07`, requestData: { schemaVersion: 2, origin: 'scheduled', targets: [{ zaloAccountId: s.account.id, groupThreadId: 'shared', conversationId: s.group.id }] } });
  });


  it('recovers a sent ledger into report flags without another SDK send', async () => {
    const s = await seed();
    const { job } = await service.submitReportJob(s.org.id, s.member.id, randomUUID(), { ...s.request, sendZalo: true, senderAccountId: s.account.id });
    const request = service.decodeReportJobRequest(job.requestData, null);
    const report = await fixture.prisma.generatedReport.create({ data: { orgId: s.org.id, title: 'Acknowledged report', periodFrom: new Date(request.fromDate), periodTo: new Date(request.toDate), summaryContent: 'Already delivered', targetSchemaVersion: 2, targetResolutionStatus: 'verified', sourceTargets: request.targets, sentZalo: false } });
    await fixture.prisma.aiReportJob.update({ where: { id: job.id }, data: { resultReportId: report.id } });
    await fixture.prisma.aiReportJobDispatch.updateMany({ where: { jobId: job.id, channel: 'zalo' }, data: { status: 'sent', sentParts: 1, totalParts: 1, completedAt: new Date() } });
    const { zaloPool } = await import('../../src/modules/zalo/zalo-pool.js');
    const accountLookup = vi.spyOn(zaloPool, 'getApi');
    try {
      await worker.runReportJob(await s.claim(job.id));
      expect((await fixture.prisma.generatedReport.findUniqueOrThrow({ where: { id: report.id } })).sentZalo).toBe(true);
      expect((await fixture.prisma.aiReportJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('succeeded');
      expect(accountLookup).not.toHaveBeenCalled(); expect(sdk.generateContent).not.toHaveBeenCalled();
    } finally { accountLookup.mockRestore(); }
  });

  it('honors HTTP cancellation accepted between the final guard and completion transaction', async () => {
    const s = await seed(); const { job } = await s.submit(); const headers = await s.headers();
    const request = service.decodeReportJobRequest(job.requestData, null);
    const report = await fixture.prisma.generatedReport.create({ data: { orgId: s.org.id, title: 'Persisted report', periodFrom: new Date(request.fromDate), periodTo: new Date(request.toDate), summaryContent: 'Ready', targetSchemaVersion: 2, targetResolutionStatus: 'verified', sourceTargets: request.targets } });
    await fixture.prisma.aiReportJob.update({ where: { id: job.id }, data: { resultReportId: report.id } });
    const claimed = await s.claim(job.id);
    let enter!: () => void; let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const original = fixture.prisma.$transaction.bind(fixture.prisma);
    let held = false;
    // Existing result and no dispatches means the worker's first transaction is completion.
    const spy = vi.spyOn(fixture.prisma, '$transaction').mockImplementation((async (...args: any[]) => {
      if (!held) { held = true; enter(); await released; }
      return (original as any)(...args);
    }) as any);
    const running = worker.runReportJob(claimed);
    try {
      await entered;
      const cancelling = await fixture.app.inject({ method: 'POST', url: `/api/v1/ai-reports/jobs/${job.id}/cancel`, headers });
      expect(cancelling.statusCode).toBe(200);
      release(); await running;
      expect(await fixture.prisma.aiReportJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'cancelled', resultReportId: report.id, leaseOwner: null });
    } finally { release(); await running; spy.mockRestore(); }
  });

  it('rejects report job submission when sender account is disconnected', async () => {
    const s = await seed();
    const disconnected = await fixture.prisma.zaloAccount.create({ data: { orgId: s.org.id, ownerUserId: s.owner.id, status: 'disconnected' } });
    await fixture.prisma.zaloAccountAccess.create({ data: { zaloAccountId: disconnected.id, userId: s.member.id, permission: 'chat' } });
    await expect(service.submitReportJob(s.org.id, s.member.id, randomUUID(), { ...s.request, sendZalo: true, senderAccountId: disconnected.id })).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('mất kết nối'),
    });
  });

});
