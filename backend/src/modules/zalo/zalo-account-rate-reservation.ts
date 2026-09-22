/**
 * Durable PostgreSQL Atomic Rate Limit Reservation for Zalo Accounts
 *
 * Implements atomic slot reservation on `zalo_account_rate_state` with
 * minimum interval (2s), burst limit (3 / 30s), and daily quota (200 / day).
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

  let state = await tx.zaloAccountRateState.findUnique({
    where: { accountId },
  });

  if (!state) {
    state = await tx.zaloAccountRateState.create({
      data: {
        accountId,
        dateVn,
        dailyCount: 0,
        recentSends: [],
      },
    });
  }

  // Pacing Rule 1: Minimum Interval (2.0s) - MANDATORY, NON-BYPASSABLE
  if (state.lastSendAt && nowMs - state.lastSendAt.getTime() < MIN_INTERVAL_MS) {
    const waitMs = MIN_INTERVAL_MS - (nowMs - state.lastSendAt.getTime());
    throw Object.assign(
      new Error(`Khoảng cách giữa các tin nhắn tối thiểu 2 giây (cần chờ thêm ${Math.ceil(waitMs / 1000)}s)`),
      {
        statusCode: 429,
        canForce: false,
        retryAfter: Math.ceil(waitMs / 1000),
      }
    );
  }

  // Pacing Rule 2: Burst Protection (3 msgs / 30s) - MANDATORY, NON-BYPASSABLE
  const validBurstSends = (state.recentSends || []).filter((t) => nowMs - t.getTime() < BURST_WINDOW_MS);
  if (validBurstSends.length + weight - 1 >= BURST_LIMIT) {
    throw Object.assign(new Error(`Tài khoản gửi quá nhanh (tối đa ${BURST_LIMIT} tin trong 30 giây)`), {
      statusCode: 429,
      canForce: false,
      retryAfter: 30,
    });
  }

  // Pacing Rule 3: Daily Quota (200 msgs) - BYPASSABLE ONLY WITH force=true
  const effectiveDailyCount = state.dateVn === dateVn ? state.dailyCount : 0;
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
