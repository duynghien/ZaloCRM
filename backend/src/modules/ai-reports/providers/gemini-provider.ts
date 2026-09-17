/**
 * gemini-provider.ts — Google Gemini AI adapter wrapping @google/genai.
 */
import { GoogleGenAI, type ContentListUnion } from '@google/genai';
import { logger } from '../../../shared/utils/logger.js';
import { isReportControlError, runReportExecutionGuard } from '../report-job-budget.js';
import type {
  AiProvider,
  AiProviderConfig,
  ContentPart,
  GenerateOptions,
  TestConnectionResult,
} from './ai-provider-interface.js';
import { estimateTokensHeuristic } from './token-budget-estimator.js';
import { recordAiUsage } from '../ai-usage-tracker.js';

export class GeminiProvider implements AiProvider {
  readonly type = 'gemini' as const;
  readonly supportsVision = true;
  private client: GoogleGenAI | null = null;
  private model: string;
  private apiKey: string;

  constructor(config: AiProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'gemini-2.5-flash';
    if (this.apiKey) {
      this.client = new GoogleGenAI({ apiKey: this.apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
    }
  }

  private getClient(): GoogleGenAI {
    if (!this.client) {
      if (!this.apiKey) {
        throw new Error('GEMINI_API_KEY is not configured for GeminiProvider');
      }
      this.client = new GoogleGenAI({ apiKey: this.apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
    }
    return this.client;
  }

  async estimateTokens(prompt: string | ContentPart[]): Promise<number> {
    try {
      const ai = this.getClient();
      const contents = this.formatContents(prompt);
      const res = await ai.models.countTokens({ model: this.model, contents, config: {} });
      if (Number.isSafeInteger(res.totalTokens) && res.totalTokens! > 0) {
        return res.totalTokens!;
      }
    } catch (err: any) {
      logger.warn(`[gemini-provider] countTokens API failed, falling back to heuristic: ${err?.message}`);
    }
    return estimateTokensHeuristic(prompt);
  }

  private formatContents(prompt: string | ContentPart[], systemInstruction?: string): ContentListUnion {
    let parts: any[];
    if (typeof prompt === 'string') {
      parts = [{ text: prompt }];
    } else {
      parts = prompt.map((part) => {
        if (part.inlineData) {
          return { inlineData: { mimeType: part.inlineData.mimeType, data: part.inlineData.data } };
        }
        return { text: part.text || '' };
      });
    }
    if (systemInstruction) {
      parts = [{ text: systemInstruction }, ...parts];
    }
    return parts;
  }

  async generateContent(prompt: string | ContentPart[], options: GenerateOptions): Promise<string> {
    const ai = this.getClient();
    let lastError: any = null;
    const start = Date.now();

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (options.signal?.aborted) throw new Error('Generation aborted');
        await runReportExecutionGuard(options.executionGuard);

        const contents = this.formatContents(prompt, options.systemInstruction);
        const response = await ai.models.generateContent({
          model: this.model,
          contents,
          config: {
            temperature: options.temperature ?? 0.2,
            maxOutputTokens: options.maxOutputTokens ?? 8192,
          },
        });

        const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
        const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
        const cachedTokens = response.usageMetadata?.cachedContentTokenCount ?? 0;
        const totalTokens = response.usageMetadata?.totalTokenCount ?? (inputTokens + outputTokens);
        const usageTelemetry = { inputTokens, outputTokens, cachedTokens, totalTokens };

        options.onUsage?.(usageTelemetry);

        if (options.orgId && options.taskType) {
          recordAiUsage({
            orgId: options.orgId,
            taskType: options.taskType,
            provider: this.type,
            model: this.model,
            usage: usageTelemetry,
            durationMs: Date.now() - start,
            status: 'success',
          });
        }

        if (options.attemptKey) {
          await options.budget.complete(options.attemptKey, {
            inputTokens,
            outputTokens,
          });
        }

        const text = response.text || '';
        if (!text) throw new Error('Empty response received from Gemini API');
        return text;
      } catch (err: any) {
        if (isReportControlError(err)) throw err;
        lastError = err;
        logger.warn(`[gemini-provider] Attempt ${attempt} failed for model ${this.model}: ${err?.message || err}`);
        if (attempt === 1 && !options.signal?.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    }

    if (options.orgId && options.taskType) {
      recordAiUsage({
        orgId: options.orgId,
        taskType: options.taskType,
        provider: this.type,
        model: this.model,
        usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0 },
        durationMs: Date.now() - start,
        status: 'failed',
        metadata: { error: lastError?.message || String(lastError) },
      });
    }

    throw lastError || new Error(`Gemini API call failed after retries for model ${this.model}`);
  }

  async testConnection(): Promise<TestConnectionResult> {
    const start = Date.now();
    try {
      const ai = this.getClient();
      const response = await ai.models.generateContent({
        model: this.model,
        contents: 'ping',
        config: { maxOutputTokens: 10 },
      });
      const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
      const cachedTokens = response.usageMetadata?.cachedContentTokenCount ?? 0;
      const totalTokens = response.usageMetadata?.totalTokenCount ?? (inputTokens + outputTokens);

      return {
        success: true,
        latencyMs: Date.now() - start,
        message: 'Kết nối thành công tới Gemini',
        modelName: this.model,
        usage: {
          inputTokens,
          outputTokens,
          cachedTokens,
          totalTokens,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        message: err?.message || String(err),
        modelName: this.model,
      };
    }
  }
}
