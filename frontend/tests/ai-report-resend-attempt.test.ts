import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeResendAttempt, markResendAttemptUncertain, reconcileResendAttempt,
  resendAttemptKey, resendNeedsReconciliation,
} from '../src/api/ai-report-view-helpers';

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) || null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

const payload = { send_email: true, email_recipients: ['private@example.com'] };

describe('explicit resend reconciliation', () => {
  it('ordinary retry retains the key and uncertainty survives reopening', async () => {
    const key = await resendAttemptKey('report', payload);
    markResendAttemptUncertain('report');
    expect(resendNeedsReconciliation('report')).toBe(true);
    expect(await resendAttemptKey('report', { ...payload })).toBe(key);
    expect(resendNeedsReconciliation('report')).toBe(true);
    expect([...storage.values()].join()).not.toContain('private@example.com');
  });

  it('explicit reconciliation clears only this attempt, then a later submit obtains a fresh key', async () => {
    const oldKey = await resendAttemptKey('report', payload);
    const otherKey = await resendAttemptKey('other', payload);
    markResendAttemptUncertain('report');
    expect(reconcileResendAttempt('report')).toBe(true);
    expect(resendNeedsReconciliation('report')).toBe(false);
    expect(storage.has('zalocrm.ai-report.resend.report')).toBe(false);
    // Reconciliation itself creates no new attempt and makes no outbound request.
    expect(await resendAttemptKey('other', payload)).toBe(otherKey);
    expect(await resendAttemptKey('report', payload)).not.toBe(oldKey);
  });

  it('editing recipients cannot bypass an unresolved attempt', async () => {
    const key = await resendAttemptKey('report', payload);
    markResendAttemptUncertain('report');
    await expect(resendAttemptKey('report', { ...payload, email_recipients: ['changed@example.com'] }))
      .rejects.toThrow('đối soát');
    expect(await resendAttemptKey('report', payload)).toBe(key);
    reconcileResendAttempt('report');
    expect(await resendAttemptKey('report', { ...payload, email_recipients: ['changed@example.com'] })).not.toBe(key);
  });

  it('a successful attempt clears uncertainty and unused attempts cannot be reconciled', async () => {
    await resendAttemptKey('report', payload);
    expect(reconcileResendAttempt('report')).toBe(false);
    markResendAttemptUncertain('report');
    completeResendAttempt('report');
    expect(resendNeedsReconciliation('report')).toBe(false);
    expect(storage.size).toBe(0);
  });
});
