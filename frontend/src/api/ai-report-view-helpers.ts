import type { GeneratedReportItem, GroupItem, ResendReportPayload } from './ai-report-api';

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
