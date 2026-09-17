/**
 * chat-copilot-service.ts — Single-Inference AI service for Conversational Copilot.
 * Completely independent of ReportJobBudget and ai_report_jobs.
 */
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { getOrgAiProviderCredentials } from '../../ai-reports/ai-provider-settings-service.js';
import type { AiProviderConfig, AiProviderType } from '../../ai-reports/providers/ai-provider-interface.js';
import { chatCopilotCache } from './chat-copilot-cache.js';
import { ChatCopilotPromptBuilder } from './chat-copilot-prompt-builder.js';
import { normalizeCopilotResult, parseRawCopilotJson } from './chat-copilot-parser.js';
import type {
  CopilotAnalysisResult,
  CopilotContactContext,
  CopilotMessageContext,
} from './chat-copilot-types.js';

export class ChatCopilotService {
  private getFastestModel(type: AiProviderType, config: AiProviderConfig): string {
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

  async getOrgBusinessContext(orgId: string): Promise<string> {
    try {
      const row = await prisma.appSetting.findUnique({
        where: { orgId_settingKey: { orgId, settingKey: 'copilot_settings' } },
      });
      if (row?.valuePlain) {
        const parsed = JSON.parse(row.valuePlain);
        return parsed.copilotBusinessContext || '';
      }
    } catch {}
    return '';
  }

  private async callAiProvider(
    providerType: AiProviderType,
    cfg: AiProviderConfig,
    systemInstruction: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const model = this.getFastestModel(providerType, cfg);

    if (providerType === 'gemini') {
      const client = new GoogleGenAI({ apiKey: cfg.apiKey });
      const contents: any[] = [{ text: systemInstruction }, { text: prompt }];

      const callPromise = client.models.generateContent({
        model,
        contents,
        config: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: 'application/json' },
      });

      if (!signal) {
        const res = await callPromise;
        return res.text || '';
      }

      const res = await Promise.race([
        callPromise,
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('Generation aborted')), { once: true });
        }),
      ]);
      return res.text || '';
    }

    // OpenAI, DeepSeek, or Custom OpenAI-compatible
    let baseURL = cfg.baseUrl;
    if (providerType === 'deepseek') baseURL = cfg.baseUrl || 'https://api.deepseek.com';
    else if (providerType === 'openai') baseURL = cfg.baseUrl || 'https://api.openai.com/v1';

    const client = new OpenAI({ apiKey: cfg.apiKey, baseURL, timeout: 15_000 });
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
    return completion.choices[0]?.message?.content || '';
  }

  async generateCopilotAnalysis(
    orgId: string,
    conversationId: string,
    messages: CopilotMessageContext[],
    contact?: CopilotContactContext | null,
    isGroup = false,
    signal?: AbortSignal,
  ): Promise<CopilotAnalysisResult | null> {
    if (!messages || messages.length === 0) return null;

    const lastMsg = messages[messages.length - 1];
    const cacheKey = `copilot:${conversationId}:${lastMsg.id}`;
    const cached = chatCopilotCache.get(cacheKey);
    if (cached) return cached;

    try {
      if (signal?.aborted) return null;

      const orgSettings = await getOrgAiProviderCredentials(orgId);
      const primaryType = orgSettings.primaryProvider;
      const providerCfg = orgSettings.providers[primaryType];

      if (!providerCfg?.apiKey) {
        logger.warn(`[chat-copilot] Primary AI provider ${primaryType} has no API key configured for org ${orgId}`);
        return null;
      }

      const businessContext = await this.getOrgBusinessContext(orgId);
      const systemInstruction = ChatCopilotPromptBuilder.buildSystemInstruction(businessContext);
      const userPrompt = ChatCopilotPromptBuilder.buildUserPrompt(conversationId, messages, contact, isGroup);

      const rawText = await this.callAiProvider(primaryType, providerCfg, systemInstruction, userPrompt, signal);
      if (signal?.aborted) return null;

      const parsedJson = parseRawCopilotJson(rawText);
      if (!parsedJson) {
        logger.warn(`[chat-copilot] Failed to parse JSON output from AI provider for conv ${conversationId}`);
        return null;
      }

      const normalized = normalizeCopilotResult(conversationId, parsedJson);
      if (normalized) {
        chatCopilotCache.set(cacheKey, normalized);
      }
      return normalized;
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal?.aborted || err?.message?.includes('aborted')) {
        return null;
      }
      logger.error(`[chat-copilot] Execution failed for conversation ${conversationId}:`, err?.message || err);
      return null;
    }
  }
}

export const chatCopilotService = new ChatCopilotService();
