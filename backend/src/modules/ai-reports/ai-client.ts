/**
 * ai-client.ts — Configured Gemini client with exponential backoff retry and multimodal support.
 */
import { GoogleGenAI } from '@google/genai';
import { config } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';

export interface GenerateContentOptions {
  model?: string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface ContentPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string; // base64
  };
}

let genAIInstance: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI | null {
  if (!config.geminiApiKey) {
    logger.warn('[ai-client] GEMINI_API_KEY is not configured');
    return null;
  }
  if (!genAIInstance) {
    genAIInstance = new GoogleGenAI({ apiKey: config.geminiApiKey });
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

/**
 * Helper to pause execution
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Generate AI content with automatic exponential backoff retry (1 retry after 3s).
 */
export async function generateContent(
  prompt: string | ContentPart[],
  options?: GenerateContentOptions,
): Promise<string> {
  const apiKey = config.geminiApiKey;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required to generate AI reports.');
  }

  const model = options?.model || config.geminiModel;
  const ai = getGenAI();
  if (!ai) {
    throw new Error('Google GenAI client could not be initialized.');
  }

  let lastError: any = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      let contents: any;
      if (typeof prompt === 'string') {
        contents = prompt;
      } else {
        contents = prompt.map((part) => {
          if (part.inlineData) {
            return {
              inlineData: {
                mimeType: part.inlineData.mimeType,
                data: part.inlineData.data,
              },
            };
          }
          return { text: part.text || '' };
        });
      }

      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: options?.systemInstruction,
          temperature: options?.temperature ?? 0.2,
          maxOutputTokens: options?.maxOutputTokens ?? 8192,
        },
      });

      const text = response.text || '';
      if (!text) {
        throw new Error('Empty response received from Gemini API');
      }

      return text;
    } catch (err: any) {
      lastError = err;
      logger.warn(`[ai-client] Attempt ${attempt} failed for model ${model}:`, err?.message || err);

      if (attempt === 1) {
        // Exponential backoff: pause 3s before retry
        await sleep(3000);
      }
    }
  }

  logger.error(`[ai-client] All attempts failed for model ${model}:`, lastError);
  throw lastError || new Error('Gemini API call failed after retries.');
}
