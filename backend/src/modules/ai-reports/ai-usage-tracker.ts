import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import {
  calculateAiCost,
  TokenUsageInput,
  DEFAULT_USD_VND_RATE,
} from './ai-pricing-catalog.js';

export interface RecordAiUsageOptions {
  orgId: string;
  userId?: string | null;
  taskType: 'copilot' | 'executive_report' | 'audit_rule' | 'vision_ocr' | 'test_connection' | 'knowledge_distillation' | string;
  provider: string;
  model: string;
  usage?: TokenUsageInput;
  durationMs?: number | null;
  status: 'success' | 'failed' | string;
  metadata?: any;
  exchangeRate?: number;
}

export function getVnDateString(date: Date = new Date()): string {
  const vnTime = new Date(date.getTime() + 7 * 3600 * 1000);
  return vnTime.toISOString().split('T')[0];
}

export async function recordAiUsageAsync(
  payload: RecordAiUsageOptions,
  client = prisma,
): Promise<void> {
  try {
    const {
      orgId,
      userId = null,
      taskType,
      provider,
      model,
      usage,
      durationMs = null,
      status = 'success',
      metadata = null,
      exchangeRate = DEFAULT_USD_VND_RATE,
    } = payload;

    if (!orgId) {
      logger.warn('[ai-usage-tracker] Skipped recording telemetry: missing orgId');
      return;
    }

    const inputTokens = Math.max(0, usage?.inputTokens ?? 0);
    const outputTokens = Math.max(0, usage?.outputTokens ?? 0);
    const cachedTokens = Math.max(0, usage?.cachedTokens ?? 0);
    const totalTokens = Math.max(
      0,
      usage?.totalTokens ?? inputTokens + outputTokens,
    );

    const { costUsd, costVnd } = calculateAiCost(
      provider,
      model,
      { inputTokens, outputTokens, cachedTokens, totalTokens },
      exchangeRate,
    );

    const statDate = getVnDateString();
    const id = randomUUID();

    // 1. Raw transaction log
    await client.aiUsageLog.create({
      data: {
        orgId,
        userId: userId || undefined,
        taskType,
        provider,
        model,
        inputTokens,
        outputTokens,
        cachedTokens,
        totalTokens,
        costUsd,
        costVnd,
        durationMs: durationMs !== null && durationMs !== undefined ? Math.round(durationMs) : null,
        status,
        metadata: metadata ? (typeof metadata === 'object' ? metadata : { info: metadata }) : undefined,
      },
    });

    // 2. Atomic upsert rollup into daily_ai_usage_stats (immune to race conditions)
    await client.$executeRaw`
      INSERT INTO daily_ai_usage_stats (
        id, org_id, stat_date, task_type, provider, model,
        request_count, input_tokens, output_tokens, cached_tokens, total_tokens,
        cost_usd, cost_vnd, updated_at
      )
      VALUES (
        ${id}, ${orgId}, ${statDate}::date, ${taskType}, ${provider}, ${model},
        1, ${BigInt(inputTokens)}, ${BigInt(outputTokens)}, ${BigInt(cachedTokens)}, ${BigInt(totalTokens)},
        ${costUsd}, ${costVnd}, NOW()
      )
      ON CONFLICT (org_id, stat_date, task_type, provider, model)
      DO UPDATE SET
        request_count = daily_ai_usage_stats.request_count + 1,
        input_tokens = daily_ai_usage_stats.input_tokens + EXCLUDED.input_tokens,
        output_tokens = daily_ai_usage_stats.output_tokens + EXCLUDED.output_tokens,
        cached_tokens = daily_ai_usage_stats.cached_tokens + EXCLUDED.cached_tokens,
        total_tokens = daily_ai_usage_stats.total_tokens + EXCLUDED.total_tokens,
        cost_usd = daily_ai_usage_stats.cost_usd + EXCLUDED.cost_usd,
        cost_vnd = daily_ai_usage_stats.cost_vnd + EXCLUDED.cost_vnd,
        updated_at = NOW();
    `;
  } catch (err: any) {
    logger.warn(`[ai-usage-tracker] Failed to record AI telemetry: ${err?.message || err}`);
  }
}

export function recordAiUsage(payload: RecordAiUsageOptions): void {
  setImmediate(() => {
    recordAiUsageAsync(payload).catch((err) => {
      logger.warn(`[ai-usage-tracker] Background telemetry error: ${err?.message || err}`);
    });
  });
}

export async function cleanupOldAiUsageLogs(
  days = 90,
  client = prisma,
): Promise<number> {
  try {
    const cutoffDate = new Date(Date.now() - days * 86400000);
    const result = await client.aiUsageLog.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    });
    return result.count;
  } catch (err: any) {
    logger.warn(`[ai-usage-tracker] Failed to cleanup old logs: ${err?.message || err}`);
    return 0;
  }
}
