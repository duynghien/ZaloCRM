/**
 * ai-provider-router.ts — Orchestrates primary and fallback AI providers with single-layer budget reservation.
 */
import { logger } from '../../../shared/utils/logger.js';
import { isReportControlError, runReportExecutionGuard } from '../report-job-budget.js';
import type {
  AiProvider,
  AiProviderType,
  ContentPart,
  FallbackTelemetry,
  GenerateOptions,
  OrgAiProviderSettings,
  TestConnectionResult,
} from './ai-provider-interface.js';
import { GeminiProvider } from './gemini-provider.js';
import { OpenAiCompatibleProvider } from './openai-compatible-provider.js';
import { preprocessMultimodalPrompt } from './smart-hybrid-vision-bridge.js';

export function sanitizeErrorReason(raw?: string): string {
  if (!raw) return 'Primary provider error';
  return raw
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]')
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/g, '[IP]')
    .replace(/\b(sk-[a-zA-Z0-9_-]+|[a-zA-Z0-9_-]{24,})\b/g, '[REDACTED]')
    .replace(/bearer\s+[^\s]+/gi, 'bearer [REDACTED]')
    .slice(0, 300);
}

export class AiProviderRouter implements AiProvider {
  readonly type: AiProviderType;
  readonly supportsVision: boolean = true;
  private providers: Map<string, AiProvider> = new Map();
  private primaryProviderKey: string;
  private failoverChainKeys: string[] = [];

  constructor(settings: OrgAiProviderSettings) {
    this.type = settings.primaryProvider;

    // 1. Initialize configured organization providers
    for (const [providerType, cfg] of Object.entries(settings.providers)) {
      if (!cfg || !cfg.apiKey) continue;
      const provider = this.createProviderInstance(cfg.type, cfg);
      this.providers.set(cfg.type, provider);
    }

    // 2. Set primary provider key
    this.primaryProviderKey = settings.primaryProvider;

    // 3. Set fallback chain keys
    if (settings.fallbackEnabled && Array.isArray(settings.fallbackChain)) {
      this.failoverChainKeys = settings.fallbackChain.filter(
        (key) => key !== this.primaryProviderKey && this.providers.has(key),
      );
    }
  }

  private createProviderInstance(type: AiProviderType, cfg: any): AiProvider {
    if (type === 'gemini') {
      return new GeminiProvider(cfg);
    }
    return new OpenAiCompatibleProvider(cfg);
  }

  getProvider(type: string): AiProvider | undefined {
    return this.providers.get(type);
  }

  getVisionProvider(excludeType?: string | string[]): AiProvider | null {
    for (const provider of this.providers.values()) {
      if (excludeType) {
        if (Array.isArray(excludeType) ? excludeType.includes(provider.type) : provider.type === excludeType) {
          continue;
        }
      }
      if (provider.supportsVision) return provider;
    }
    return null;
  }

  async estimateTokens(prompt: string | ContentPart[], systemInstruction?: string): Promise<number> {
    const primary = this.providers.get(this.primaryProviderKey);
    if (primary) {
      return primary.estimateTokens(prompt, systemInstruction);
    }
    // Fallback: use first available provider or heuristic
    const first = this.providers.values().next().value;
    return first ? first.estimateTokens(prompt, systemInstruction) : 1000;
  }

  async generateContent(prompt: string | ContentPart[], options: GenerateOptions): Promise<string> {
    if (options.executionGuard) {
      await runReportExecutionGuard(options.executionGuard);
    }

    const primary = this.providers.get(this.primaryProviderKey);
    if (!primary && this.providers.size === 0) {
      throw new Error(`No AI provider configured for primary type "${this.primaryProviderKey}"`);
    }

    const chain: { key: string; provider: AiProvider }[] = [];
    if (primary) {
      chain.push({ key: this.primaryProviderKey, provider: primary });
    }
    for (const key of this.failoverChainKeys) {
      const p = this.providers.get(key);
      if (p && !chain.some((c) => c.key === key)) {
        chain.push({ key, provider: p });
      }
    }

    const visionProvider = this.getVisionProvider();
    if (options.taskType === 'vision_fact_extraction' && primary && !primary.supportsVision && visionProvider) {
      const visionKey = (visionProvider as any).type || 'vision_fallback';
      const existingIdx = chain.findIndex((c) => c.provider === visionProvider);
      if (existingIdx > 0) {
        const [item] = chain.splice(existingIdx, 1);
        chain.unshift(item);
      } else if (existingIdx === -1) {
        chain.unshift({ key: visionKey, provider: visionProvider });
      }
    } else if (options.taskType === 'vision_fact_extraction' && !visionProvider && (!primary || !primary.supportsVision)) {
      throw new Error('No vision-capable AI provider configured for image fact extraction');
    }

    // Build list of sequential attempts:
    // Primary provider gets 2 attempts (initial + 1 retry for transient failure)
    // Secondary/fallback providers get 1 attempt each
    const attempts: Array<{ key: string; provider: AiProvider; isFallback: boolean }> = [];
    for (let i = 0; i < chain.length; i++) {
      const c = chain[i];
      if (i === 0) {
        attempts.push({ key: c.key, provider: c.provider, isFallback: false });
        attempts.push({ key: c.key, provider: c.provider, isFallback: false });
      } else {
        attempts.push({ key: c.key, provider: c.provider, isFallback: true });
      }
    }

    let lastError: any = null;

    for (let attemptIdx = 0; attemptIdx < attempts.length; attemptIdx++) {
      const { key, provider, isFallback } = attempts[attemptIdx];

      if (options.signal?.aborted) throw new Error('Generation aborted');
      if (options.executionGuard) {
        await runReportExecutionGuard(options.executionGuard);
      }

      // Preprocess prompt if provider does not support vision
      const failedTypes = attempts.slice(0, attemptIdx).map((a) => a.provider.type);
      const effectiveVisionProvider = this.getVisionProvider(failedTypes);
      const preprocessedPrompt = await preprocessMultimodalPrompt(
        prompt,
        provider,
        effectiveVisionProvider,
        options,
      );

      // Explicit per-attempt token estimation & budget reservation (if budget provided)
      const inputTokens = await provider.estimateTokens(preprocessedPrompt, options.systemInstruction);
      let currentAttemptKey: string | undefined;
      let currentMaxOutputTokens: number = options.maxOutputTokens ?? 8192;

      if (options.budget) {
        const requestedOutputTokens = options.maxOutputTokens ?? 8192;
        const reservation = await options.budget.reserve(inputTokens, requestedOutputTokens);
        currentAttemptKey = reservation.attemptKey;
        currentMaxOutputTokens = reservation.maxOutputTokens;
      }

      try {
        const result = await provider.generateContent(preprocessedPrompt, {
          ...options,
          attemptKey: currentAttemptKey,
          maxOutputTokens: currentMaxOutputTokens,
        });

        // Validate output structure if caller provided a validator (e.g. isValidAuditJson)
        if (options.validateOutput && !options.validateOutput(result)) {
          throw new Error(`Đầu ra từ provider ${key} không thỏa mãn cấu trúc dữ liệu yêu cầu`);
        }

        if (isFallback) {
          const primaryCfg = (primary as any)?.model || this.primaryProviderKey;
          const actualCfg = (provider as any)?.model || key;
          logger.warn(`[ai-provider-router] Fallback provider ${key} succeeded after primary failure`);
          options.onFallback?.({
            isFallback: true,
            fallbackProvider: provider.type,
            primaryModel: primaryCfg,
            actualModel: actualCfg,
            errorReason: sanitizeErrorReason(lastError?.message),
          });
        }

        return result;
      } catch (err: any) {
        if (isReportControlError(err) || options.signal?.aborted) {
          throw err; // Stop immediately on control errors or cancellation
        }

        lastError = err;
        const actualUsage = err?.usage ?? (err?.response?.usage ? {
          inputTokens: err.response.usage.prompt_tokens ?? err.response.usage.input_tokens,
          outputTokens: err.response.usage.completion_tokens ?? err.response.usage.output_tokens,
        } : undefined);
        const actualOutput = Number.isSafeInteger(actualUsage?.outputTokens) && actualUsage.outputTokens >= 0 ? actualUsage.outputTokens : undefined;
        const actualInput = Number.isSafeInteger(actualUsage?.inputTokens) && actualUsage.inputTokens >= 0 ? actualUsage.inputTokens : inputTokens;

        logger.warn(`[ai-provider-router] Provider ${key} attempt ${attemptIdx + 1} failed: ${err?.message || err}.`);
        if (options.budget && currentAttemptKey) {
          await Promise.resolve(options.budget.failAttempt?.(currentAttemptKey, { inputTokens: actualInput, outputTokens: actualOutput })).catch(() => {});
        }
      }
    }

    throw lastError || new Error('All AI providers in failover chain failed');
  }

  async testConnection(targetType?: AiProviderType): Promise<TestConnectionResult> {
    const key = targetType || this.primaryProviderKey;
    const provider = this.providers.get(key);
    if (!provider) {
      return {
        success: false,
        latencyMs: 0,
        message: `Nhà cung cấp "${key}" chưa được cấu hình API key`,
        modelName: key,
      };
    }
    return provider.testConnection();
  }
}
