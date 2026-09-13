import { describe, it, expect, beforeEach } from 'vitest';
import { zaloRateLimiter } from '../src/modules/zalo/zalo-rate-limiter.js';

describe('ZaloRateLimiter', () => {
  const accountId = 'acc-test-rate-limit';

  beforeEach(() => {
    // Reset internal state for isolated testing
    (zaloRateLimiter as any).dailyCounts.clear();
    (zaloRateLimiter as any).recentSends.clear();
    (zaloRateLimiter as any).lastSendTime.clear();
    (zaloRateLimiter as any).recentMsgIds.clear();
  });

  it('allows send when within all limits', () => {
    const limits = zaloRateLimiter.checkLimits(accountId);
    expect(limits.allowed).toBe(true);
  });

  it('enforces minimum interval between dashboard sends', () => {
    zaloRateLimiter.recordSend(accountId, 'msg-1', false);
    const limits = zaloRateLimiter.checkLimits(accountId);
    expect(limits.allowed).toBe(false);
    expect(limits.canForce).toBe(false);
    expect(limits.reason).toContain('Gửi quá nhanh');
  });

  it('does not enforce interval/burst for external device sends (iPad isolation)', () => {
    // iPad sends a message
    zaloRateLimiter.recordSend(accountId, 'ipad-msg-1', true);

    // Dashboard user checkLimits is still allowed immediately
    const limits = zaloRateLimiter.checkLimits(accountId);
    expect(limits.allowed).toBe(true);
    expect(zaloRateLimiter.getDailyCount(accountId)).toBe(1);
  });

  it('deduplicates recordSend calls with identical zaloMsgId (no double-counting)', () => {
    const msgId = 'unique-zalo-msg-123';
    // Route records send
    zaloRateLimiter.recordSend(accountId, msgId, false);
    expect(zaloRateLimiter.getDailyCount(accountId)).toBe(1);

    // WebSocket echo arrives for the same message
    zaloRateLimiter.recordSend(accountId, msgId, true);
    expect(zaloRateLimiter.getDailyCount(accountId)).toBe(1); // Still 1, NOT 2!
  });

  it('flags daily limit exceeded and indicates canForce: true', () => {
    const today = new Date().toISOString().split('T')[0];
    (zaloRateLimiter as any).dailyCounts.set(accountId, { count: 200, date: today });

    const limits = zaloRateLimiter.checkLimits(accountId);
    expect(limits.allowed).toBe(false);
    expect(limits.canForce).toBe(true);
    expect(limits.reason).toContain('200 tin/ngày');
  });
});
