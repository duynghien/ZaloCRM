import { prisma } from '../../shared/database/prisma-client.js';

export type ReportJobRequest = {
  fromDate: string;
  toDate: string;
  groupThreadIds: string[];
  title?: string;
  reportType: 'daily' | 'weekly' | 'on_demand';
  sendZalo: boolean;
  sendEmail: boolean;
  zaloDestinationType: 'self' | 'cloud' | 'uid';
  zaloTargetUid?: string;
  emailRecipients: string[];
};

export class ReportJobValidationError extends Error {}

const activeStatuses = ['queued', 'running'];

export function normalizeReportJobRequest(input: Record<string, unknown>): ReportJobRequest {
  const fromDate = String(input.from_date ?? '');
  const toDate = String(input.to_date ?? '');
  if (fromDate.length > 40 || toDate.length > 40) throw new ReportJobValidationError('Invalid report date range');
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (!fromDate || !toDate || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    throw new ReportJobValidationError('Invalid report date range');
  }
  if (to.getTime() - from.getTime() > 30 * 24 * 60 * 60 * 1000) {
    throw new ReportJobValidationError('Report range must not exceed 31 days');
  }
  const groupThreadIds = Array.isArray(input.group_thread_ids) ? input.group_thread_ids.map(String) : [];
  if (!groupThreadIds.length || groupThreadIds.length > 20 || new Set(groupThreadIds).size !== groupThreadIds.length || groupThreadIds.some((id) => !id || id.length > 128)) {
    throw new ReportJobValidationError('Select between 1 and 20 unique groups');
  }
  const emailRecipients = Array.isArray(input.email_recipients) ? input.email_recipients.map((value) => String(value).trim().toLowerCase()) : [];
  if (emailRecipients.length > 10 || new Set(emailRecipients).size !== emailRecipients.length || emailRecipients.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new ReportJobValidationError('Email recipients must be up to 10 unique valid addresses');
  }
  const sendZalo = input.send_zalo === true;
  const sendEmail = input.send_email === true;
  const zaloDestinationType = input.zalo_destination_type === 'uid' ? 'uid' : input.zalo_destination_type === 'cloud' ? 'cloud' : 'self';
  const zaloTargetUid = typeof input.zalo_target_uid === 'string' ? input.zalo_target_uid.trim() : undefined;
  if (zaloTargetUid && zaloTargetUid.length > 128) throw new ReportJobValidationError('zalo_target_uid is too long');
  if (sendZalo && zaloDestinationType === 'uid' && !zaloTargetUid) throw new ReportJobValidationError('zalo_target_uid is required');
  if (typeof input.title === 'string' && input.title.length > 200) throw new ReportJobValidationError('Report title is too long');
  return { fromDate, toDate, groupThreadIds, title: typeof input.title === 'string' ? input.title : undefined, reportType: input.report_type === 'daily' || input.report_type === 'weekly' ? input.report_type : 'on_demand', sendZalo, sendEmail, zaloDestinationType, zaloTargetUid, emailRecipients };
}

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
