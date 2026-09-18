export interface ModelPricing {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
}

export interface TokenUsageInput {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  totalTokens?: number;
}

export interface AiCostCalculationResult {
  costUsd: number;
  costVnd: bigint;
}

export const DEFAULT_USD_VND_RATE = 25400;

export const AI_PRICING_TABLE: Record<string, ModelPricing> = {
  'gemini-3.6-flash': {
    inputPerMillion: 0.075,
    cachedInputPerMillion: 0.01875,
    outputPerMillion: 0.30,
  },
  'gemini-2.5-flash': {
    inputPerMillion: 0.075,
    cachedInputPerMillion: 0.01875,
    outputPerMillion: 0.30,
  },
  'gemini-2.5-pro': {
    inputPerMillion: 1.25,
    cachedInputPerMillion: 0.3125,
    outputPerMillion: 5.00,
  },
  'gpt-4o-mini': {
    inputPerMillion: 0.15,
    cachedInputPerMillion: 0.075,
    outputPerMillion: 0.60,
  },
  'gpt-4o': {
    inputPerMillion: 2.50,
    cachedInputPerMillion: 1.25,
    outputPerMillion: 10.00,
  },
  'deepseek-flash': {
    inputPerMillion: 0.15,
    cachedInputPerMillion: 0.003,
    outputPerMillion: 0.60,
  },
  'deepseek-chat': {
    inputPerMillion: 0.14,
    cachedInputPerMillion: 0.014,
    outputPerMillion: 0.28,
  },
  'deepseek-reasoner': {
    inputPerMillion: 0.55,
    cachedInputPerMillion: 0.14,
    outputPerMillion: 2.19,
  },
  'custom': {
    inputPerMillion: 0.0,
    cachedInputPerMillion: 0.0,
    outputPerMillion: 0.0,
  },
};

const PROVIDER_FALLBACK_PRICING: Record<string, ModelPricing> = {
  gemini: AI_PRICING_TABLE['gemini-3.6-flash'],
  openai: AI_PRICING_TABLE['gpt-4o-mini'],
  deepseek: AI_PRICING_TABLE['deepseek-flash'],
  custom: AI_PRICING_TABLE['custom'],
};

export function resolveModelPricing(provider: string, model: string): ModelPricing {
  const normalizedModel = (model || '').trim().toLowerCase();
  const normalizedProvider = (provider || '').trim().toLowerCase();

  if (AI_PRICING_TABLE[normalizedModel]) {
    return AI_PRICING_TABLE[normalizedModel];
  }

  // Check prefix match or alias
  for (const [key, pricing] of Object.entries(AI_PRICING_TABLE)) {
    if (normalizedModel.includes(key)) {
      return pricing;
    }
  }

  if (PROVIDER_FALLBACK_PRICING[normalizedProvider]) {
    return PROVIDER_FALLBACK_PRICING[normalizedProvider];
  }

  return {
    inputPerMillion: 0,
    cachedInputPerMillion: 0,
    outputPerMillion: 0,
  };
}

export function calculateAiCost(
  provider: string,
  model: string,
  usage: TokenUsageInput,
  exchangeRate: number = DEFAULT_USD_VND_RATE,
): AiCostCalculationResult {
  const pricing = resolveModelPricing(provider, model);
  const rate = typeof exchangeRate === 'number' && exchangeRate > 0 ? exchangeRate : DEFAULT_USD_VND_RATE;

  const totalInput = Math.max(0, usage.inputTokens ?? 0);
  const cachedTokens = Math.max(0, Math.min(usage.cachedTokens ?? 0, totalInput));
  const uncachedInputTokens = Math.max(0, totalInput - cachedTokens);
  const outputTokens = Math.max(0, usage.outputTokens ?? 0);

  const uncachedCost = (uncachedInputTokens * pricing.inputPerMillion) / 1_000_000;
  const cachedCost = (cachedTokens * pricing.cachedInputPerMillion) / 1_000_000;
  const outputCost = (outputTokens * pricing.outputPerMillion) / 1_000_000;

  let totalCostUsd = uncachedCost + cachedCost + outputCost;
  if (!Number.isFinite(totalCostUsd) || Number.isNaN(totalCostUsd)) {
    totalCostUsd = 0;
  }

  // Round USD to 6 decimal places to prevent float precision oddities
  const roundedUsd = Math.round(totalCostUsd * 1_000_000) / 1_000_000;
  const totalCostVnd = BigInt(Math.round(roundedUsd * rate));

  return {
    costUsd: roundedUsd,
    costVnd: totalCostVnd,
  };
}
