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
  monthlyBudgetVnd?: number;
  usdToVndRate?: number;
}

export interface FallbackTelemetry {
  isFallback: boolean;
  actualModel?: string;
  primaryModel?: string;
  fallbackProvider?: AiProviderType;
  errorReason?: string;
}

export interface UsageTelemetry {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  totalTokens: number;
}

export class IncompleteAiGenerationError extends Error {
  constructor(message = 'Mô hình AI cạn kiệt token trong pha suy luận/sinh văn bản (finish_reason: length).') {
    super(message);
    this.name = 'IncompleteAiGenerationError';
  }
}

export interface GenerateOptions {
  budget: ReportJobBudget;
  attemptKey?: string;
  executionGuard: () => Promise<void>;
  signal?: AbortSignal;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  orgId?: string;
  taskType?: string;
  onUsage?: (usage: UsageTelemetry) => void;
  onFallback?: (telemetry: FallbackTelemetry) => void;
  /** Router-level output validation — if provided and returns false, Router treats the result as a failure and fails over. */
  validateOutput?: (text: string) => boolean;
}

export interface TestConnectionResult {
  success: boolean;
  latencyMs: number;
  message: string;
  modelName: string;
  usage?: UsageTelemetry;
}

export interface AiProvider {
  readonly type: AiProviderType;
  readonly supportsVision: boolean;
  generateContent(prompt: string | ContentPart[], options: GenerateOptions): Promise<string>;
  testConnection(): Promise<TestConnectionResult>;
  estimateTokens(prompt: string | ContentPart[]): Promise<number>;
}
