/**
 * ai-model-catalog-service.ts — Dynamic model discovery for supported AI providers.
 */
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { logger } from '../../shared/utils/logger.js';
import type { AiProviderType } from './providers/ai-provider-interface.js';

export interface FetchModelsOptions {
  type: AiProviderType;
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export const DEFAULT_SUGGESTED_MODELS: Record<AiProviderType, string[]> = {
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  custom: ['mistral-small', 'llama-3.3-70b'],
};

export async function fetchProviderModelList(options: FetchModelsOptions): Promise<string[]> {
  const { type, apiKey, timeoutMs = 15_000 } = options;

  if (type === 'gemini') {
    return fetchGeminiModels(apiKey, timeoutMs);
  }

  return fetchOpenAiCompatibleModels(type, apiKey, options.baseUrl, timeoutMs);
}

async function fetchGeminiModels(apiKey: string, timeoutMs: number): Promise<string[]> {
  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { retryOptions: { attempts: 1 }, timeout: timeoutMs },
    });
    const pager = await ai.models.list();
    const models: string[] = [];
    for await (const m of pager) {
      if (m?.name) {
        const clean = m.name.replace(/^models\//, '');
        if (clean.startsWith('gemini-') && !clean.includes('embedding') && !clean.includes('aqa')) {
          models.push(clean);
        }
      }
    }
    if (models.length > 0) {
      return Array.from(new Set(models)).sort();
    }
  } catch (err: any) {
    logger.warn(`[ai-model-catalog] Gemini models list failed: ${err?.message || err}`);
    throw new Error(`Không thể lấy danh sách model từ Gemini: ${err?.message || 'Lỗi kết nối'}`);
  }
  return DEFAULT_SUGGESTED_MODELS.gemini;
}

async function fetchOpenAiCompatibleModels(
  type: AiProviderType,
  apiKey: string,
  rawBaseUrl?: string,
  timeoutMs: number = 15_000,
): Promise<string[]> {
  let baseUrl = rawBaseUrl?.trim();
  if (!baseUrl) {
    if (type === 'deepseek') baseUrl = 'https://api.deepseek.com';
    else if (type === 'openai') baseUrl = 'https://api.openai.com/v1';
    else baseUrl = 'https://api.openai.com/v1';
  }

  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl,
    timeout: timeoutMs,
    maxRetries: 0,
  });

  let list: any;
  try {
    list = await client.models.list();
  } catch (err: any) {
    const normalized = baseUrl.replace(/\/+$/, '');
    if (!normalized.endsWith('/v1')) {
      try {
        const fallbackClient = new OpenAI({
          apiKey,
          baseURL: `${normalized}/v1`,
          timeout: timeoutMs,
          maxRetries: 0,
        });
        list = await fallbackClient.models.list();
      } catch {
        throw new Error(`Không thể lấy danh sách model từ ${type}: ${err?.message || 'Lỗi kết nối'}`);
      }
    } else {
      throw new Error(`Không thể lấy danh sách model từ ${type}: ${err?.message || 'Lỗi kết nối'}`);
    }
  }

  const models: string[] = [];
  for await (const m of list) {
    if (m?.id && typeof m.id === 'string') {
      const id = m.id.trim();
      if (/^[a-zA-Z0-9.:_\/-]+$/.test(id)) {
        models.push(id);
      }
    }
  }

  if (models.length === 0) {
    return DEFAULT_SUGGESTED_MODELS[type] || [];
  }

  return Array.from(new Set(models)).sort();
}
