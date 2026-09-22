import type { Prisma } from '@prisma/client';
import { getVnDateString } from '../../shared/utils/date-utils.js';
import { reserveAccountSendSlot } from './zalo-account-rate-reservation.js';

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
    const today = getVnDateString();
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
  isRecentMsgId(accountId: string, threadIdOrMsgId: string, maybeZaloMsgId?: string): boolean {
    const threadId = maybeZaloMsgId ? threadIdOrMsgId : '';
    const zaloMsgId = maybeZaloMsgId || threadIdOrMsgId;
    if (!zaloMsgId) return false;

    if (maybeZaloMsgId) {
      // Thread-scoped check: if threadId is absent, bypass
      if (!threadId) return false;
      const msgKey = `${accountId}:${threadId}:${zaloMsgId}`;
      const cachedAt = this.recentMsgIds.get(msgKey);
      return !!(cachedAt && Date.now() - cachedAt < DEDUP_TTL_MS);
    }

    // Legacy fallback without threadId
    const msgKey = `${accountId}:${zaloMsgId}`;
    const cachedAt = this.recentMsgIds.get(msgKey);
    return !!(cachedAt && Date.now() - cachedAt < DEDUP_TTL_MS);
  }

  /** Record a successful send for rate tracking */
  recordSend(
    accountId: string,
    threadIdOrMsgId?: string | null | string[],
    zaloMsgIdOrIsExternal?: string | null | string[] | boolean,
    isExternal: boolean = false,
    weight: number = 1
  ): void {
    const now = Date.now();
    const today = getVnDateString();

    let threadId = '';
    let rawIds: string | null | string[] | undefined;
    let actualIsExternal = false;
    let actualWeight = 1;

    if (typeof zaloMsgIdOrIsExternal === 'boolean') {
      // Legacy signature: recordSend(accountId, msgId, isExternal, weight)
      threadId = '';
      rawIds = threadIdOrMsgId;
      actualIsExternal = zaloMsgIdOrIsExternal;
      actualWeight = typeof isExternal === 'number' ? isExternal : 1;
    } else if (
      typeof zaloMsgIdOrIsExternal === 'string' ||
      Array.isArray(zaloMsgIdOrIsExternal) ||
      (zaloMsgIdOrIsExternal === null && (typeof isExternal === 'boolean' || typeof weight === 'number'))
    ) {
      // 5-parameter signature: recordSend(accountId, threadId, msgId, isExternal, weight)
      threadId = typeof threadIdOrMsgId === 'string' ? threadIdOrMsgId : '';
      rawIds = zaloMsgIdOrIsExternal;
      actualIsExternal = typeof isExternal === 'boolean' ? isExternal : false;
      actualWeight = typeof weight === 'number' ? weight : 1;
    } else {
      threadId = typeof threadIdOrMsgId === 'string' ? threadIdOrMsgId : '';
      rawIds = undefined;
      actualIsExternal = false;
      actualWeight = 1;
    }

    const idsToCache: string[] = [];
    if (Array.isArray(rawIds)) {
      for (const id of rawIds) {
        if (id) idsToCache.push(id);
      }
    } else if (rawIds) {
      idsToCache.push(rawIds);
    }

    // Deduplication check via recentMsgIds
    let isDuplicate = false;
    for (const id of idsToCache) {
      if (threadId) {
        const threadMsgKey = `${accountId}:${threadId}:${id}`;
        const cachedAt = this.recentMsgIds.get(threadMsgKey);
        if (cachedAt && now - cachedAt < DEDUP_TTL_MS) {
          isDuplicate = true;
        } else {
          this.recentMsgIds.set(threadMsgKey, now);
        }
      }
      // Also cache global key for legacy 2-arg lookups
      const globalMsgKey = `${accountId}:${id}`;
      const globalCached = this.recentMsgIds.get(globalMsgKey);
      if (!threadId && globalCached && now - globalCached < DEDUP_TTL_MS) {
        isDuplicate = true;
      }
      this.recentMsgIds.set(globalMsgKey, now);
    }

    if (this.recentMsgIds.size > 2000) {
      for (const [k, ts] of this.recentMsgIds) {
        if (now - ts >= DEDUP_TTL_MS) this.recentMsgIds.delete(k);
      }
    }

    // Update pacing timestamps only for internal sends (Dashboard / AI)
    if (!actualIsExternal) {
      this.lastSendTime.set(accountId, now);
      const recent = (this.recentSends.get(accountId) || []).filter((t) => now - t < BURST_WINDOW_MS);
      for (let i = 0; i < actualWeight; i++) {
        recent.push(now);
      }
      this.recentSends.set(accountId, recent);
    }

    // Update daily count only if not duplicate
    if (!isDuplicate) {
      const daily = this.dailyCounts.get(accountId);
      const increment = Math.max(1, actualWeight);
      if (daily && daily.date === today) {
        daily.count += increment;
      } else {
        this.dailyCounts.set(accountId, { count: increment, date: today });
      }
    }
  }

  getDailyCount(accountId: string): number {
    const today = getVnDateString();
    const daily = this.dailyCounts.get(accountId);
    return daily && daily.date === today ? daily.count : 0;
  }

  /**
   * Atomic PostgreSQL reservation of a send slot before calling remote Zalo API.
   * Guarantees persistence of rate limits across process restarts and replicas.
   */
  async reserveSendSlot(
    tx: Prisma.TransactionClient,
    accountId: string,
    weight: number = 1,
    force?: boolean
  ): Promise<void> {
    await reserveAccountSendSlot(tx, accountId, weight, force);
    this.recordSend(accountId, '', null, false, weight);
  }
}

export const zaloRateLimiter = new ZaloRateLimiter();
