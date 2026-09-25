/**
 * ai-report-routes.ts — Root aggregator Fastify plugin for AI Report configuration,
 * on-demand generation, archive viewing, settings, task management, and knowledge base.
 */
import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { validateReportHttpRequest } from './report-http-validation.js';
import { aiAuditRuleRoutes } from './ai-audit-rule-routes.js';
import { aiKnowledgeRoutes } from './knowledge/ai-knowledge-routes.js';
import { aiFeedbackRoutes } from './knowledge/ai-feedback-routes.js';
import { aiReportConfigRoutes } from './routes/ai-report-config-routes.js';
import { aiReportJobRoutes } from './routes/ai-report-job-routes.js';
import { aiReportArchiveRoutes } from './routes/ai-report-archive-routes.js';
import { aiReportSettingsRoutes } from './routes/ai-report-settings-routes.js';
import { aiReportTaskRoutes } from './routes/ai-report-task-routes.js';
import './ai-audit-evaluator.js';

export async function aiReportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);
  app.addHook('preHandler', async (request) => validateReportHttpRequest(request));

  // Domain-specific sub-route modules
  await app.register(aiAuditRuleRoutes);
  await app.register(aiKnowledgeRoutes);
  await app.register(aiFeedbackRoutes);
  await app.register(aiReportConfigRoutes);
  await app.register(aiReportJobRoutes);
  await app.register(aiReportArchiveRoutes);
  await app.register(aiReportSettingsRoutes);
  await app.register(aiReportTaskRoutes);
}

export * from './routes/ai-report-route-helpers.js';
