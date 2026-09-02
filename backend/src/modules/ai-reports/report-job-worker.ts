import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { config } from '../../config/index.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { sendReportEmail } from './email-service.js';
import { mayRunReportJob, type ReportJobRequest } from './report-job-service.js';
import { generateDigestReport } from './summarizer-service.js';
import { sendReportToZalo } from './zalo-report-sender.js';

const workerId = `report-worker:${process.pid}`;
const leaseMs = 5 * 60 * 1000;
let timer: NodeJS.Timeout | undefined;
let processing = false;

type ClaimedJob = NonNullable<Awaited<ReturnType<typeof prisma.aiReportJob.findUnique>>> & { leaseOwner: string };

async function claimNextJob(): Promise<ClaimedJob | null> {
  const candidate = await prisma.aiReportJob.findFirst({ where: { OR: [{ status: 'queued' }, { status: 'running', leaseExpiresAt: { lt: new Date() } }] }, orderBy: { createdAt: 'asc' } });
  if (!candidate) return null;
  const leaseOwner = `${workerId}:${randomUUID()}`;
  const claimed = await prisma.aiReportJob.updateMany({ where: { id: candidate.id, OR: [{ status: 'queued' }, { status: 'running', leaseExpiresAt: { lt: new Date() } }] }, data: { status: 'running', leaseOwner, leaseExpiresAt: new Date(Date.now() + leaseMs), startedAt: candidate.startedAt ?? new Date(), attempts: { increment: 1 }, errorMessage: null } });
  if (!claimed.count) return null;
  const job = await prisma.aiReportJob.findUnique({ where: { id: candidate.id } });
  return job?.leaseOwner === leaseOwner ? job as ClaimedJob : null;
}

async function fencedUpdate(job: ClaimedJob, data: Prisma.AiReportJobUpdateManyMutationInput): Promise<void> {
  const result = await prisma.aiReportJob.updateMany({ where: { id: job.id, status: 'running', leaseOwner: job.leaseOwner }, data });
  if (!result.count) throw new Error('Lease lost');
}

async function fencedSetResultReport(job: ClaimedJob, reportId: string): Promise<void> {
  const updated = await prisma.$executeRaw`
    UPDATE "ai_report_jobs" SET "result_report_id" = ${reportId}, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${job.id} AND "status" = 'running' AND "lease_owner" = ${job.leaseOwner}`;
  if (updated !== 1) throw new Error('Lease lost');
}

async function authorizedUser(job: ClaimedJob, request: ReportJobRequest) {
  if (!job.createdById) {
    const groupCount = await prisma.conversation.count({
      where: { orgId: job.orgId, threadType: 'group', externalThreadId: { in: request.groupThreadIds } },
    });
    return groupCount === request.groupThreadIds.length ? null : undefined;
  }
  const user = await prisma.user.findFirst({ where: { id: job.createdById, orgId: job.orgId }, select: { id: true, orgId: true, role: true, isActive: true, email: true } });
  return user && await mayRunReportJob(user, request) ? user : null;
}

async function claimDispatch(job: ClaimedJob, channel: 'zalo' | 'email'): Promise<boolean> {
  const result = await prisma.$executeRaw`
    UPDATE "ai_report_job_dispatches" AS dispatch
    SET "status" = 'claimed', "lease_owner" = ${job.leaseOwner},
        "lease_expires_at" = ${new Date(Date.now() + leaseMs)}, "claimed_at" = CURRENT_TIMESTAMP
    FROM "ai_report_jobs" AS job
    WHERE dispatch."job_id" = ${job.id} AND dispatch."channel" = ${channel}
      AND dispatch."status" = 'pending' AND job."id" = dispatch."job_id"
      AND job."status" = 'running' AND job."lease_owner" = ${job.leaseOwner}`;
  return result === 1;
}

async function cancelledOrLeaseLost(job: ClaimedJob): Promise<boolean> {
  const current = await prisma.aiReportJob.findFirst({ where: { id: job.id, status: 'running', leaseOwner: job.leaseOwner }, select: { cancellationRequestedAt: true } });
  return !current || Boolean(current.cancellationRequestedAt);
}

async function completeDispatch(job: ClaimedJob, channel: 'zalo' | 'email', sent: boolean, error?: string): Promise<void> {
  const updated = await prisma.aiReportJobDispatch.updateMany({
    where: { jobId: job.id, channel, status: 'claimed', leaseOwner: job.leaseOwner },
    data: { status: sent ? 'sent' : 'failed', leaseOwner: null, leaseExpiresAt: null, completedAt: new Date(), errorMessage: error?.slice(0, 500) },
  });
  if (!updated.count) throw new Error('Lease lost');
}

async function runJob(job: ClaimedJob): Promise<void> {
  const request = job.requestData as unknown as ReportJobRequest;
  const renew = setInterval(() => void prisma.aiReportJob.updateMany({ where: { id: job.id, status: 'running', leaseOwner: job.leaseOwner }, data: { leaseExpiresAt: new Date(Date.now() + leaseMs) } }), Math.floor(leaseMs / 3));
  try {
    if (job.cancellationRequestedAt || await cancelledOrLeaseLost(job)) throw new Error('Job cancelled');
    const user = await authorizedUser(job, request);
    if (user === undefined || (job.createdById && !user)) throw new Error('Authorization changed before job execution');
    const [messages, tokenRows] = await Promise.all([
      prisma.message.count({ where: { conversation: { orgId: job.orgId, externalThreadId: { in: request.groupThreadIds } }, sentAt: { gte: new Date(request.fromDate), lte: new Date(request.toDate) }, isDeleted: false } }),
      prisma.$queryRaw<Array<{ totalChars: bigint }>>`SELECT COALESCE(SUM(char_length(COALESCE(m.content, ''))), 0)::bigint AS "totalChars" FROM "messages" m JOIN "conversations" c ON c.id = m."conversation_id" WHERE c."org_id" = ${job.orgId} AND c."external_thread_id" IN (${Prisma.join(request.groupThreadIds)}) AND m."sent_at" >= ${new Date(request.fromDate)} AND m."sent_at" <= ${new Date(request.toDate)} AND m."is_deleted" = false`,
    ]);
    if (messages > config.aiReportMaxMessages || Number(tokenRows[0].totalChars) / 4 > config.aiReportMaxTokens) throw new Error('Report exceeds the configured budget');
    let report = job.resultReportId ? await prisma.generatedReport.findUnique({ where: { id: job.resultReportId } }) : null;
    if (!report) {
      report = (await generateDigestReport({ orgId: job.orgId, userId: job.createdById ?? undefined, reportType: request.reportType, periodFrom: new Date(request.fromDate), periodTo: new Date(request.toDate), groupThreadIds: request.groupThreadIds, title: request.title, maxMessagesPerGroup: config.aiReportMaxMessages, shouldCancel: () => cancelledOrLeaseLost(job) })).report;
      await fencedSetResultReport(job, report.id);
    }
    const live = await prisma.aiReportJob.findFirst({ where: { id: job.id, status: 'running', leaseOwner: job.leaseOwner }, select: { cancellationRequestedAt: true } });
    if (!live || live.cancellationRequestedAt) throw new Error('Job cancelled');
    let sentZalo = report.sentZalo;
    let sentEmail = report.sentEmail;
    if (request.sendZalo && await claimDispatch(job, 'zalo')) {
      if (await cancelledOrLeaseLost(job)) throw new Error('Job cancelled');
      const dispatchUser = await authorizedUser(job, request);
      if (dispatchUser === undefined || (job.createdById && !dispatchUser)) throw new Error('Authorization changed before Zalo dispatch');
      const result = await sendReportToZalo({ orgId: job.orgId, destinationType: request.zaloDestinationType, targetUid: request.zaloTargetUid, markdownContent: report.summaryContent, reportTitle: report.title });
      sentZalo = result.success;
      await completeDispatch(job, 'zalo', result.success, result.error);
    }
    if (request.sendEmail && await claimDispatch(job, 'email')) {
      if (await cancelledOrLeaseLost(job)) throw new Error('Job cancelled');
      const dispatchUser = await authorizedUser(job, request);
      if (dispatchUser === undefined || (job.createdById && !dispatchUser)) throw new Error('Authorization changed before email dispatch');
      const recipients = request.emailRecipients.length ? request.emailRecipients : dispatchUser?.email ? [dispatchUser.email] : [];
      if (!recipients.length) throw new Error('Scheduled email report requires recipients');
      const result = await sendReportEmail({ orgId: job.orgId, toEmail: recipients, reportTitle: report.title, markdownContent: report.summaryContent });
      sentEmail = result.success;
      await completeDispatch(job, 'email', result.success, result.error);
    }
    await prisma.generatedReport.update({ where: { id: report.id }, data: { sentZalo, sentEmail } });
    await fencedUpdate(job, { status: 'succeeded', leaseOwner: null, leaseExpiresAt: null, finishedAt: new Date() });
  } catch (error: any) {
    const cancelled = job.cancellationRequestedAt || error?.message === 'Job cancelled';
    await prisma.aiReportJob.updateMany({ where: { id: job.id, status: 'running', leaseOwner: job.leaseOwner }, data: { status: cancelled ? 'cancelled' : 'failed', leaseOwner: null, leaseExpiresAt: null, errorMessage: cancelled ? null : String(error?.message || 'Report job failed').slice(0, 500), finishedAt: new Date() } });
    logger.warn(`[report-job-worker] Job ${job.id} ${cancelled ? 'cancelled' : 'failed'}: ${error?.message || error}`);
  } finally { clearInterval(renew); }
}

async function processOneJob(): Promise<void> { if (processing) return; processing = true; try { const job = await claimNextJob(); if (job) await runJob(job); } finally { processing = false; } }
export function startReportJobWorker(): void { if (!timer) { timer = setInterval(() => void processOneJob(), 2_000); void processOneJob(); } }
export function stopReportJobWorker(): void { if (timer) clearInterval(timer); timer = undefined; }
