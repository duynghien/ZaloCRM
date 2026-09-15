/**
 * ai-provider-interface.ts — Standardized interfaces and types for multi-provider AI adapters.
 */
import type { ReportJobBudget } from '../report-job-budget.js';

export type AiProviderType = 'gemini' | 'openai' | 'deepseek' | 'custom';

export interface ContentPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string; // base64
  };
}

export interface AiProviderConfig {
  type: AiProviderType;
  apiKey: string;
  model: string;
  baseUrl?: string;
  supportsVision?: boolean;
  maxTokens?: number;
}

export interface OrgAiProviderSettings {
  primaryProvider: AiProviderType;
  providers: Partial<Record<AiProviderType, AiProviderConfig>>;
  fallbackEnabled: boolean;
  fallbackChain: AiProviderType[];
  allowSystemFallback: boolean;
}

export interface FallbackTelemetry {
  isFallback: boolean;
  actualModel?: string;
  primaryModel?: string;
  fallbackProvider?: AiProviderType;
  errorReason?: string;
}

export interface GenerateOptions {
  budget: ReportJobBudget;
  attemptKey?: string;
  executionGuard: () => Promise<void>;
  signal?: AbortSignal;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  onFallback?: (telemetry: FallbackTelemetry) => void;
}

export interface TestConnectionResult {
  success: boolean;
  latencyMs: number;
  message: string;
  modelName: string;
}

export interface AiProvider {
  readonly type: AiProviderType;
  readonly supportsVision: boolean;
  generateContent(prompt: string | ContentPart[], options: GenerateOptions): Promise<string>;
  testConnection(): Promise<TestConnectionResult>;
  estimateTokens(prompt: string | ContentPart[]): Promise<number>;
}
