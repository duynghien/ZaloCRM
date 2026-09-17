import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { recordAiUsage } from '../../ai-reports/ai-usage-tracker.js';
import type { AiProviderConfig, AiProviderType } from '../../ai-reports/providers/ai-provider-interface.js';

export function getFastestCopilotModel(type: AiProviderType, config: AiProviderConfig): string {
  if (type === 'gemini') {
    return config.model && config.model.includes('flash') ? config.model : 'gemini-2.5-flash';
  }
  if (type === 'openai') {
    return config.model && config.model.includes('mini') ? config.model : 'gpt-4o-mini';
  }
  if (type === 'deepseek') {
    return 'deepseek-chat';
  }
  return config.model || 'gpt-4o-mini';
}

export async function callCopilotAiProvider(
  providerType: AiProviderType,
  cfg: AiProviderConfig,
  systemInstruction: string,
  prompt: string,
  telemetryContext?: { orgId: string; conversationId?: string },
  signal?: AbortSignal,
): Promise<string> {
  const model = getFastestCopilotModel(providerType, cfg);
  const start = Date.now();

  if (providerType === 'gemini') {
    const client = new GoogleGenAI({ apiKey: cfg.apiKey });
    const contents: any[] = [{ text: systemInstruction }, { text: prompt }];

    const callPromise = client.models.generateContent({
      model,
      contents,
      config: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: 'application/json' },
    });

    try {
      const res = signal
        ? await Promise.race([
            callPromise,
            new Promise<never>((_, reject) => {
              signal.addEventListener('abort', () => reject(new Error('Generation aborted')), { once: true });
            }),
          ])
        : await callPromise;

      if (telemetryContext?.orgId) {
        const inputTokens = res.usageMetadata?.promptTokenCount ?? 0;
        const outputTokens = res.usageMetadata?.candidatesTokenCount ?? 0;
        const cachedTokens = res.usageMetadata?.cachedContentTokenCount ?? 0;
        const totalTokens = res.usageMetadata?.totalTokenCount ?? (inputTokens + outputTokens);

        recordAiUsage({
          orgId: telemetryContext.orgId,
          taskType: 'copilot',
          provider: providerType,
          model,
          usage: { inputTokens, outputTokens, cachedTokens, totalTokens },
          durationMs: Date.now() - start,
          status: 'success',
          metadata: telemetryContext.conversationId ? { conversationId: telemetryContext.conversationId } : undefined,
        });
      }

      return res.text || '';
    } catch (err: any) {
      if (telemetryContext?.orgId && !signal?.aborted) {
        recordAiUsage({
          orgId: telemetryContext.orgId,
          taskType: 'copilot',
          provider: providerType,
          model,
          usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0 },
          durationMs: Date.now() - start,
          status: 'failed',
          metadata: {
            conversationId: telemetryContext.conversationId,
            error: err?.message || String(err),
          },
        });
      }
      throw err;
    }
  }

  // OpenAI, DeepSeek, or Custom OpenAI-compatible
  let baseURL = cfg.baseUrl;
  if (providerType === 'deepseek') baseURL = cfg.baseUrl || 'https://api.deepseek.com';
  else if (providerType === 'openai') baseURL = cfg.baseUrl || 'https://api.openai.com/v1';

  const client = new OpenAI({ apiKey: cfg.apiKey, baseURL, timeout: 15_000 });
  try {
    const completion = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
      },
      { signal },
    );

    if (telemetryContext?.orgId) {
      const inputTokens = completion.usage?.prompt_tokens ?? 0;
      const outputTokens = completion.usage?.completion_tokens ?? 0;
      const cachedTokens = (completion.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0;
      const totalTokens = completion.usage?.total_tokens ?? (inputTokens + outputTokens);

      recordAiUsage({
        orgId: telemetryContext.orgId,
        taskType: 'copilot',
        provider: providerType,
        model,
        usage: { inputTokens, outputTokens, cachedTokens, totalTokens },
        durationMs: Date.now() - start,
        status: 'success',
        metadata: telemetryContext.conversationId ? { conversationId: telemetryContext.conversationId } : undefined,
      });
    }

    return completion.choices[0]?.message?.content || '';
  } catch (err: any) {
    if (telemetryContext?.orgId && !signal?.aborted) {
      recordAiUsage({
        orgId: telemetryContext.orgId,
        taskType: 'copilot',
        provider: providerType,
        model,
        usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0 },
        durationMs: Date.now() - start,
        status: 'failed',
        metadata: {
          conversationId: telemetryContext.conversationId,
          error: err?.message || String(err),
        },
      });
    }
    throw err;
  }
}
