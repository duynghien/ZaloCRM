/**
 * chat-copilot-service.ts — Single-Inference AI service for Conversational Copilot.
 * Completely independent of ReportJobBudget and ai_report_jobs.
 */
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { getOrgAiProviderCredentials } from '../../ai-reports/ai-provider-settings-service.js';
import { chatCopilotCache } from './chat-copilot-cache.js';
import { ChatCopilotPromptBuilder } from './chat-copilot-prompt-builder.js';
import { normalizeCopilotResult, parseRawCopilotJson } from './chat-copilot-parser.js';
import { callCopilotAiProvider } from './chat-copilot-ai-caller.js';
import type { AiProviderConfig, AiProviderType } from '../../ai-reports/providers/ai-provider-interface.js';
import type {
  CopilotAnalysisResult,
  CopilotContactContext,
  CopilotMessageContext,
} from './chat-copilot-types.js';

export class ChatCopilotService {
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
      const chain: { type: AiProviderType; cfg: AiProviderConfig }[] = [];
      const primaryType = orgSettings.primaryProvider;
      const primaryCfg = orgSettings.providers[primaryType];
      if (primaryCfg?.apiKey) {
        chain.push({ type: primaryType, cfg: primaryCfg });
      }

      if (orgSettings.fallbackEnabled && Array.isArray(orgSettings.fallbackChain)) {
        for (const fbType of orgSettings.fallbackChain) {
          if (fbType === primaryType) continue;
          const fbCfg = orgSettings.providers[fbType];
          if (fbCfg?.apiKey && !chain.some((c) => c.type === fbType)) {
            chain.push({ type: fbType, cfg: fbCfg });
          }
        }
      }

      if (chain.length === 0) {
        logger.warn(`[chat-copilot] No AI provider with API key configured for org ${orgId}`);
        return null;
      }

      const businessContext = await this.getOrgBusinessContext(orgId);
      const systemInstruction = ChatCopilotPromptBuilder.buildSystemInstruction(businessContext);
      const userPrompt = ChatCopilotPromptBuilder.buildUserPrompt(conversationId, messages, contact, isGroup);

      let rawText: string | null = null;
      let lastError: any = null;

      for (let i = 0; i < chain.length; i++) {
        const { type, cfg } = chain[i];
        const isFallback = i > 0;
        try {
          if (signal?.aborted) return null;
          rawText = await callCopilotAiProvider(
            type,
            cfg,
            systemInstruction,
            userPrompt,
            { orgId, conversationId },
            signal,
          );
          if (isFallback) {
            logger.warn(
              `[chat-copilot] Fallback provider ${type} succeeded after primary failure for conv ${conversationId}`,
            );
          }
          if (rawText) {
            break;
          }
        } catch (err: any) {
          if (err?.name === 'AbortError' || signal?.aborted || err?.message?.includes('aborted')) {
            return null;
          }
          lastError = err;
          logger.warn(
            `[chat-copilot] Provider ${type} failed for conv ${conversationId}: ${err?.message || err}. Attempting next provider in chain.`,
          );
        }
      }

      if (signal?.aborted) return null;
      if (!rawText) {
        if (lastError) {
          logger.error(
            `[chat-copilot] All AI providers in failover chain failed for conversation ${conversationId}:`,
            lastError?.message || lastError,
          );
        }
        return null;
      }

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
