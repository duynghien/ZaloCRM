import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { config } from '../../config/index.js';

/** Pipeline control failures must never become an AI fallback or provider retry. */
export class ReportControlError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'ReportControlError'; }
}
export const isReportControlError = (error: unknown): error is ReportControlError => error instanceof ReportControlError;
export async function runReportExecutionGuard(guard: () => Promise<void>): Promise<void> {
  try { await guard(); } catch (cause) {
    if (isReportControlError(cause)) throw cause;
    throw new ReportControlError(cause instanceof Error ? cause.message : 'Report execution stopped', { cause });
  }
}
export interface ReportJobBudget {
  reserve(inputTokens: number, requestedOutputTokens: number): Promise<{ attemptKey: string; maxOutputTokens: number }>;
  complete(attemptKey: string, usage: { inputTokens?: number; outputTokens?: number }): Promise<void>;
  failAttempt(attemptKey: string, usage?: { inputTokens?: number; outputTokens?: number }): Promise<void>;
}

export function createReportJobBudget(jobId: string, leaseOwner: string, executionGuard: () => Promise<void>): ReportJobBudget {
  const lockLiveJob = async (tx: Prisma.TransactionClient) => {
    const rows = await tx.$queryRaw<Array<{ leaseExpiresAt: Date }>>`
      SELECT "lease_expires_at" AS "leaseExpiresAt" FROM "ai_report_jobs"
      WHERE "id" = ${jobId} AND "status" = 'running' AND "lease_owner" = ${leaseOwner}
        AND "lease_expires_at" > clock_timestamp() AND "cancellation_requested_at" IS NULL FOR UPDATE`;
    if (!rows.length) throw new ReportControlError('Report job cancelled or lease lost');
    return rows[0];
  };
  return {
    async reserve(inputTokens, requestedOutputTokens) {
      await runReportExecutionGuard(executionGuard);
      if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(requestedOutputTokens) || requestedOutputTokens < 1) {
        throw new ReportControlError('Report token bound unavailable');
      }
      try {
        return await prisma.$transaction(async tx => {
          const job = await lockLiveJob(tx);
          const totals = await tx.aiReportBudgetReservation.aggregate({ where: { jobId }, _sum: { inputTokens: true, outputTokens: true } });
          const remaining = config.aiReportMaxTokens - (totals._sum.inputTokens ?? 0) - (totals._sum.outputTokens ?? 0) - inputTokens;
          const maxOutputTokens = Math.min(requestedOutputTokens, remaining);
          if (maxOutputTokens < 1) throw new ReportControlError('Report exceeds the configured token budget');
          const attemptKey = randomUUID();
          await tx.aiReportBudgetReservation.create({ data: { jobId, attemptKey, leaseOwner, leaseExpiresAt: job.leaseExpiresAt, inputTokens, outputTokens: maxOutputTokens } });
          return { attemptKey, maxOutputTokens };
        });
      } catch (cause) {
        if (isReportControlError(cause)) throw cause;
        throw new ReportControlError('Report token reservation failed', { cause });
      }
    },
    async complete(attemptKey, usage) {
      await runReportExecutionGuard(executionGuard);
      try {
        await prisma.$transaction(async tx => {
          await lockLiveJob(tx);
          const usedInputTokens = Number.isSafeInteger(usage.inputTokens) && usage.inputTokens! >= 0 ? usage.inputTokens : undefined;
          const usedOutputTokens = Number.isSafeInteger(usage.outputTokens) && usage.outputTokens! >= 0 ? usage.outputTokens : undefined;
          const result = await tx.aiReportBudgetReservation.updateMany({ where: { jobId, attemptKey, leaseOwner, outcome: 'reserved' }, data: { outcome: 'completed', usedInputTokens, usedOutputTokens } });
          if (result.count !== 1) throw new ReportControlError('Report token reservation ownership lost');
          // Keep the entire reservation charged, including unknown/unused output, across recovery.
        });
      } catch (cause) {
        if (isReportControlError(cause)) throw cause;
        throw new ReportControlError('Report token usage persistence failed', { cause });
      }
    },
    async failAttempt(attemptKey, usage) {
      await runReportExecutionGuard(executionGuard);
      try {
        await prisma.$transaction(async tx => {
          await lockLiveJob(tx);
          const usedInputTokens = Number.isSafeInteger(usage?.inputTokens) && usage!.inputTokens! >= 0 ? usage!.inputTokens : undefined;
          const hasValidOutput = Number.isSafeInteger(usage?.outputTokens) && usage!.outputTokens! >= 0;

          const data: Prisma.AiReportBudgetReservationUpdateManyMutationInput = {
            outcome: 'failed',
            usedInputTokens,
          };

          if (hasValidOutput) {
            data.outputTokens = usage!.outputTokens!;
            data.usedOutputTokens = usage!.outputTokens!;
          } else {
            // Keep the full reservation initially reserved; do not zero out outputTokens
            data.usedOutputTokens = undefined;
          }

          const result = await tx.aiReportBudgetReservation.updateMany({
            where: { jobId, attemptKey, leaseOwner, outcome: 'reserved' },
            data,
          });
          if (result.count !== 1) throw new ReportControlError('Report token reservation ownership lost');
        });
      } catch (cause) {
        if (isReportControlError(cause)) throw cause;
        throw new ReportControlError('Report token usage failAttempt persistence failed', { cause });
      }
    },
  };
}
