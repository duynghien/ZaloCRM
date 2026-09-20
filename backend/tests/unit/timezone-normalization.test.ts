import { describe, it, expect } from 'vitest';
import { getVnDateString, getVnDayStartUtc } from '../../src/shared/utils/date-utils.js';
import { zaloRateLimiter } from '../../src/modules/zalo/zalo-rate-limiter.js';

describe('Timezone Normalization (Asia/Ho_Chi_Minh UTC+7)', () => {
  it('correctly formats VN date strings across boundaries', () => {
    // 2026-09-20 23:59:59 UTC+7 is 2026-09-20 16:59:59 UTC
    const eveningDate = new Date('2026-09-20T16:59:59.000Z');
    expect(getVnDateString(eveningDate)).toBe('2026-09-20');

    // 2026-09-21 00:00:01 UTC+7 is 2026-09-20 17:00:01 UTC
    const nextDayDate = new Date('2026-09-20T17:00:01.000Z');
    expect(getVnDateString(nextDayDate)).toBe('2026-09-21');

    // Early morning VN: 2026-09-21 01:30:00 UTC+7 is 2026-09-20 18:30:00 UTC
    const earlyMorningDate = new Date('2026-09-20T18:30:00.000Z');
    expect(getVnDateString(earlyMorningDate)).toBe('2026-09-21');
  });

  it('computes exact UTC start of day for VN timezone', () => {
    // For date 2026-09-21 02:00:00 UTC+7, start of day should be 2026-09-21 00:00:00 UTC+7 = 2026-09-20 17:00:00 UTC
    const testDate = new Date('2026-09-20T19:00:00.000Z'); // 02:00 VN on 2026-09-21
    const dayStart = getVnDayStartUtc(testDate);
    expect(dayStart.toISOString()).toBe('2026-09-20T17:00:00.000Z');
  });

  it('zaloRateLimiter tracks daily count using VN date string', () => {
    const accountId = 'acc-vn-test';
    zaloRateLimiter.recordSend(accountId, 'msg-1', false, 1);
    expect(zaloRateLimiter.getDailyCount(accountId)).toBeGreaterThanOrEqual(1);
  });
});
