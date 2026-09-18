import { describe, expect, it } from 'vitest';
import {
  calculateAiCost,
  resolveModelPricing,
  AI_PRICING_TABLE,
  DEFAULT_USD_VND_RATE,
} from '../src/modules/ai-reports/ai-pricing-catalog.js';
import { serializeAiUsageStats } from '../src/modules/ai-reports/ai-usage-serializer.js';

describe('ai-pricing-catalog', () => {
  it('calculates cost for gemini-3.6-flash accurately with uncached and cached tokens', () => {
    // gemini-3.6-flash: input $0.075/1M, cached $0.01875/1M, output $0.30/1M
    // 1M uncached input = $0.075, 1M cached input = $0.01875, 1M output = $0.30 -> Total = $0.39375
    const result = calculateAiCost('gemini', 'gemini-3.6-flash', {
      inputTokens: 2_000_000,
      cachedTokens: 1_000_000, // uncached = 1_000_000
      outputTokens: 1_000_000,
    });

    expect(result.costUsd).toBe(0.39375);
    expect(result.costVnd).toBe(BigInt(Math.round(0.39375 * DEFAULT_USD_VND_RATE)));
  });

  it('calculates cost for deepseek-chat with 90% discount on cache hit', () => {
    // deepseek-chat: input $0.14/1M, cached $0.014/1M, output $0.28/1M
    const result = calculateAiCost('deepseek', 'deepseek-chat', {
      inputTokens: 1_000_000,
      cachedTokens: 1_000_000,
      outputTokens: 500_000,
    });

    // uncached = 0, cached = $0.014, output = 0.5 * 0.28 = $0.14 -> Total = $0.154
    expect(result.costUsd).toBe(0.154);
    expect(result.costVnd).toBe(BigInt(Math.round(0.154 * 25400)));
  });

  it('calculates cost for deepseek-flash with $0.15 input, $0.003 cached, and $0.60 output', () => {
    const result = calculateAiCost('deepseek', 'deepseek-flash', {
      inputTokens: 2_000_000,
      cachedTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    expect(result.costUsd).toBe(0.753);
    expect(result.costVnd).toBe(BigInt(Math.round(0.753 * DEFAULT_USD_VND_RATE)));
  });

  it('calculates cost for custom self-hosted model as 0', () => {
    const result = calculateAiCost('custom', 'ollama/llama3', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    expect(result.costUsd).toBe(0);
    expect(result.costVnd).toBe(BigInt(0));
  });

  it('supports custom dynamic exchange rates', () => {
    const customRate = 26000;
    const result = calculateAiCost(
      'openai',
      'gpt-4o-mini',
      {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      },
      customRate,
    );

    // gpt-4o-mini: input $0.15, output $0.60 -> $0.75
    expect(result.costUsd).toBe(0.75);
    expect(result.costVnd).toBe(BigInt(Math.round(0.75 * customRate)));
  });

  it('handles unknown models gracefully with provider fallback and never produces NaN', () => {
    const result = calculateAiCost('gemini', 'gemini-future-super-ai', {
      inputTokens: 100_000,
      outputTokens: 50_000,
    });

    expect(Number.isNaN(result.costUsd)).toBe(false);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.costVnd).toBeGreaterThan(BigInt(0));
  });

  it('safely serializes BigInt fields to Numbers for JSON responses', () => {
    const rawData = {
      id: 'stat-1',
      costVnd: BigInt(154200),
      inputTokens: BigInt(1000),
      outputTokens: BigInt(250),
      cachedTokens: BigInt(50),
      totalTokens: BigInt(1250),
      nested: {
        amount: BigInt(999999),
      },
      items: [{ value: BigInt(10) }, { value: BigInt(20) }],
    };

    const serialized = serializeAiUsageStats(rawData);

    expect(typeof serialized.costVnd).toBe('number');
    expect(serialized.costVnd).toBe(154200);
    expect(typeof serialized.inputTokens).toBe('number');
    expect(serialized.inputTokens).toBe(1000);
    expect(typeof serialized.nested.amount).toBe('number');
    expect(serialized.nested.amount).toBe(999999);
    expect(serialized.items[0].value).toBe(10);
    expect(serialized.items[1].value).toBe(20);
  });
});
