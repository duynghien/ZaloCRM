import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDisposablePostgres, migrateDisposablePostgres, seedBackendTestEnv } from '../helpers/disposable-postgres.js';

const sdk = vi.hoisted(() => ({ countTokens: vi.fn(), generateContent: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = sdk; } }));
let database: Awaited<ReturnType<typeof startDisposablePostgres>>;
let db: typeof import('../../src/shared/database/prisma-client.js').prisma;
let budgets: typeof import('../../src/modules/ai-reports/report-job-budget.js');
let client: typeof import('../../src/modules/ai-reports/ai-client.js');
let summarizer: typeof import('../../src/modules/ai-reports/summarizer-service.js');
let config: typeof import('../../src/config/index.js').config;
beforeAll(async () => {
  database = await startDisposablePostgres(); seedBackendTestEnv(database.databaseUrl);
  process.env.GEMINI_API_KEY = 'fixture-provider-boundary';
  await migrateDisposablePostgres(database.databaseUrl);
  db = (await import('../../src/shared/database/prisma-client.js')).prisma;
  budgets = await import('../../src/modules/ai-reports/report-job-budget.js');
  client = await import('../../src/modules/ai-reports/ai-client.js');
  summarizer = await import('../../src/modules/ai-reports/summarizer-service.js');
  config = (await import('../../src/config/index.js')).config;
}, 120_000);
afterAll(async () => { await db?.$disconnect(); await database?.stop(); });
beforeEach(() => { sdk.countTokens.mockReset().mockResolvedValue({ totalTokens: 100 }); sdk.generateContent.mockReset().mockResolvedValue({ text: 'summary' }); });
async function seed() {
  const org = await db.organization.create({ data: { name: 'Budget fixture' } });
  const job = await db.aiReportJob.create({ data: { orgId: org.id, idempotencyKey: randomUUID(), requestData: {}, status: 'running', leaseOwner: 'first', leaseExpiresAt: new Date(Date.now() + 60_000) } });
  const guard = async () => {};
  return { org, job, guard, budget: budgets.createReportJobBudget(job.id, 'first', guard) };
}

describe('persisted report budget with real PostgreSQL and provider boundary', () => {
  it('charges uncertain reservations across recovery and bounds output to the remaining budget', async () => {
    const s = await seed();
    const reservation = await s.budget.reserve(config.aiReportMaxTokens - 10, 20);
    expect(reservation.maxOutputTokens).toBe(10);
    await db.aiReportJob.update({ where: { id: s.job.id }, data: { leaseOwner: 'second' } });
    const recovered = budgets.createReportJobBudget(s.job.id, 'second', s.guard);
    await expect(recovered.reserve(1, 1)).rejects.toThrow('token budget');
    await expect(s.budget.complete(reservation.attemptKey, {})).rejects.toThrow('lease lost');
    expect((await db.aiReportBudgetReservation.findMany({ where: { jobId: s.job.id } }))[0].outcome).toBe('reserved');
  });
  it('serializes concurrent reservations and rejects cancelled/expired leases', async () => {
    const s = await seed();
    const results = await Promise.allSettled([s.budget.reserve(config.aiReportMaxTokens - 1, 1), s.budget.reserve(config.aiReportMaxTokens - 1, 1)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    for (const data of [{ cancellationRequestedAt: new Date() }, { cancellationRequestedAt: null, leaseExpiresAt: new Date(0) }]) {
      await db.aiReportJob.update({ where: { id: s.job.id }, data });
      await expect(s.budget.reserve(1, 1)).rejects.toThrow('lease lost');
    }
  });
  it('counts actual system + attachment content and fails closed without a generation attempt', async () => {
    const s = await seed();
    sdk.countTokens.mockResolvedValueOnce({ totalTokens: config.aiReportMaxTokens });
    const prompt = [{ text: 'attachment-expanded-text'.repeat(1000) }];
    await expect(client.generateContent(prompt, { budget: s.budget, executionGuard: s.guard, systemInstruction: 'system context' })).rejects.toThrow('token budget');
    expect(sdk.countTokens.mock.calls[0][0].contents).toEqual([{ text: 'system context' }, ...prompt]);
    expect(sdk.generateContent).not.toHaveBeenCalled();
    sdk.countTokens.mockRejectedValueOnce(new Error('count offline'));
    await expect(client.generateContent('hello', { budget: s.budget, executionGuard: s.guard })).rejects.toThrow('token count unavailable');
    expect(sdk.generateContent).not.toHaveBeenCalled();
  });
  it('charges provider retries and stops the next attempt on exhaustion', async () => {
    const s = await seed();
    sdk.countTokens.mockResolvedValue({ totalTokens: config.aiReportMaxTokens - 1 });
    sdk.generateContent.mockRejectedValueOnce(new Error('uncertain provider timeout'));
    await expect(client.generateContent('hello', { budget: s.budget, executionGuard: s.guard })).rejects.toThrow('token budget');
    expect(sdk.generateContent).toHaveBeenCalledTimes(1);
    expect(sdk.countTokens).toHaveBeenCalledTimes(2);
    expect(await db.aiReportBudgetReservation.count({ where: { jobId: s.job.id } })).toBe(1);
  });
  it('does not turn map, reduce, or final budget failures into fallback reports', async () => {
    const s = await seed();
    const owner = await db.user.create({ data: { orgId: s.org.id, email: `${randomUUID()}@test.invalid`, fullName: 'owner', passwordHash: 'unused', role: 'owner' } });
    const account = await db.zaloAccount.create({ data: { orgId: s.org.id, ownerUserId: owner.id } });
    const conv = await db.conversation.create({ data: { orgId: s.org.id, zaloAccountId: account.id, externalThreadId: 'chunked', threadType: 'group' } });
    await db.message.createMany({ data: Array.from({ length: 151 }, (_, i) => ({ conversationId: conv.id, senderType: 'contact', contentType: 'text', content: `Project milestone number ${i} completed`, sentAt: new Date() })) });
    const params = { orgId: s.org.id, targets: [{ zaloAccountId: account.id, groupThreadId: 'chunked', conversationId: conv.id }], periodFrom: new Date(0), periodTo: new Date(Date.now() + 1000), executionGuard: s.guard };
    // Two map calls, one group reduce, one final synthesis. Exhaust each boundary.
    for (const boundary of [0, 1, 2, 3]) {
      const job = await db.aiReportJob.create({ data: { orgId: s.org.id, idempotencyKey: randomUUID(), requestData: {}, status: 'running', leaseOwner: 'first', leaseExpiresAt: new Date(Date.now() + 60_000) } });
      sdk.countTokens.mockReset(); sdk.generateContent.mockClear();
      for (let i = 0; i < boundary; i++) sdk.countTokens.mockResolvedValueOnce({ totalTokens: 100 });
      sdk.countTokens.mockResolvedValue({ totalTokens: config.aiReportMaxTokens });
      await expect(summarizer.generateDigestReport({ ...params, budget: budgets.createReportJobBudget(job.id, 'first', s.guard) })).rejects.toThrow('token budget');
      expect(sdk.generateContent).toHaveBeenCalledTimes(boundary);
    }
  });
  it('materializes only frozen sources, persists triples, and stops global overflow before AI', async () => {
    const s = await seed();
    const user = await db.user.create({ data: { orgId: s.org.id, email: `${randomUUID()}@test.invalid`, fullName: 'owner', passwordHash: 'unused', role: 'owner' } });
    const targets = [];
    for (const sentinel of ['selected', 'decoy']) {
      const account = await db.zaloAccount.create({ data: { orgId: s.org.id, ownerUserId: user.id } });
      const conv = await db.conversation.create({ data: { orgId: s.org.id, zaloAccountId: account.id, externalThreadId: 'same', threadType: 'group' } });
      await db.message.create({ data: { conversationId: conv.id, senderType: 'contact', contentType: 'text', content: `${sentinel} completed project details`, sentAt: new Date() } });
      await db.groupReportConfig.create({ data: { orgId: s.org.id, zaloAccountId: account.id, groupThreadId: 'same', customPrompt: `${sentinel} configuration` } });
      targets.push({ zaloAccountId: account.id, groupThreadId: 'same', conversationId: conv.id });
    }
    const params = { orgId: s.org.id, targets: [targets[0]], periodFrom: new Date(0), periodTo: new Date(Date.now() + 1000), budget: s.budget, executionGuard: s.guard };
    const result = await summarizer.generateDigestReport(params);
    expect(result.reportData.sourceTargets).toEqual([targets[0]]);
    expect(result.groupDigests[0]).toMatchObject(targets[0]);
    const allPrompts = JSON.stringify(sdk.generateContent.mock.calls);
    expect(allPrompts).toContain('selected configuration'); expect(allPrompts).not.toContain('decoy');
    expect(await db.generatedReport.count({ where: { orgId: s.org.id } })).toBe(0);
    const previous = config.aiReportMaxMessages;
    try {
      config.aiReportMaxMessages = 1; sdk.generateContent.mockClear();
      await expect(summarizer.generateDigestReport({ ...params, targets })).rejects.toThrow('message budget');
      expect(sdk.generateContent).not.toHaveBeenCalled();
    } finally { config.aiReportMaxMessages = previous; }
  });
});
