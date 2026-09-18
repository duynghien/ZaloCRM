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

  private getVisionProvider(): AiProvider | null {
    for (const provider of this.providers.values()) {
      if (provider.supportsVision) return provider;
    }
    return null;
  }

  async estimateTokens(prompt: string | ContentPart[]): Promise<number> {
    const primary = this.providers.get(this.primaryProviderKey);
    if (primary) {
      return primary.estimateTokens(prompt);
    }
    // Fallback: use first available provider or heuristic
    const first = this.providers.values().next().value;
    return first ? first.estimateTokens(prompt) : 1000;
  }

  async generateContent(prompt: string | ContentPart[], options: GenerateOptions): Promise<string> {
    await runReportExecutionGuard(options.executionGuard);

    const primary = this.providers.get(this.primaryProviderKey);
    if (!primary && this.providers.size === 0) {
      throw new Error(`No AI provider configured for primary type "${this.primaryProviderKey}"`);
    }

    // Single Budget Reservation across failover chain
    let attemptKey = options.attemptKey;
    let maxOutputTokens = options.maxOutputTokens ?? 8192;
    if (!attemptKey) {
      const estimatedInputTokens = await this.estimateTokens(prompt);
      const reservation = await options.budget.reserve(estimatedInputTokens, maxOutputTokens);
      attemptKey = reservation.attemptKey;
      maxOutputTokens = reservation.maxOutputTokens;
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

    let lastError: any = null;

    for (let i = 0; i < chain.length; i++) {
      const { key, provider } = chain[i];
      const isFallback = i > 0;

      try {
        if (options.signal?.aborted) throw new Error('Generation aborted');
        await runReportExecutionGuard(options.executionGuard);

        // Preprocess prompt if provider does not support vision
        const preprocessedPrompt = await preprocessMultimodalPrompt(
          prompt,
          provider,
          visionProvider,
          options,
        );

        const result = await provider.generateContent(preprocessedPrompt, {
          ...options,
          attemptKey,
          maxOutputTokens,
        });

        if (isFallback) {
          const primaryCfg = (primary as any)?.model || this.primaryProviderKey;
          const actualCfg = (provider as any)?.model || key;
          logger.warn(`[ai-provider-router] Fallback provider ${key} succeeded after primary failure`);
          options.onFallback?.({
            isFallback: true,
            fallbackProvider: provider.type,
            primaryModel: primaryCfg,
            actualModel: actualCfg,
            errorReason: lastError?.message || 'Primary provider error',
          });
        }

        return result;
      } catch (err: any) {
        if (isReportControlError(err) || options.signal?.aborted) {
          throw err; // Stop immediately on control errors or cancellation
        }

        lastError = err;
        logger.warn(`[ai-provider-router] Provider ${key} failed: ${err?.message || err}. Attempting next provider in chain.`);
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
