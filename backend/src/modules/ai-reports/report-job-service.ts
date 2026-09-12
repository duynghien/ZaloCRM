import { prisma } from '../../shared/database/prisma-client.js';
import { normalizeReportJobRequest, ReportJobValidationError, type ReportJobRequest, type FrozenReportJobRequest } from './report-job-request.js';
import { resolveReportTargets, authorizeReportTargets, authorizeReportAccount, decodeReportTargets } from './report-target-service.js';
import { assertReportAdmission, trackReportProducer } from './report-admission.js';
export { normalizeReportJobRequest, ReportJobValidationError, type ReportJobRequest, type FrozenReportJobRequest } from './report-job-request.js';
const activeStatuses = ['queued', 'running'];
type User = { id: string; orgId: string; role: string; isActive: boolean };

export function decodeReportJobRequest(value: unknown, scheduleKey: string | null): FrozenReportJobRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReportJobValidationError('Invalid job payload');
  const data = value as Record<string, unknown>;
  if (data.schemaVersion !== 2) throw new ReportJobValidationError('legacy_report_targets_require_resubmission');
  if (data.origin !== 'on_demand' && data.origin !== 'scheduled' || (data.origin === 'scheduled') !== !!scheduleKey) throw new ReportJobValidationError('Invalid job origin');
  const targets = decodeReportTargets(data.targets);
  const normalized = normalizeReportJobRequest({ from_date: data.fromDate, to_date: data.toDate, group_targets: targets.map(t => ({ zalo_account_id: t.zaloAccountId, group_thread_id: t.groupThreadId })), zalo_account_id: data.senderAccountId, title: data.title, report_type: data.reportType, send_zalo: data.sendZalo, send_email: data.sendEmail, zalo_destination_type: data.zaloDestinationType, zalo_target_uid: data.zaloTargetUid, email_recipients: data.emailRecipients });
  const { groupTargets: _pairs, groupThreadIds: _ids, ...fields } = normalized;
  return { ...fields, schemaVersion: 2, origin: data.origin, targets };
}
export async function mayRunReportJob(user: User, request: FrozenReportJobRequest): Promise<boolean> {
  return user.isActive && await authorizeReportTargets(user.orgId, request.targets, user, request.sendZalo || request.sendEmail ? 'chat' : 'read') && (!request.sendZalo || !!request.senderAccountId && await authorizeReportAccount(user.orgId, request.senderAccountId, user, 'chat'));
}
async function freeze(orgId: string, user: User | null, request: ReportJobRequest): Promise<FrozenReportJobRequest> {
  // Scheduled identity is server supplied and cannot come from the public DTO.
  const targets = await resolveReportTargets(orgId, request.groupTargets ? { groupTargets: request.groupTargets } : { groupThreadIds: request.groupThreadIds }, user, request.sendZalo || request.sendEmail ? 'chat' : 'read');
  if (request.sendZalo && (!request.senderAccountId || !await authorizeReportAccount(orgId, request.senderAccountId, user, 'chat'))) throw new ReportJobValidationError('Sender unavailable or inaccessible', 404);
  const { groupTargets: _pairs, groupThreadIds: _ids, ...fields } = request;
  return { ...fields, schemaVersion: 2, origin: user ? 'on_demand' : 'scheduled', targets };
}
async function enqueue(orgId: string, user: User | null, key: string, request: ReportJobRequest, scheduleKey?: string) {
  return trackReportProducer(async () => {
    const frozen = await freeze(orgId, user, request);
    return prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`report-job:${orgId}`}));`;
      assertReportAdmission();
      const existing = scheduleKey
        ? await tx.aiReportJob.findUnique({ where: { scheduleKey } })
        : await tx.aiReportJob.findUnique({ where: { orgId_createdById_idempotencyKey: { orgId, createdById: user!.id, idempotencyKey: key } } });
      if (existing) {
        if (existing.orgId !== orgId || JSON.stringify(decodeReportJobRequest(existing.requestData, existing.scheduleKey)) !== JSON.stringify(frozen)) throw new ReportJobValidationError('Idempotency-Key conflicts with another request', 409);
        return { job: existing, replay: true };
      }
      if (user && await tx.aiReportJob.count({ where: { orgId, createdById: user.id, status: { in: activeStatuses } } }) >= 1) throw new ReportJobValidationError('Only one active report job is allowed per user');
      if (await tx.aiReportJob.count({ where: { orgId, status: { in: activeStatuses } } }) >= 2) throw new ReportJobValidationError('Only two active report jobs are allowed per organization');
      assertReportAdmission();
      const job = await tx.aiReportJob.create({ data: { orgId, createdById: user?.id, idempotencyKey: key, scheduleKey, requestData: frozen, dispatches: { create: [...(request.sendZalo ? [{ channel: 'zalo' }] : []), ...(request.sendEmail ? [{ channel: 'email' }] : [])] } } });
      return { job, replay: false };
    });
  });
}
export async function submitReportJob(orgId: string, userId: string, key: string, request: ReportJobRequest) {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) throw new ReportJobValidationError('Invalid Idempotency-Key');
  const user = await prisma.user.findFirst({ where: { id: userId, orgId, isActive: true } });
  if (!user) throw new ReportJobValidationError('Creator unavailable', 404);
  return enqueue(orgId, user, key, request);
}
export async function submitScheduledReportJob(orgId: string, scheduleKey: string, request: ReportJobRequest) {
  if (!scheduleKey.startsWith(`${orgId}:${request.reportType}:`) || !/^\d{4}-\d{2}-\d{2}$/.test(scheduleKey.split(':').at(-1)!)) throw new ReportJobValidationError('Invalid schedule key');
  return enqueue(orgId, null, scheduleKey, request, scheduleKey);
}
