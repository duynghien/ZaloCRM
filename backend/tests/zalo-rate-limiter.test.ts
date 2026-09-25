import { describe, it, expect, beforeEach } from 'vitest';
import { zaloRateLimiter } from '../src/modules/zalo/zalo-rate-limiter.js';
import { getVnDateString } from '../src/shared/utils/date-utils.js';

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
    const today = getVnDateString();
    (zaloRateLimiter as any).dailyCounts.set(accountId, { count: 200, date: today });

    const limits = zaloRateLimiter.checkLimits(accountId);
    expect(limits.allowed).toBe(false);
    expect(limits.canForce).toBe(true);
    expect(limits.reason).toContain('200 tin/ngày');
  });

  it('unregisters account and purges stale daily counts', () => {
    (zaloRateLimiter as any).dailyCounts.set(accountId, { count: 50, date: '2020-01-01' });
    (zaloRateLimiter as any).lastSendTime.set(accountId, Date.now());
    (zaloRateLimiter as any).recentSends.set(accountId, [Date.now()]);

    zaloRateLimiter.unregisterAccount(accountId);
    expect(zaloRateLimiter.getDailyCount(accountId)).toBe(0);
    expect((zaloRateLimiter as any).lastSendTime.has(accountId)).toBe(false);
    expect((zaloRateLimiter as any).recentSends.has(accountId)).toBe(false);
  });

  it('cleanIdleLimiters evicts accounts idle for more than maxIdleMs', () => {
    const idleAccount = 'acc-idle-old';
    const activeAccount = 'acc-active-new';
    const now = Date.now();
    const twentyFiveHoursAgo = now - 25 * 60 * 60 * 1000;

    (zaloRateLimiter as any).dailyCounts.set(idleAccount, { count: 10, date: '2026-09-24' });
    (zaloRateLimiter as any).lastSendTime.set(idleAccount, twentyFiveHoursAgo);
    (zaloRateLimiter as any).recentSends.set(idleAccount, [twentyFiveHoursAgo]);

    (zaloRateLimiter as any).dailyCounts.set(activeAccount, { count: 5, date: getVnDateString() });
    (zaloRateLimiter as any).lastSendTime.set(activeAccount, now - 60 * 1000);
    (zaloRateLimiter as any).recentSends.set(activeAccount, [now - 60 * 1000]);

    const cleaned = zaloRateLimiter.cleanIdleLimiters(24 * 60 * 60 * 1000);
    expect(cleaned).toBe(1);

    expect((zaloRateLimiter as any).lastSendTime.has(idleAccount)).toBe(false);
    expect((zaloRateLimiter as any).dailyCounts.has(idleAccount)).toBe(false);
    expect((zaloRateLimiter as any).recentSends.has(idleAccount)).toBe(false);

    expect((zaloRateLimiter as any).lastSendTime.has(activeAccount)).toBe(true);
    expect((zaloRateLimiter as any).dailyCounts.has(activeAccount)).toBe(true);
  });
});
