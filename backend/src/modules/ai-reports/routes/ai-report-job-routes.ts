/**
 * ai-report-job-routes.ts — Endpoints for on-demand report job enqueueing, polling, and cancellation.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { normalizeReportJobRequest, ReportJobValidationError, submitReportJob } from '../report-job-service.js';
import { abortActiveReportJob } from '../report-job-worker.js';
import { isOrganizationAdministrator } from './ai-report-route-helpers.js';

export async function aiReportJobRoutes(app: FastifyInstance) {
  // ── 1. Queue AI Report On-Demand ─────────────────────────────────────────────
  app.post('/api/v1/ai-reports/generate', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const body = (request.body || {}) as Record<string, unknown>;
    let normalized;
    try {
      normalized = normalizeReportJobRequest(body);
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid report request' });
    }
    try {
      const idempotencyKey = request.headers['idempotency-key'];
      const { job, replay } = await submitReportJob(
        user.orgId,
        user.id,
        Array.isArray(idempotencyKey) ? idempotencyKey[0] : idempotencyKey || '',
        normalized
      );
      return reply.status(202).send({ jobId: job.id, status: job.status, replay });
    } catch (err: any) {
      if (err instanceof ReportJobValidationError) return reply.status(err.statusCode).send({ error: err.message });
      if (Number.isInteger(err?.statusCode) && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
      logger.error('[ai-report-job-routes] Job enqueue failed:', err);
      return reply.status(500).send({ error: 'Unable to queue AI report' });
    }
  });

  // ── 2. Poll AI Report Job Status ─────────────────────────────────────────────
  app.get('/api/v1/ai-reports/jobs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const job = await prisma.aiReportJob.findFirst({
      where: { id: (request.params as { id: string }).id, orgId: request.user!.orgId },
    });
    if (!job || (job.createdById !== request.user!.id && !isOrganizationAdministrator(request.user!))) {
      return reply.status(404).send({ error: 'Job not found' });
    }
    return {
      job: {
        id: job.id,
        status: job.status,
        errorMessage: job.errorMessage,
        createdAt: job.createdAt,
        finishedAt: job.finishedAt,
        cancellationRequestedAt: job.cancellationRequestedAt,
        resultReportId: job.resultReportId,
      },
    };
  });

  // ── 3. Cancel Active Report Job ───────────────────────────────────────────────
  app.post('/api/v1/ai-reports/jobs/:id/cancel', async (request: FastifyRequest, reply: FastifyReply) => {
    const job = await prisma.aiReportJob.findFirst({
      where: { id: (request.params as { id: string }).id, orgId: request.user!.orgId },
    });
    if (!job || (job.createdById !== request.user!.id && !isOrganizationAdministrator(request.user!))) {
      return reply.status(404).send({ error: 'Job not found' });
    }
    abortActiveReportJob(job.id);
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ai_report_jobs WHERE id=${job.id} FOR UPDATE`;
      const current = await tx.aiReportJob.findUniqueOrThrow({ where: { id: job.id } });
      if (['succeeded', 'failed', 'cancelled'].includes(current.status)) {
        return reply.status(409).send({ error: 'Job is already finished' });
      }
      await tx.aiReportJob.update({
        where: { id: current.id },
        data: {
          cancellationRequestedAt: new Date(),
          ...(current.status === 'queued' ? { status: 'cancelled', finishedAt: new Date() } : {}),
        },
      });
      return { success: true };
    });
  });
}
