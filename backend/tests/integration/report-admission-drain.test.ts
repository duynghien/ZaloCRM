import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';
const sdk = vi.hoisted(() => ({ countTokens: vi.fn(), generateContent: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = sdk; } }));
let fixture: Awaited<ReturnType<typeof createTestApp>>;
let admission: typeof import('../../src/modules/ai-reports/report-admission.js');
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
beforeAll(async () => { process.env.GEMINI_API_KEY = 'fixture-provider'; fixture = await createTestApp(); admission = await import('../../src/modules/ai-reports/report-admission.js'); }, 120_000);
afterEach(() => { vi.restoreAllMocks(); admission.openReportAdmission(); });
afterAll(async () => { await fixture?.close(); });
async function seed() {
  const org = await fixture.prisma.organization.create({ data: { name: 'Admission' } });
  const owner = await fixture.prisma.user.create({ data: { orgId: org.id, role: 'owner', email: `${randomUUID()}@test.invalid`, fullName: 'Owner', passwordHash: 'unused' } });
  const account = await fixture.prisma.zaloAccount.create({ data: { orgId: org.id, ownerUserId: owner.id } });
  await fixture.prisma.conversation.create({ data: { orgId: org.id, zaloAccountId: account.id, externalThreadId: 'group', threadType: 'group' } });
  await fixture.prisma.appSetting.create({ data: { orgId: org.id, settingKey: 'ai_report_automation_settings', valuePlain: JSON.stringify({ dailyEnabled: true, sendZalo: false, sendEmail: false }) } });
  return { org, owner, account };
}
it('waits for an in-flight cron callback and rejects late enqueue after closing admission', async () => {
  const s = await seed(); const entered = deferred(); const release = deferred();
  const original = fixture.prisma.appSetting.findUnique.bind(fixture.prisma.appSetting);
  let held = false;
  vi.spyOn(fixture.prisma.appSetting, 'findUnique').mockImplementation((async (args: any) => {
    const result = await original(args);
    if (!held && args.where.orgId_settingKey.orgId === s.org.id) { held = true; entered.resolve(); await release.promise; }
    return result;
  }) as any);
  const { runScheduledOrgReports, stopReportCronJobs } = await import('../../src/modules/ai-reports/report-cron.js');
  const callback = runScheduledOrgReports('daily', new Date('2026-09-01'), new Date('2026-09-02'));
  await entered.promise; admission.closeReportAdmission();
  let drained = false; const drain = stopReportCronJobs().then(() => { drained = true; });
  await expect(admission.drainReportProducers(10)).rejects.toThrow('abort cutover');
  expect(drained).toBe(false);
  release.resolve(); await callback; await drain;
  expect(await fixture.prisma.aiReportJob.count({ where: { orgId: s.org.id } })).toBe(0);
  const service = await import('../../src/modules/ai-reports/report-job-service.js');
  const request = service.normalizeReportJobRequest({ from_date: '2026-09-01', to_date: '2026-09-02', group_targets: [{ zalo_account_id: s.account.id, group_thread_id: 'group' }] });
  await expect(service.submitReportJob(s.org.id, s.owner.id, randomUUID(), request)).rejects.toThrow('admission is closed');
  await expect(service.submitScheduledReportJob(s.org.id, `${s.org.id}:daily:2026-09-01`, { ...request, reportType: 'daily' })).rejects.toThrow('admission is closed');
});
it('waits for a pending configuration request and prevents its write after closure', async () => {
  const s = await seed(); const entered = deferred(); const release = deferred();
  const original = fixture.prisma.conversation.findMany.bind(fixture.prisma.conversation);
  let held = false;
  vi.spyOn(fixture.prisma.conversation, 'findMany').mockImplementation((async (args: any) => {
    const result = await original(args);
    if (!held && args.where.orgId === s.org.id) { held = true; entered.resolve(); await release.promise; }
    return result;
  }) as any);
  const { createSession } = await import('../../src/modules/auth/auth-service.js');
  const session = await createSession(fixture.app, s.owner);
  const updating = fixture.app.inject({ method: 'PUT', url: '/api/v1/ai-reports/configs/group', headers: { authorization: `Bearer ${session.accessToken}` }, payload: { zalo_account_id: s.account.id, is_enabled: true } }).then(response => response);
  await entered.promise; admission.closeReportAdmission();
  await expect(admission.drainReportProducers(10)).rejects.toThrow('abort cutover');
  release.resolve(); expect((await updating).statusCode).toBe(503);
  await admission.drainReportProducers();
  expect(await fixture.prisma.groupReportConfig.count({ where: { orgId: s.org.id } })).toBe(0);
});

it('worker stop awaits its actual in-flight provider and timeout prevents a cutover', async () => {
  const s = await seed(); const entered = deferred(); const release = deferred();
  sdk.countTokens.mockResolvedValue({ totalTokens: 10 });
  sdk.generateContent.mockImplementation(async () => { entered.resolve(); await release.promise; return { text: 'Drained report' }; });
  const service = await import('../../src/modules/ai-reports/report-job-service.js');
  const worker = await import('../../src/modules/ai-reports/report-job-worker.js');
  const request = service.normalizeReportJobRequest({ from_date: '2026-09-01', to_date: '2026-09-02', group_targets: [{ zalo_account_id: s.account.id, group_thread_id: 'group' }] });
  const { job } = await service.submitReportJob(s.org.id, s.owner.id, randomUUID(), request);
  const processing = worker.processOneReportJob(); await entered.promise;
  admission.closeReportAdmission();
  await expect(worker.stopReportJobWorker(10)).rejects.toThrow('abort cutover');
  expect((await fixture.prisma.aiReportJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('running');
  release.resolve(); await processing; await worker.stopReportJobWorker();
  expect((await fixture.prisma.aiReportJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('succeeded');
  expect(await worker.claimNextReportJob()).toBeNull();
});
