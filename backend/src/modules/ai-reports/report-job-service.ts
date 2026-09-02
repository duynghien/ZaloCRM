import { prisma } from '../../shared/database/prisma-client.js';
import { ReportJobValidationError, type ReportJobRequest } from './report-job-request.js';

export { normalizeReportJobRequest, ReportJobValidationError, type ReportJobRequest } from './report-job-request.js';

const activeStatuses = ['queued', 'running'];

export async function submitReportJob(orgId: string, userId: string, idempotencyKey: string, request: ReportJobRequest) {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(idempotencyKey)) throw new ReportJobValidationError('Invalid Idempotency-Key');
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`report-job:${orgId}`}));`;
    const existing = await tx.aiReportJob.findUnique({ where: { orgId_createdById_idempotencyKey: { orgId, createdById: userId, idempotencyKey } } });
    if (existing) return { job: existing, replay: true };
    const [userCount, orgCount] = await Promise.all([
      tx.aiReportJob.count({ where: { createdById: userId, status: { in: activeStatuses } } }),
      tx.aiReportJob.count({ where: { orgId, status: { in: activeStatuses } } }),
    ]);
    if (userCount >= 1) throw new ReportJobValidationError('Only one active report job is allowed per user');
    if (orgCount >= 2) throw new ReportJobValidationError('Only two active report jobs are allowed per organization');
    const job = await tx.aiReportJob.create({
      data: {
        orgId, createdById: userId, idempotencyKey, requestData: request,
        dispatches: { create: [
          ...(request.sendZalo ? [{ channel: 'zalo' }] : []),
          ...(request.sendEmail ? [{ channel: 'email' }] : []),
        ] },
      },
    });
    return { job, replay: false };
  });
}

export async function submitScheduledReportJob(
  orgId: string,
  scheduleKey: string,
  request: ReportJobRequest,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`scheduled-report:${scheduleKey}`}));`;
    const existing = await tx.aiReportJob.findUnique({ where: { scheduleKey } });
    if (existing) return { job: existing, replay: true };
    const job = await tx.aiReportJob.create({
      data: {
        orgId,
        scheduleKey,
        idempotencyKey: scheduleKey,
        requestData: request,
        dispatches: { create: [
          ...(request.sendZalo ? [{ channel: 'zalo' }] : []),
          ...(request.sendEmail ? [{ channel: 'email' }] : []),
        ] },
      },
    });
    return { job, replay: false };
  });
}

export async function mayRunReportJob(user: { id: string; orgId: string; role: string; isActive: boolean }, request: ReportJobRequest): Promise<boolean> {
  if (!user.isActive) return false;
  const conversations = await prisma.conversation.findMany({ where: { orgId: user.orgId, threadType: 'group', externalThreadId: { in: request.groupThreadIds } }, select: { externalThreadId: true, zaloAccountId: true } });
  if (new Set(conversations.map((conversation) => conversation.externalThreadId)).size !== request.groupThreadIds.length) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  const grants = await prisma.zaloAccountAccess.findMany({ where: { userId: user.id, zaloAccountId: { in: conversations.map((conversation) => conversation.zaloAccountId) } }, select: { zaloAccountId: true, permission: true } });
  const levels = new Map(grants.map((grant) => [grant.zaloAccountId, grant.permission === 'admin' ? 3 : grant.permission === 'chat' ? 2 : 1]));
  const required = request.sendZalo || request.sendEmail ? 2 : 1;
  return conversations.every((conversation) => (levels.get(conversation.zaloAccountId) ?? 0) >= required);
}
