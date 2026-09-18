/**
 * ai-client.ts — Multi-provider AI dispatch with budget reservation, retry, and multimodal support.
 */
import { GoogleGenAI } from '@google/genai';
import { config } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';
import { runReportExecutionGuard, type ReportJobBudget } from './report-job-budget.js';
import type { ContentPart, FallbackTelemetry } from './providers/ai-provider-interface.js';
import { AiProviderRouter } from './providers/ai-provider-router.js';
import {
  getOrgAiProviderCredentials,
  getSystemDefaultAiSettings,
} from './ai-provider-settings-service.js';

export type { ContentPart } from './providers/ai-provider-interface.js';

export interface GenerateContentOptions {
  budget: ReportJobBudget;
  executionGuard: () => Promise<void>;
  orgId?: string;
  taskType?: string;
  signal?: AbortSignal;
  model?: string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  onUsage?: (usage: any) => void;
  onFallback?: (telemetry: FallbackTelemetry) => void;
}

let genAIInstance: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI | null {
  if (!config.geminiApiKey) {
    logger.warn('[ai-client] GEMINI_API_KEY is not configured');
    return null;
  }
  if (!genAIInstance) {
    genAIInstance = new GoogleGenAI({ apiKey: config.geminiApiKey, httpOptions: { retryOptions: { attempts: 1 } } });
  }
  return genAIInstance;
}

export async function validateConfiguredGeminiModel(requireApiKey = false): Promise<boolean> {
  const ai = getGenAI();
  if (!ai) {
    if (requireApiKey) throw new Error('GEMINI_API_KEY is required for the Gemini model smoke check.');
    return false;
  }

  try {
    const model = await ai.models.get({ model: config.geminiModel });
    if (!model.supportedActions?.includes('generateContent')) {
      throw new Error(`Gemini model ${config.geminiModel} does not support generateContent.`);
    }
    logger.info(`[ai-client] Verified configured Gemini model ${config.geminiModel}`);
    return true;
  } catch (error) {
    throw new Error(`Configured Gemini model ${config.geminiModel} is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function validateConfiguredPrimaryModel(requireApiKey = false): Promise<boolean> {
  if (config.aiPrimaryProvider === 'gemini') {
    return validateConfiguredGeminiModel(requireApiKey);
  }
  if (config.aiPrimaryProvider === 'deepseek') {
    if (!config.deepseekApiKey) {
      if (requireApiKey) throw new Error('DEEPSEEK_API_KEY is required for the DeepSeek model smoke check.');
      logger.info(`[ai-client] Primary AI Provider is deepseek (model: ${config.deepseekModel}), waiting for tenant/host key configuration.`);
      return false;
    }
    logger.info(`[ai-client] Verified configured DeepSeek primary model ${config.deepseekModel}`);
    return true;
  }
  logger.info(`[ai-client] AI Primary Provider configured as: ${config.aiPrimaryProvider}`);
  return true;
}

/**
 * Generate AI content via the Multi-Provider AI Adapter & Router.
 */
export async function generateContent(
  prompt: string | ContentPart[],
  options: GenerateContentOptions,
): Promise<string> {
  await runReportExecutionGuard(options.executionGuard);

  const orgSettings = options.orgId
    ? await getOrgAiProviderCredentials(options.orgId)
    : getSystemDefaultAiSettings();

  const router = new AiProviderRouter(orgSettings);

  return router.generateContent(prompt, {
    budget: options.budget,
    executionGuard: options.executionGuard,
    orgId: options.orgId,
    taskType: options.taskType,
    onUsage: options.onUsage,
    signal: options.signal,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
    onFallback: options.onFallback,
  });
}
