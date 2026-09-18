import type { AiProviderDetail, AiProviderSettings, GeneratedReportItem, GroupItem, ResendReportPayload } from './ai-report-api';

export const ALL_AI_PROVIDERS: Array<'deepseek' | 'gemini' | 'openai' | 'custom'> = [
  'deepseek',
  'gemini',
  'openai',
  'custom',
];

export const DEFAULT_AI_PROVIDERS: Record<'deepseek' | 'gemini' | 'openai' | 'custom', AiProviderDetail> = {
  deepseek: { type: 'deepseek', model: 'deepseek-flash', apiKey: '', baseUrl: '', supportsVision: true },
  gemini: { type: 'gemini', model: 'gemini-2.5-flash', apiKey: '', baseUrl: '', supportsVision: true },
  openai: { type: 'openai', model: 'gpt-4o-mini', apiKey: '', baseUrl: '', supportsVision: true },
  custom: { type: 'custom', model: 'llama-3.3-70b', apiKey: '', baseUrl: '', supportsVision: false },
};

export const MODEL_SUGGESTIONS: Record<string, string[]> = {
  deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  custom: ['mistral-small', 'llama-3.3-70b'],
};

export function createDefaultAiProviderSettings(): AiProviderSettings {
  return {
    isSystemDefault: true,
    primaryProvider: 'deepseek',
    fallbackEnabled: true,
    fallbackChain: ['gemini', 'openai'],
    allowSystemFallback: true,
    providers: {
      deepseek: { ...DEFAULT_AI_PROVIDERS.deepseek },
      gemini: { ...DEFAULT_AI_PROVIDERS.gemini },
      openai: { ...DEFAULT_AI_PROVIDERS.openai },
      custom: { ...DEFAULT_AI_PROVIDERS.custom },
    },
  };
}

export function computeFallbackChain(primary: 'gemini' | 'deepseek' | 'openai' | 'custom'): string[] {
  return ALL_AI_PROVIDERS.filter((p) => p !== primary);
}

export function groupPairKey(group: GroupItem): string {
  return JSON.stringify([group.zaloAccount?.id || '', group.threadId]);
}

export function groupAccountLabel(group: GroupItem): string {
  const account = group.zaloAccount;
  return account ? `${account.displayName || 'Tài khoản Zalo'} (${account.zaloUid || account.id})` : 'Tài khoản không còn khả dụng';
}

export function reportCanResend(report: GeneratedReportItem): boolean {
  return report.targetResolutionStatus === 'verified' && report.targetSchemaVersion === 2
    && Array.isArray(report.sourceTargets) && report.sourceTargets.length > 0;
}

interface ResendAttempt { fingerprint: string; key: string; needsReconciliation?: boolean }
const resendStorageKey = (reportId: string) => `zalocrm.ai-report.resend.${reportId}`;
function readResendAttempt(reportId: string): ResendAttempt | null {
  try { return JSON.parse(sessionStorage.getItem(resendStorageKey(reportId)) || 'null'); }
  catch { return null; }
}

export function resendNeedsReconciliation(reportId: string): boolean {
  return readResendAttempt(reportId)?.needsReconciliation === true;
}

/** Persist before dispatch so an interrupted request also requires reconciliation. */
export function markResendAttemptUncertain(reportId: string) {
  const saved = readResendAttempt(reportId);
  if (saved) sessionStorage.setItem(resendStorageKey(reportId), JSON.stringify({ ...saved, needsReconciliation: true }));
}

/** Explicit acknowledgment prepares a fresh attempt; it never dispatches a request. */
export function reconcileResendAttempt(reportId: string): boolean {
  if (!resendNeedsReconciliation(reportId)) return false;
  sessionStorage.removeItem(resendStorageKey(reportId));
  return true;
}

/** Store only attempt identity + digest, never recipient addresses or report content. */
export async function resendAttemptKey(reportId: string, payload: ResendReportPayload): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  const fingerprint = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  const storageKey = resendStorageKey(reportId);
  const saved = readResendAttempt(reportId);
  if (saved?.fingerprint === fingerprint && saved.key) return saved.key;
  if (saved?.needsReconciliation) throw new Error('Hãy đối soát lượt gửi trước và chọn tạo lượt gửi mới trước khi đổi lựa chọn.');
  const key = crypto.randomUUID();
  sessionStorage.setItem(storageKey, JSON.stringify({ fingerprint, key }));
  return key;
}

export function completeResendAttempt(reportId: string) {
  sessionStorage.removeItem(resendStorageKey(reportId));
}
