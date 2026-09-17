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
      const primaryType = orgSettings.primaryProvider;
      const providerCfg = orgSettings.providers[primaryType];

      if (!providerCfg?.apiKey) {
        logger.warn(`[chat-copilot] Primary AI provider ${primaryType} has no API key configured for org ${orgId}`);
        return null;
      }

      const businessContext = await this.getOrgBusinessContext(orgId);
      const systemInstruction = ChatCopilotPromptBuilder.buildSystemInstruction(businessContext);
      const userPrompt = ChatCopilotPromptBuilder.buildUserPrompt(conversationId, messages, contact, isGroup);

      const rawText = await callCopilotAiProvider(
        primaryType,
        providerCfg,
        systemInstruction,
        userPrompt,
        { orgId, conversationId },
        signal,
      );
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
