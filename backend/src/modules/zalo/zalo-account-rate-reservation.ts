/**
 * Durable PostgreSQL Atomic Rate Limit Reservation for Zalo Accounts
 *
 * Implements atomic slot reservation on `zalo_account_rate_state` with
 * minimum interval (2s), burst limit (3 / 30s), and daily quota (200 / day).
 * Uses row-level locking (SELECT ... FOR UPDATE) to prevent concurrency races.
 */

import type { Prisma } from '@prisma/client';
import { getVnDateString } from '../../shared/utils/date-utils.js';

export const DAILY_LIMIT = 200;
export const BURST_LIMIT = 3;            // max messages in BURST_WINDOW_MS
export const BURST_WINDOW_MS = 30_000;    // 30 seconds
export const MIN_INTERVAL_MS = 2_000;     // minimum 2 seconds between consecutive sends

export async function reserveAccountSendSlot(
  tx: Prisma.TransactionClient,
  accountId: string,
  weight: number = 1,
  force?: boolean
): Promise<void> {
  const now = new Date();
  const nowMs = now.getTime();
  const dateVn = getVnDateString(now);

  // 1. Ensure row exists atomically without raising error on conflict
  await tx.$executeRaw`
    INSERT INTO "zalo_account_rate_state" ("account_id", "date_vn", "daily_count", "recent_sends", "updated_at")
    VALUES (${accountId}, ${dateVn}, 0, ARRAY[]::timestamp[], NOW())
    ON CONFLICT ("account_id") DO NOTHING;
  `;

  // 2. Lock row with SELECT ... FOR UPDATE
  const rows = await tx.$queryRaw<Array<{
    account_id: string;
    date_vn: string;
    daily_count: number;
    last_send_at: Date | null;
    recent_sends: Date[] | null;
  }>>`
    SELECT "account_id", "date_vn", "daily_count", "last_send_at", "recent_sends"
    FROM "zalo_account_rate_state"
    WHERE "account_id" = ${accountId}
    FOR UPDATE;
  `;

  const state = rows && rows.length > 0 ? rows[0] : null;
  if (!state) {
    throw new Error(`Failed to acquire rate state lock for account ${accountId}`);
  }

  const lastSendAt = state.last_send_at ? new Date(state.last_send_at) : null;
  const rawRecent = Array.isArray(state.recent_sends) ? state.recent_sends : [];
  const recentSends = rawRecent.map((d: any) => new Date(d));
  const validBurstSends = recentSends.filter((t) => nowMs - t.getTime() < BURST_WINDOW_MS);

  // Pacing Rule 1: Minimum Interval (2.0s) - MANDATORY, NON-BYPASSABLE (even with force=true)
  if (lastSendAt && nowMs - lastSendAt.getTime() < MIN_INTERVAL_MS) {
    const waitMs = MIN_INTERVAL_MS - (nowMs - lastSendAt.getTime());
    throw Object.assign(
      new Error(`Khoảng cách giữa các tin nhắn tối thiểu 2 giây (cần chờ thêm ${Math.ceil(waitMs / 1000)}s)`),
      {
        statusCode: 429,
        canForce: false,
        retryAfter: Math.ceil(waitMs / 1000),
      }
    );
  }

  // Pacing Rule 2: Burst Protection (3 msgs / 30s) - MANDATORY, NON-BYPASSABLE (even with force=true)
  if (validBurstSends.length + weight > BURST_LIMIT) {
    throw Object.assign(new Error(`Tài khoản gửi quá nhanh (tối đa ${BURST_LIMIT} tin trong 30 giây)`), {
      statusCode: 429,
      canForce: false,
      retryAfter: 30,
    });
  }

  // Pacing Rule 3: Daily Quota (200 msgs) - BYPASSABLE ONLY WITH force=true
  const effectiveDailyCount = state.date_vn === dateVn ? state.daily_count : 0;
  if (effectiveDailyCount + weight > DAILY_LIMIT && force !== true) {
    throw Object.assign(new Error(`Tài khoản đã đạt giới hạn an toàn ${DAILY_LIMIT} tin nhắn/ngày`), {
      statusCode: 429,
      canForce: true,
    });
  }

  for (let i = 0; i < weight; i++) {
    validBurstSends.push(now);
  }

  await tx.zaloAccountRateState.update({
    where: { accountId },
    data: {
      dateVn,
      dailyCount: effectiveDailyCount + weight,
      lastSendAt: now,
      recentSends: validBurstSends,
    },
  });
}
