import { randomUUID } from 'node:crypto';
import type { GeneratedReport } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { normalizeReportJobRequest, ReportJobValidationError } from './report-job-request.js';
import { authorizeReportTargets, authorizeReportAccount, decodeReportTargets } from './report-target-service.js';
import { trackReportProducer, assertReportAdmission } from './report-admission.js';
import { sendReportToZalo } from './zalo-report-sender.js';
import { sendReportEmail } from './email-service.js';
type User = { id: string; orgId: string; role: string; email: string };

export async function resendReport(user: User, report: GeneratedReport, body: Record<string, unknown>, key: string) {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) throw new ReportJobValidationError('Invalid Idempotency-Key');
  if (report.orgId !== user.orgId || report.targetResolutionStatus !== 'verified') throw new ReportJobValidationError('Legacy reports cannot be resent', 403);
  const targets = decodeReportTargets(report.sourceTargets);
  const request = normalizeReportJobRequest({ ...body, from_date: report.periodFrom.toISOString(), to_date: report.periodTo.toISOString(), group_targets: targets.map(t => ({ zalo_account_id: t.zaloAccountId, group_thread_id: t.groupThreadId })) });
  if (!request.sendEmail && !request.sendZalo) throw new ReportJobValidationError('Select a delivery channel');
  if (request.sendEmail && !request.emailRecipients.length) request.emailRecipients = [user.email];
  const snapshot = { reportId: report.id, targets, request };
  const authorize = async () => {
    if (!await authorizeReportTargets(user.orgId, targets, user, 'chat') || request.sendZalo && (!request.senderAccountId || !await authorizeReportAccount(user.orgId, request.senderAccountId, user, 'chat'))) throw new ReportJobValidationError('Report source or sender inaccessible', 404);
  };
  return trackReportProducer(async () => {
    await authorize();
    const admission = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`report-resend:${user.orgId}:${user.id}:${key}`}));`;
      assertReportAdmission();
      const existing = await tx.aiReportResend.findUnique({ where: { orgId_requestedById_idempotencyKey: { orgId: user.orgId, requestedById: user.id, idempotencyKey: key } } });
      if (existing) {
        if (JSON.stringify(existing.requestData) !== JSON.stringify(snapshot)) {
          // PostgreSQL JSONB key order is not an identity contract.
          if (canonical(existing.requestData) !== canonical(snapshot)) throw new ReportJobValidationError('Idempotency-Key conflicts with another resend', 409);
        }
        return { attempt: existing, replay: true };
      }
      const attempt = await tx.aiReportResend.create({ data: { orgId: user.orgId, requestedById: user.id, reportId: report.id, idempotencyKey: key, requestData: snapshot, status: 'running', leaseOwner: randomUUID(), leaseExpiresAt: new Date(Date.now() + 300_000), dispatches: { create: [...(request.sendZalo ? [{ channel: 'zalo' }] : []), ...(request.sendEmail ? [{ channel: 'email' }] : [])] } } });
      return { attempt, replay: false };
    });
    const attempt = admission.attempt;
    const resultDto = async () => {
      const channels = await prisma.aiReportResendDispatch.findMany({ where: { resendId: attempt.id } });
      const outcome = (channel: string) => { const row = channels.find(d => d.channel === channel); return row ? { success: row.status === 'sent', partsSent: row.sentParts, totalParts: row.totalParts, deliveryUncertain: row.deliveryUncertain || row.status === 'claimed', error: row.errorMessage ?? (row.status === 'claimed' ? 'Delivery requires reconciliation' : undefined) } : null; };
      return { success: channels.every(d => d.status === 'sent'), resendId: attempt.id, replay: admission.replay, zalo: outcome('zalo'), email: outcome('email') };
    };
    if (admission.replay) return resultDto();
    const fence = () => ({ id: attempt.id, status: 'running', leaseOwner: attempt.leaseOwner, leaseExpiresAt: { gt: new Date() } });
    const guard = async () => { await authorize(); if (!await prisma.aiReportResend.count({ where: fence() })) throw new Error('Resend lease lost'); };
    try {
      for (const channel of ['zalo', 'email'] as const) {
        if (!(channel === 'zalo' ? request.sendZalo : request.sendEmail)) continue;
        await guard();
        const claimed = await prisma.aiReportResendDispatch.updateMany({ where: { resendId: attempt.id, channel, status: 'pending' }, data: { status: 'claimed', leaseOwner: attempt.leaseOwner, leaseExpiresAt: attempt.leaseExpiresAt, claimedAt: new Date() } });
        if (!claimed.count) throw new Error('Resend channel already claimed');
        const dispatchFence = () => ({ resendId: attempt.id, channel, status: 'claimed', leaseOwner: attempt.leaseOwner, leaseExpiresAt: { gt: new Date() } });
        const dispatchGuard = async () => { await guard(); if (!await prisma.aiReportResendDispatch.count({ where: dispatchFence() })) throw new Error('Resend dispatch lease lost'); };
        let result: { success: boolean; partsSent: number; totalParts: number; deliveryUncertain: boolean; error?: string };
        if (channel === 'zalo') {
          const fromStr = report.periodFrom.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
          const toStr = report.periodTo.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
          result = await sendReportToZalo({ orgId: user.orgId, accountId: request.senderAccountId!, destinationType: request.zaloDestinationType, targetUid: request.zaloTargetUid, markdownContent: report.summaryContent, reportTitle: report.title, periodText: `${fromStr} — ${toStr}`, deliveryMode: request.zaloDeliveryMode, executionGuard: dispatchGuard, onPartSent: async (sentParts, totalParts) => {
            if (!(await prisma.aiReportResendDispatch.updateMany({ where: dispatchFence(), data: { sentParts, totalParts } })).count) throw new Error('Resend acknowledgment lease lost');
          } });
        } else {
          await dispatchGuard();
          const email = await sendReportEmail({ executionGuard: dispatchGuard, orgId: user.orgId, toEmail: request.emailRecipients, reportTitle: report.title, markdownContent: report.summaryContent });
          result = { ...email, partsSent: email.success ? 1 : 0, totalParts: 1, deliveryUncertain: !email.success };
        }
        if (!(await prisma.aiReportResendDispatch.updateMany({ where: dispatchFence(), data: { status: result.success ? 'sent' : result.deliveryUncertain ? 'uncertain' : result.partsSent ? 'partial' : 'failed', sentParts: result.partsSent, totalParts: result.totalParts, deliveryUncertain: result.deliveryUncertain, errorMessage: result.error?.slice(0, 500), completedAt: new Date() } })).count) throw new Error('Resend acknowledgment lost');
        if (!result.success) throw new Error('Resend incomplete; reconciliation required');
        await guard();
        await prisma.generatedReport.update({ where: { id: report.id }, data: channel === 'zalo' ? { sentZalo: true } : { sentEmail: true } });
      }
      await prisma.aiReportResend.updateMany({ where: fence(), data: { status: 'succeeded', completedAt: new Date() } });
    } catch (error) {
      await prisma.aiReportResendDispatch.updateMany({ where: { resendId: attempt.id, status: 'claimed', leaseOwner: attempt.leaseOwner }, data: { status: 'uncertain', deliveryUncertain: true, errorMessage: 'Delivery requires reconciliation' } });
      await prisma.aiReportResend.updateMany({ where: fence(), data: { status: 'failed', errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'Resend failed', completedAt: new Date() } });
    }
    return resultDto();
  });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`).join(',')}}`;
  return JSON.stringify(value);
}
