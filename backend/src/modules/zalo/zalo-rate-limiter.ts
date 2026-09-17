/**
 * zalo-rate-limiter.ts — Per-account rate limiting and human-like pacing to prevent Zalo account blocks.
 * Enforces daily limits, burst windows, and minimum inter-message delays.
 */

const DAILY_LIMIT = 200;
const BURST_LIMIT = 3;            // max messages in BURST_WINDOW_MS
const BURST_WINDOW_MS = 30_000;    // 30 seconds
const MIN_INTERVAL_MS = 2_000;     // minimum 2 seconds between consecutive sends
const DEDUP_TTL_MS = 60_000;       // 60 seconds dedup cache TTL

class ZaloRateLimiter {
  private dailyCounts = new Map<string, { count: number; date: string }>();
  private recentSends = new Map<string, number[]>(); // timestamps per account
  private lastSendTime = new Map<string, number>();
  private recentMsgIds = new Map<string, number>();  // msgKey -> timestamp for dedup

  /** Check if sending is allowed for accountId */
  checkLimits(accountId: string, weight: number = 1): { allowed: boolean; reason?: string; canForce?: boolean } {
    const today = new Date().toISOString().split('T')[0];
    const daily = this.dailyCounts.get(accountId);

    // 1. Daily limit check
    if (daily && daily.date === today && daily.count + (weight - 1) >= DAILY_LIMIT) {
      return {
        allowed: false,
        reason: `Đã đạt giới hạn an toàn ${DAILY_LIMIT} tin/ngày`,
        canForce: true,
      };
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
        canForce: false,
      };
    }

    // 3. Burst window check
    const recent = (this.recentSends.get(accountId) || []).filter((t) => now - t < BURST_WINDOW_MS);
    if (recent.length + (weight - 1) >= BURST_LIMIT) {
      return {
        allowed: false,
        reason: `Tần suất gửi quá cao (tối đa ${BURST_LIMIT} tin/30s)`,
        canForce: false,
      };
    }

    return { allowed: true };
  }

  /** Check if a message ID was recently sent from CRM (for echo loop prevention) */
  isRecentMsgId(accountId: string, zaloMsgId: string): boolean {
    if (!zaloMsgId) return false;
    const msgKey = `${accountId}:${zaloMsgId}`;
    const cachedAt = this.recentMsgIds.get(msgKey);
    if (cachedAt && Date.now() - cachedAt < DEDUP_TTL_MS) {
      return true;
    }
    return false;
  }

  /** Record a successful send for rate tracking */
  recordSend(accountId: string, zaloMsgId?: string | null | string[], isExternal: boolean = false, weight: number = 1): void {
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];

    const idsToCache: string[] = [];
    if (Array.isArray(zaloMsgId)) {
      for (const id of zaloMsgId) {
        if (id) idsToCache.push(id);
      }
    } else if (zaloMsgId) {
      idsToCache.push(zaloMsgId);
    }

    // Deduplication check via recentMsgIds
    let isDuplicate = false;
    for (const id of idsToCache) {
      const msgKey = `${accountId}:${id}`;
      const cachedAt = this.recentMsgIds.get(msgKey);
      if (cachedAt && now - cachedAt < DEDUP_TTL_MS) {
        isDuplicate = true;
      } else {
        this.recentMsgIds.set(msgKey, now);
      }
    }

    if (this.recentMsgIds.size > 2000) {
      for (const [k, ts] of this.recentMsgIds) {
        if (now - ts >= DEDUP_TTL_MS) this.recentMsgIds.delete(k);
      }
    }

    // Update pacing timestamps only for internal sends (Dashboard / AI)
    if (!isExternal) {
      this.lastSendTime.set(accountId, now);
      const recent = (this.recentSends.get(accountId) || []).filter((t) => now - t < BURST_WINDOW_MS);
      for (let i = 0; i < weight; i++) {
        recent.push(now);
      }
      this.recentSends.set(accountId, recent);
    }

    // Update daily count only if not duplicate
    if (!isDuplicate) {
      const daily = this.dailyCounts.get(accountId);
      const increment = Math.max(1, weight);
      if (daily && daily.date === today) {
        daily.count += increment;
      } else {
        this.dailyCounts.set(accountId, { count: increment, date: today });
      }
    }
  }

  getDailyCount(accountId: string): number {
    const today = new Date().toISOString().split('T')[0];
    const daily = this.dailyCounts.get(accountId);
    return daily && daily.date === today ? daily.count : 0;
  }
}

export const zaloRateLimiter = new ZaloRateLimiter();
