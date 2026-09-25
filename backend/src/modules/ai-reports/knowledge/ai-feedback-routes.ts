import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireRole } from '../../auth/role-middleware.js';
import {
  submitReportFeedback,
  getReportFeedbacks,
  listAllFeedbacks,
  FeedbackValidationError,
  type SubmitReportFeedbackInput,
} from './ai-feedback-distillation-service.js';

export async function aiFeedbackRoutes(app: FastifyInstance) {
  // ── 1. Submit Report Feedback & Distill Rule ────────────────────────────────
  app.post(
    '/api/v1/ai-reports/reports/:reportId/feedback',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { reportId } = request.params as { reportId: string };
      const body = (request.body || {}) as SubmitReportFeedbackInput;

      try {
        const result = await submitReportFeedback(user.orgId, user.id, reportId, body);
        return reply.status(201).send(result);
      } catch (err: any) {
        if (err instanceof FeedbackValidationError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        request.log.error(err, '[ai-feedback-routes] Failed to submit report feedback');
        return reply.status(500).send({ error: 'Không thể tiếp nhận góp ý báo cáo' });
      }
    },
  );

  // ── 2. Get Feedbacks for a Specific Report ──────────────────────────────────
  app.get(
    '/api/v1/ai-reports/reports/:reportId/feedbacks',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { reportId } = request.params as { reportId: string };

      try {
        const feedbacks = await getReportFeedbacks(user.orgId, reportId);
        return reply.send({ feedbacks });
      } catch (err: any) {
        request.log.error(err, '[ai-feedback-routes] Failed to get report feedbacks');
        return reply.status(500).send({ error: 'Không thể tải danh sách góp ý' });
      }
    },
  );

  // ── 3. List All Feedbacks Across Organization ───────────────────────────────
  app.get(
    '/api/v1/ai-reports/feedbacks',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const query = (request.query || {}) as { limit?: string; offset?: string };

      const limit = query.limit ? parseInt(query.limit, 10) : undefined;
      const offset = query.offset ? parseInt(query.offset, 10) : undefined;

      try {
        const feedbacks = await listAllFeedbacks(user.orgId, { limit, offset });
        return reply.send({ feedbacks });
      } catch (err: any) {
        request.log.error(err, '[ai-feedback-routes] Failed to list all feedbacks');
        return reply.status(500).send({ error: 'Không thể tải lịch sử góp ý' });
      }
    },
  );
}
