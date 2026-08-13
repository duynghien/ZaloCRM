/**
 * zalo-rate-limiter.ts — Per-account rate limiting and human-like pacing to prevent Zalo account blocks.
 * Enforces daily limits, burst windows, and minimum inter-message delays.
 */

const DAILY_LIMIT = 200;
const BURST_LIMIT = 3;            // max messages in BURST_WINDOW_MS
const BURST_WINDOW_MS = 30_000;    // 30 seconds
const MIN_INTERVAL_MS = 2_000;     // minimum 2 seconds between consecutive sends

class ZaloRateLimiter {
  private dailyCounts = new Map<string, { count: number; date: string }>();
  private recentSends = new Map<string, number[]>(); // timestamps per account
  private lastSendTime = new Map<string, number>();

  /** Check if sending is allowed for accountId */
  checkLimits(accountId: string): { allowed: boolean; reason?: string } {
    const today = new Date().toISOString().split('T')[0];
    const daily = this.dailyCounts.get(accountId);

    // 1. Daily limit check
    if (daily && daily.date === today && daily.count >= DAILY_LIMIT) {
      return { allowed: false, reason: `Đã đạt giới hạn an toàn ${DAILY_LIMIT} tin/ngày` };
    }

    const now = Date.now();

    // 2. Minimum interval check (prevent rapid continuous bot sending)
    const lastSend = this.lastSendTime.get(accountId) || 0;
    const elapsed = now - lastSend;
    if (elapsed < MIN_INTERVAL_MS) {
      const waitSec = Math.ceil((MIN_INTERVAL_MS - elapsed) / 1000);
      return {
        allowed: false,
        reason: `Gửi quá nhanh — vui lòng chờ ${waitSec}s trước khi gửi tin tiếp theo để đảm bảo an toàn tài khoản Zalo`,
      };
    }

    // 3. Burst window check
    const recent = (this.recentSends.get(accountId) || []).filter((t) => now - t < BURST_WINDOW_MS);
    if (recent.length >= BURST_LIMIT) {
      return { allowed: false, reason: `Tần suất gửi quá cao (tối đa ${BURST_LIMIT} tin/30s)` };
    }

    return { allowed: true };
  }

  /** Record a successful send for rate tracking */
  recordSend(accountId: string): void {
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];

    // Update last send timestamp
    this.lastSendTime.set(accountId, now);

    // Update burst window timestamps
    const recent = (this.recentSends.get(accountId) || []).filter((t) => now - t < BURST_WINDOW_MS);
    recent.push(now);
    this.recentSends.set(accountId, recent);

    // Update daily count
    const daily = this.dailyCounts.get(accountId);
    if (daily && daily.date === today) {
      daily.count++;
    } else {
      this.dailyCounts.set(accountId, { count: 1, date: today });
    }
  }

  getDailyCount(accountId: string): number {
    const today = new Date().toISOString().split('T')[0];
    const daily = this.dailyCounts.get(accountId);
    return daily && daily.date === today ? daily.count : 0;
  }
}

export const zaloRateLimiter = new ZaloRateLimiter();
