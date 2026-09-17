import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { getAiBudgetStatus } from '../ai-reports/ai-budget-alert-service.js';
import { serializeAiUsageStats } from '../ai-reports/ai-usage-serializer.js';

export async function handleGetAiKpi(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<any> {
  try {
    const { orgId } = request.user!;
    const query = (request.query || {}) as { from?: string; to?: string };

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (query.from && !dateRegex.test(query.from)) {
      return reply.status(400).send({ error: 'Định dạng tham số from không hợp lệ (YYYY-MM-DD)' });
    }
    if (query.to && !dateRegex.test(query.to)) {
      return reply.status(400).send({ error: 'Định dạng tham số to không hợp lệ (YYYY-MM-DD)' });
    }

    const where: any = { orgId };
    if (query.from || query.to) {
      where.statDate = {};
      if (query.from) where.statDate.gte = new Date(`${query.from}T00:00:00.000Z`);
      if (query.to) where.statDate.lte = new Date(`${query.to}T00:00:00.000Z`);
    }

    const [totals, budgetStatus] = await Promise.all([
      prisma.dailyAiUsageStat.aggregate({
        where,
        _sum: {
          costVnd: true,
          costUsd: true,
          totalTokens: true,
          inputTokens: true,
          outputTokens: true,
          cachedTokens: true,
          requestCount: true,
        },
      }),
      getAiBudgetStatus(orgId),
    ]);

    const rawResult = {
      totalCostVnd: totals._sum.costVnd ?? 0n,
      totalCostUsd: totals._sum.costUsd ?? 0,
      totalTokens: totals._sum.totalTokens ?? 0n,
      inputTokens: totals._sum.inputTokens ?? 0n,
      outputTokens: totals._sum.outputTokens ?? 0n,
      cachedTokens: totals._sum.cachedTokens ?? 0n,
      requestCount: totals._sum.requestCount ?? 0,
      budgetStatus,
    };

    return serializeAiUsageStats(rawResult);
  } catch (err) {
    logger.error('[dashboard] AI KPI error:', err);
    return reply.status(500).send({ error: 'Failed to fetch AI KPI data' });
  }
}
