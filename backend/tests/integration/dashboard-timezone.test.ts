import { describe, it, expect } from 'vitest';
import { getVnDateString, getVnDayStartUtc } from '../../src/shared/utils/date-utils.js';

describe('Dashboard Timezone & Day Boundary Normalization (Phase 5: F-08)', () => {
  it('correctly maps UTC times to VN calendar dates across midnight boundary', () => {
    // 2026-09-21 16:59:59 UTC = 2026-09-21 23:59:59 VN (UTC+7)
    const lateNightUtc = new Date('2026-09-21T16:59:59.000Z');
    expect(getVnDateString(lateNightUtc)).toBe('2026-09-21');

    const dayStart1 = getVnDayStartUtc(lateNightUtc);
    expect(dayStart1.toISOString()).toBe('2026-09-20T17:00:00.000Z');

    // 2026-09-21 17:00:00 UTC = 2026-09-22 00:00:00 VN (UTC+7)
    const midnightVn = new Date('2026-09-21T17:00:00.000Z');
    expect(getVnDateString(midnightVn)).toBe('2026-09-22');

    const dayStart2 = getVnDayStartUtc(midnightVn);
    expect(dayStart2.toISOString()).toBe('2026-09-21T17:00:00.000Z');
  });

  it('computes exactly 24-hour day window regardless of local system timezone', () => {
    const testInstants = [
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-06-15T12:30:00.000Z'),
      new Date('2026-12-31T23:59:59.000Z'),
    ];

    for (const instant of testInstants) {
      const today = getVnDayStartUtc(instant);
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

      expect(tomorrow.getTime() - today.getTime()).toBe(24 * 60 * 60 * 1000);
      expect(today.getUTCHours()).toBe(17); // 00:00 VN = 17:00 UTC of previous calendar day
      expect(today.getUTCMinutes()).toBe(0);
      expect(today.getUTCSeconds()).toBe(0);
      expect(today.getUTCMilliseconds()).toBe(0);
    }
  });

  it('properly brackets events inside vs outside the VN today range', () => {
    // Current instant: 2026-09-22 10:00:00 VN (03:00:00 UTC)
    const referenceInstant = new Date('2026-09-22T03:00:00.000Z');
    const today = getVnDayStartUtc(referenceInstant); // 2026-09-21T17:00:00.000Z
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000); // 2026-09-22T17:00:00.000Z

    // Event 1 millisecond before VN midnight -> outside
    const yesterdayLate = new Date(today.getTime() - 1);
    expect(yesterdayLate >= today && yesterdayLate < tomorrow).toBe(false);

    // Event at exact start of VN day -> inside
    const todayStart = new Date(today.getTime());
    expect(todayStart >= today && todayStart < tomorrow).toBe(true);

    // Event midday VN -> inside
    const midday = new Date('2026-09-22T05:00:00.000Z');
    expect(midday >= today && midday < tomorrow).toBe(true);

    // Event at exact next day midnight -> outside
    const tomorrowStart = new Date(tomorrow.getTime());
    expect(tomorrowStart >= today && tomorrowStart < tomorrow).toBe(false);
  });
});
