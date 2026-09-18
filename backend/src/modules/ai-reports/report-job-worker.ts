import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { sendReportEmail } from './email-service.js';
import { decodeReportJobRequest, mayRunReportJob, type FrozenReportJobRequest } from './report-job-service.js';
import { authorizeReportTargets, authorizeReportAccount, decodeReportTargets } from './report-target-service.js';
import { generateDigestReport } from './summarizer-service.js';
import { createReportJobBudget } from './report-job-budget.js';
import { sendReportToZalo } from './zalo-report-sender.js';

const leaseMs = 5 * 60_000;
let timer: NodeJS.Timeout | undefined;
let running: Promise<void> | undefined;
let stopping = false;
const activeJobControllers = new Map<string, AbortController>();
type Job = NonNullable<Awaited<ReturnType<typeof prisma.aiReportJob.findUnique>>>;
const fence = (job: Job) => ({ id: job.id, status: 'running', leaseOwner: job.leaseOwner, leaseExpiresAt: { gt: new Date() } });

export async function claimNextReportJob(): Promise<Job | null> {
  if (stopping) return null;
  const available = { OR: [{ status: 'queued' }, { status: 'running', leaseExpiresAt: { lt: new Date() } }] };
  const candidate = await prisma.aiReportJob.findFirst({ where: available, orderBy: { createdAt: 'asc' } });
  if (!candidate || stopping) return null;
  const leaseOwner = `report-worker:${process.pid}:${randomUUID()}`;
  const claimed = await prisma.aiReportJob.updateMany({ where: { id: candidate.id, ...available }, data: { status: 'running', leaseOwner, leaseExpiresAt: new Date(Date.now() + leaseMs), startedAt: candidate.startedAt ?? new Date(), attempts: { increment: 1 } } });
  return claimed.count ? prisma.aiReportJob.findFirst({ where: { id: candidate.id, leaseOwner } }) : null;
}
async function actor(job: Job, request: FrozenReportJobRequest) {
  if (request.origin === 'scheduled') {
    if (job.createdById || !job.scheduleKey?.startsWith(`${job.orgId}:${request.reportType}:`) || !await authorizeReportTargets(job.orgId, request.targets, null, 'read') || request.sendZalo && (!request.senderAccountId || !await authorizeReportAccount(job.orgId, request.senderAccountId, null, 'chat'))) throw new Error('Scheduled source or sender unavailable');
    return null;
  }
  if (!job.createdById) throw new Error('Report creator deleted');
  const user = await prisma.user.findFirst({ where: { id: job.createdById, orgId: job.orgId, isActive: true } });
  if (!user || !await mayRunReportJob(user, request)) throw new Error('Report authorization changed');
  return user;
}
export async function runReportJob(job: Job): Promise<void> {
  const controller = new AbortController();
  activeJobControllers.set(job.id, controller);
  let request: FrozenReportJobRequest;
  const renewals = new Set<Promise<unknown>>();
  const renew = setInterval(() => {
    const pending = prisma.aiReportJob.updateMany({ where: fence(job), data: { leaseExpiresAt: new Date(Date.now() + leaseMs) } }).catch(error => logger.warn('[report-worker] Lease renewal failed', error));
    renewals.add(pending); void pending.finally(() => renewals.delete(pending));
  }, leaseMs / 3);
  try {
    request = decodeReportJobRequest(job.requestData, job.scheduleKey);
    const guard = async () => {
      const current = await prisma.aiReportJob.findFirst({ where: fence(job) });
      if (!current) throw new Error('Report lease lost');
      if (current.cancellationRequestedAt) {
        controller.abort();
        throw new Error('Job cancelled');
      }
      await actor(job, request);
      // Authorization itself awaits DB work; check ownership again before effects.
      if (!await prisma.aiReportJob.count({ where: { ...fence(job), cancellationRequestedAt: null } })) throw new Error('Report cancelled or lease lost');
    };
    await guard();
    // An earlier claimed external request cannot safely be replayed after recovery.
    const uncertain = await prisma.aiReportJobDispatch.count({ where: { jobId: job.id, status: { in: ['claimed', 'uncertain', 'partial', 'failed'] } } });
    if (uncertain) {
      await prisma.aiReportJobDispatch.updateMany({ where: { jobId: job.id, status: 'claimed' }, data: { status: 'uncertain', deliveryUncertain: true, errorMessage: 'Delivery requires reconciliation' } });
      throw new Error('Delivery requires reconciliation; explicit resend only');
    }
    let report = job.resultReportId ? await prisma.generatedReport.findFirst({ where: { id: job.resultReportId, orgId: job.orgId } }) : null;
    if (report && (report.targetResolutionStatus !== 'verified' || JSON.stringify(decodeReportTargets(report.sourceTargets)) !== JSON.stringify(request.targets))) throw new Error('Report source snapshot mismatch');
    if (!report) {
      const { reportData } = await generateDigestReport({ orgId: job.orgId, userId: job.createdById ?? undefined, reportType: request.reportType, periodFrom: new Date(request.fromDate), periodTo: new Date(request.toDate), targets: request.targets, title: request.title, budget: createReportJobBudget(job.id, job.leaseOwner!, guard), executionGuard: guard, signal: controller.signal });
      await guard();
      report = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM ai_report_jobs WHERE id = ${job.id} FOR UPDATE`;
        const live = await tx.aiReportJob.findFirst({ where: { ...fence(job), cancellationRequestedAt: null } });
        if (!live) throw new Error('Report cancelled or lease lost');
        if (live.resultReportId) return tx.generatedReport.findUniqueOrThrow({ where: { id: live.resultReportId } });
        const result = await tx.generatedReport.create({ data: reportData });
        await tx.aiReportJob.update({ where: { id: job.id }, data: { resultReportId: result.id } });
        return result;
      });
    }
    for (const channel of ['zalo', 'email'] as const) {
      if (!(channel === 'zalo' ? request.sendZalo : request.sendEmail)) continue;
      await guard();
      const claimed = await prisma.$executeRaw`UPDATE ai_report_job_dispatches d SET status='claimed', lease_owner=${job.leaseOwner}, lease_expires_at=${new Date(Date.now() + leaseMs)}, claimed_at=NOW() FROM ai_report_jobs j WHERE d.job_id=${job.id} AND d.channel=${channel} AND d.status='pending' AND j.id=d.job_id AND j.status='running' AND j.lease_owner=${job.leaseOwner} AND j.lease_expires_at>NOW() AND j.cancellation_requested_at IS NULL`;
      if (!claimed) continue;
      const dispatchFence = () => ({ jobId: job.id, channel, status: 'claimed', leaseOwner: job.leaseOwner, leaseExpiresAt: { gt: new Date() } });
      const dispatchGuard = async () => { await guard(); if (!await prisma.aiReportJobDispatch.count({ where: dispatchFence() })) throw new Error('Dispatch lease lost'); };
      let result: { success: boolean; partsSent: number; totalParts: number; deliveryUncertain: boolean; error?: string };
      if (channel === 'zalo') {
        const fromStr = report.periodFrom.toLocaleDateString('vi-VN');
        const toStr = report.periodTo.toLocaleDateString('vi-VN');
        result = await sendReportToZalo({ orgId: job.orgId, accountId: request.senderAccountId!, destinationType: request.zaloDestinationType, targetUid: request.zaloTargetUid, markdownContent: report.summaryContent, reportTitle: report.title, periodText: `${fromStr} — ${toStr}`, deliveryMode: request.zaloDeliveryMode, executionGuard: dispatchGuard, onPartSent: async (sentParts, totalParts) => {
          const updated = await prisma.aiReportJobDispatch.updateMany({ where: dispatchFence(), data: { sentParts, totalParts } });
          if (!updated.count) throw new Error('Dispatch acknowledgment lease lost');
        } });
      } else {
        await dispatchGuard();
        const user = await actor(job, request);
        const recipients = request.emailRecipients.length ? request.emailRecipients : user?.email ? [user.email] : [];
        if (!recipients.length) throw new Error('Email recipients required');
        await dispatchGuard();
        const email = await sendReportEmail({ executionGuard: dispatchGuard, orgId: job.orgId, toEmail: recipients, reportTitle: report.title, markdownContent: report.summaryContent });
        result = { ...email, partsSent: email.success ? 1 : 0, totalParts: 1, deliveryUncertain: !email.success };
      }
      const updated = await prisma.aiReportJobDispatch.updateMany({ where: dispatchFence(), data: { status: result.success ? 'sent' : result.deliveryUncertain ? 'uncertain' : result.partsSent ? 'partial' : 'failed', sentParts: result.partsSent, totalParts: result.totalParts, deliveryUncertain: result.deliveryUncertain, errorMessage: result.error?.slice(0, 500), completedAt: new Date() } });
      if (!updated.count) throw new Error('Delivery acknowledgment lost; reconciliation required');
      if (!result.success) throw new Error(`Delivery ${result.deliveryUncertain ? 'uncertain' : 'incomplete'}: ${result.error ?? 'reconciliation required'}`);
      await guard();
      await prisma.generatedReport.update({ where: { id: report.id }, data: channel === 'zalo' ? { sentZalo: true } : { sentEmail: true } });
    }
    await guard();
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM ai_report_jobs WHERE id=${job.id} FOR UPDATE`;
      if (!await tx.aiReportJob.count({ where: { ...fence(job), cancellationRequestedAt: null } })) throw new Error('Job cancelled or lease lost');
      const dispatches = await tx.aiReportJobDispatch.findMany({ where: { jobId: job.id } });
      if (dispatches.some(d => d.status !== 'sent')) throw new Error('Delivery incomplete; reconciliation required');
      // Persisted acknowledgments are authoritative after a crash between ledger and report writes.
      await tx.generatedReport.update({ where: { id: report!.id }, data: {
        ...(dispatches.some(d => d.channel === 'zalo') ? { sentZalo: true } : {}),
        ...(dispatches.some(d => d.channel === 'email') ? { sentEmail: true } : {}),
      } });
      await tx.aiReportJob.update({ where: { id: job.id }, data: { status: 'succeeded', leaseOwner: null, leaseExpiresAt: null, finishedAt: new Date() } });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Report job failed';
    const current = await prisma.aiReportJob.findFirst({ where: fence(job) });
    if (current) {
      await prisma.aiReportJobDispatch.updateMany({ where: { jobId: job.id, status: 'claimed', leaseOwner: job.leaseOwner }, data: { status: 'uncertain', deliveryUncertain: true, errorMessage: 'Delivery requires reconciliation' } });
      await prisma.aiReportJob.updateMany({ where: fence(job), data: { status: current.cancellationRequestedAt ? 'cancelled' : 'failed', errorMessage: message.slice(0, 500), leaseOwner: null, leaseExpiresAt: null, finishedAt: new Date() } });
    }
    logger.warn(`[report-worker] ${message}`);
  } finally {
    activeJobControllers.delete(job.id);
    clearInterval(renew);
    await Promise.all(renewals);
  }
}
export function processOneReportJob(): Promise<void> {
  if (running) return running;
  running = (async () => { const job = await claimNextReportJob(); if (job) await runReportJob(job); })().finally(() => { running = undefined; });
  return running;
}
export function startReportJobWorker(): void {
  if (timer) return; stopping = false;
  const poll = () => void processOneReportJob().catch(error => logger.error('[report-worker] Poll failed', error));
  timer = setInterval(poll, 2000); poll();
}
export async function stopReportJobWorker(timeoutMs = 30_000): Promise<void> {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = undefined;
  for (const ctrl of activeJobControllers.values()) {
    ctrl.abort();
  }
  let timeout: NodeJS.Timeout | undefined;
  try { await Promise.race([running, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Report worker drain timed out; abort cutover')), timeoutMs); })]); }
  finally { if (timeout) clearTimeout(timeout); }
}
