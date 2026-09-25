/**
 * openai-compatible-provider.ts — Generic OpenAI-compatible AI adapter for OpenAI, DeepSeek, and Custom Gateways.
 */
import OpenAI from 'openai';
import { logger } from '../../../shared/utils/logger.js';
import { isReportControlError, runReportExecutionGuard } from '../report-job-budget.js';
import type {
  AiProvider,
  AiProviderConfig,
  AiProviderType,
  ContentPart,
  GenerateOptions,
  TestConnectionResult,
} from './ai-provider-interface.js';
import { IncompleteAiGenerationError } from './ai-provider-interface.js';
import { estimateTokensHeuristic } from './token-budget-estimator.js';
import { recordAiUsage } from '../ai-usage-tracker.js';

export class OpenAiCompatibleProvider implements AiProvider {
  readonly type: AiProviderType;
  readonly supportsVision: boolean;
  private client: OpenAI;
  private model: string;

  constructor(config: AiProviderConfig) {
    this.type = config.type;
    this.model = config.model;

    // Determine baseURL based on provider type
    let baseURL = config.baseUrl;
    if (this.type === 'openai') {
      baseURL = config.baseUrl || 'https://api.openai.com/v1';
      this.supportsVision = config.supportsVision ?? (this.model.includes('4o') || this.model.includes('vision'));
    } else if (this.type === 'deepseek') {
      baseURL = config.baseUrl || 'https://api.deepseek.com';
      this.supportsVision = Boolean(config.supportsVision) || (/flash|vl|vision/i.test(this.model));
    } else {
      // custom
      this.supportsVision = Boolean(config.supportsVision);
    }

    this.client = new OpenAI({
      apiKey: config.apiKey || 'dummy-key',
      baseURL,
      timeout: 60_000,
      maxRetries: 0, // Router manages retries and failover explicitly
    });
  }

  async estimateTokens(prompt: string | ContentPart[], systemInstruction?: string): Promise<number> {
    return estimateTokensHeuristic(prompt, systemInstruction);
  }

  private formatMessages(prompt: string | ContentPart[], systemInstruction?: string): OpenAI.Chat.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }

    if (typeof prompt === 'string') {
      messages.push({ role: 'user', content: prompt });
    } else {
      const hasImages = prompt.some((p) => Boolean(p.inlineData));
      if (!hasImages) {
        const combinedText = prompt.map((p) => p.text || '').filter(Boolean).join('\n');
        messages.push({ role: 'user', content: combinedText });
      } else {
        const userParts: OpenAI.Chat.ChatCompletionContentPart[] = [];
        for (const part of prompt) {
          if (part.inlineData) {
            userParts.push({
              type: 'image_url',
              image_url: {
                url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
              },
            });
          } else if (part.text) {
            userParts.push({ type: 'text', text: part.text });
          }
        }
        messages.push({ role: 'user', content: userParts });
      }
    }

    return messages;
  }

  async generateContent(prompt: string | ContentPart[], options: GenerateOptions): Promise<string> {
    const start = Date.now();

    try {
      if (options.signal?.aborted) throw new Error('Generation aborted');
      if (options.executionGuard) {
        await runReportExecutionGuard(options.executionGuard);
      }

      const messages = this.formatMessages(prompt, options.systemInstruction);
      const completion = await this.client.chat.completions.create(
        {
          model: this.model,
          messages,
          temperature: options.temperature ?? 0.2,
          max_tokens: options.maxOutputTokens ?? 4096,
          ...(options.responseMimeType === 'application/json' ? { response_format: { type: 'json_object' } } : {}),
        },
        { signal: options.signal },
      );

      const inputTokens = completion.usage?.prompt_tokens ?? 0;
      const outputTokens = completion.usage?.completion_tokens ?? 0;
      const cachedTokens = (completion.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0;
      const totalTokens = completion.usage?.total_tokens ?? (inputTokens + outputTokens);
      const usageTelemetry = { inputTokens, outputTokens, cachedTokens, totalTokens };

      options.onUsage?.(usageTelemetry);

      // GUARD: Check finish_reason BEFORE extracting content — treats CoT token exhaustion
      // as a hard failure regardless of whether content is empty or partially generated.
      if (completion.choices[0]?.finish_reason === 'length') {
        throw new IncompleteAiGenerationError();
      }

      const message = completion.choices[0]?.message;
      const text = message?.content || '';
      if (!text.trim()) throw new Error(`Empty response received from ${this.type} API`);

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

      if (options.attemptKey && options.budget) {
        await options.budget.complete(options.attemptKey, {
          inputTokens,
          outputTokens,
        });
      }

      return text;
    } catch (err: any) {
      if (isReportControlError(err) || err instanceof IncompleteAiGenerationError) {
        throw err;
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
          metadata: { error: err?.message || String(err) },
        });
      }

      throw err;
    }
  }

  async testConnection(): Promise<TestConnectionResult> {
    const start = Date.now();
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
      });

      const inputTokens = completion.usage?.prompt_tokens ?? 0;
      const outputTokens = completion.usage?.completion_tokens ?? 0;
      const cachedTokens = (completion.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0;
      const totalTokens = completion.usage?.total_tokens ?? (inputTokens + outputTokens);

      return {
        success: true,
        latencyMs: Date.now() - start,
        message: `Kết nối thành công tới ${this.type} (${this.model})`,
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
