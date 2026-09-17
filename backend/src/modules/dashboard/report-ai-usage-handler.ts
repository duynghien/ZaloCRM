import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { serializeAiUsageStats } from '../ai-reports/ai-usage-serializer.js';

export async function handleGetAiUsageReport(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<any> {
  try {
    const { orgId } = request.user!;
    const query = (request.query || {}) as { from?: string; to?: string };

    const toDefault = new Date().toISOString().split('T')[0];
    const fromDefault = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const from = query.from || fromDefault;
    const to = query.to || toDefault;

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(from) || !dateRegex.test(to)) {
      return reply.status(400).send({ error: 'Định dạng ngày không hợp lệ (YYYY-MM-DD)' });
    }

    const records = await prisma.dailyAiUsageStat.findMany({
      where: {
        orgId,
        statDate: {
          gte: new Date(`${from}T00:00:00.000Z`),
          lte: new Date(`${to}T00:00:00.000Z`),
        },
      },
      orderBy: { statDate: 'asc' },
    });

    let totalCostVnd = 0n;
    let totalCostUsd = 0;
    let totalTokens = 0n;
    let inputTokens = 0n;
    let outputTokens = 0n;
    let cachedTokens = 0n;
    let requestCount = 0;

    const timelineMap = new Map<string, { date: string; costVnd: bigint; costUsd: number; totalTokens: bigint; requestCount: number }>();
    const taskTypeMap = new Map<string, { taskType: string; costVnd: bigint; costUsd: number; totalTokens: bigint; requestCount: number }>();
    const modelMap = new Map<string, { model: string; provider: string; costVnd: bigint; costUsd: number; totalTokens: bigint; requestCount: number }>();

    for (const r of records) {
      totalCostVnd += r.costVnd;
      totalCostUsd += r.costUsd;
      totalTokens += r.totalTokens;
      inputTokens += r.inputTokens;
      outputTokens += r.outputTokens;
      cachedTokens += r.cachedTokens;
      requestCount += r.requestCount;

      const dateStr = r.statDate.toISOString().split('T')[0];

      // Timeline
      const t = timelineMap.get(dateStr) || { date: dateStr, costVnd: 0n, costUsd: 0, totalTokens: 0n, requestCount: 0 };
      t.costVnd += r.costVnd;
      t.costUsd += r.costUsd;
      t.totalTokens += r.totalTokens;
      t.requestCount += r.requestCount;
      timelineMap.set(dateStr, t);

      // Task Type
      const tt = taskTypeMap.get(r.taskType) || { taskType: r.taskType, costVnd: 0n, costUsd: 0, totalTokens: 0n, requestCount: 0 };
      tt.costVnd += r.costVnd;
      tt.costUsd += r.costUsd;
      tt.totalTokens += r.totalTokens;
      tt.requestCount += r.requestCount;
      taskTypeMap.set(r.taskType, tt);

      // Model
      const modelKey = `${r.provider}:${r.model}`;
      const m = modelMap.get(modelKey) || { model: r.model, provider: r.provider, costVnd: 0n, costUsd: 0, totalTokens: 0n, requestCount: 0 };
      m.costVnd += r.costVnd;
      m.costUsd += r.costUsd;
      m.totalTokens += r.totalTokens;
      m.requestCount += r.requestCount;
      modelMap.set(modelKey, m);
    }

    const totalCostVndNum = Number(totalCostVnd);

    const dailyTimeline = Array.from(timelineMap.values()).map((t) => ({
      ...t,
      costUsd: Math.round(t.costUsd * 1_000_000) / 1_000_000,
    }));

    const byTaskType = Array.from(taskTypeMap.values()).map((t) => ({
      ...t,
      costUsd: Math.round(t.costUsd * 1_000_000) / 1_000_000,
      percentage: totalCostVndNum > 0 ? Math.round((Number(t.costVnd) / totalCostVndNum) * 100) : 0,
    }));

    const byModel = Array.from(modelMap.values()).map((m) => ({
      ...m,
      costUsd: Math.round(m.costUsd * 1_000_000) / 1_000_000,
      percentage: totalCostVndNum > 0 ? Math.round((Number(m.costVnd) / totalCostVndNum) * 100) : 0,
    }));

    const tableData = records.map((r) => ({
      id: r.id,
      date: r.statDate.toISOString().split('T')[0],
      taskType: r.taskType,
      provider: r.provider,
      model: r.model,
      requestCount: r.requestCount,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cachedTokens: r.cachedTokens,
      totalTokens: r.totalTokens,
      costUsd: Math.round(r.costUsd * 1_000_000) / 1_000_000,
      costVnd: r.costVnd,
    }));

    const responsePayload = {
      from,
      to,
      summary: {
        totalCostVnd,
        totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
        totalTokens,
        inputTokens,
        outputTokens,
        cachedTokens,
        requestCount,
      },
      dailyTimeline,
      byTaskType,
      byModel,
      tableData,
    };

    return serializeAiUsageStats(responsePayload);
  } catch (err) {
    logger.error('[reports] AI Usage error:', err);
    return reply.status(500).send({ error: 'Failed to fetch AI usage report' });
  }
}
