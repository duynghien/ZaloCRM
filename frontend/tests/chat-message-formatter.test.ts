import { describe, it, expect } from 'vitest';
import {
  isDifferentDay,
  formatDateSeparator,
  parseFormattedSegments,
} from '../src/utils/chat-message-formatter';

describe('chat-message-formatter utility', () => {
  describe('isDifferentDay', () => {
    it('should return false for the same calendar day at different times', () => {
      const d1 = new Date(2026, 8, 21, 8, 0, 0);
      const d2 = new Date(2026, 8, 21, 18, 30, 0);
      expect(isDifferentDay(d1, d2)).toBe(false);
      expect(isDifferentDay(d1.toISOString(), d1.toISOString())).toBe(false);
    });

    it('should return true for different calendar days in the same month', () => {
      const d1 = new Date(2026, 8, 20, 23, 59, 59);
      const d2 = new Date(2026, 8, 21, 0, 0, 1);
      expect(isDifferentDay(d1, d2)).toBe(true);
      expect(isDifferentDay(d1.toISOString(), d2.toISOString())).toBe(true);
    });

    it('should return true for different months', () => {
      const d1 = new Date(2026, 8, 30);
      const d2 = new Date(2026, 9, 1);
      expect(isDifferentDay(d1, d2)).toBe(true);
    });

    it('should return true for different years', () => {
      const d1 = new Date(2025, 11, 31);
      const d2 = new Date(2026, 0, 1);
      expect(isDifferentDay(d1, d2)).toBe(true);
    });

    it('should handle null or undefined safely', () => {
      expect(isDifferentDay(null, null)).toBe(false);
      expect(isDifferentDay(undefined, undefined)).toBe(false);
      expect(isDifferentDay(new Date(2026, 8, 21), null)).toBe(true);
      expect(isDifferentDay(null, new Date(2026, 8, 21))).toBe(true);
      expect(isDifferentDay('invalid', new Date(2026, 8, 21))).toBe(true);
      expect(isDifferentDay('invalid', 'invalid')).toBe(false);
    });
  });

  describe('formatDateSeparator', () => {
    // Reference now: Monday 2026-09-21 10:00:00
    const mockNow = new Date(2026, 8, 21, 10, 0, 0);

    it('should return "Hôm nay" for today', () => {
      const today = new Date(2026, 8, 21, 8, 30, 0);
      expect(formatDateSeparator(today, mockNow)).toBe('Hôm nay');
    });

    it('should return "Hôm qua" for yesterday', () => {
      const yesterday = new Date(2026, 8, 20, 22, 15, 0);
      expect(formatDateSeparator(yesterday, mockNow)).toBe('Hôm qua');
    });

    it('should format other days with Vietnamese day abbreviations (T2-T7, CN)', () => {
      // Saturday 2026-09-19 -> T7 19/09/2026
      const sat = new Date(2026, 8, 19, 14, 0, 0);
      expect(formatDateSeparator(sat, mockNow)).toBe('T7 19/09/2026');

      // Sunday 2026-09-13 -> CN 13/09/2026
      const sun = new Date(2026, 8, 13, 9, 0, 0);
      expect(formatDateSeparator(sun, mockNow)).toBe('CN 13/09/2026');

      // Monday 2026-09-14 -> T2 14/09/2026
      const mon = new Date(2026, 8, 14, 9, 0, 0);
      expect(formatDateSeparator(mon, mockNow)).toBe('T2 14/09/2026');

      // Tuesday 2026-09-15 -> T3 15/09/2026
      const tue = new Date(2026, 8, 15, 9, 0, 0);
      expect(formatDateSeparator(tue, mockNow)).toBe('T3 15/09/2026');

      // Wednesday 2026-09-16 -> T4 16/09/2026
      const wed = new Date(2026, 8, 16, 9, 0, 0);
      expect(formatDateSeparator(wed, mockNow)).toBe('T4 16/09/2026');

      // Thursday 2026-09-17 -> T5 17/09/2026
      const thu = new Date(2026, 8, 17, 9, 0, 0);
      expect(formatDateSeparator(thu, mockNow)).toBe('T5 17/09/2026');

      // Friday 2026-09-18 -> T6 18/09/2026
      const fri = new Date(2026, 8, 18, 9, 0, 0);
      expect(formatDateSeparator(fri, mockNow)).toBe('T6 18/09/2026');
    });

    it('should pad single-digit day and month with leading zero', () => {
      // 2026-04-05 (Sunday)
      const date = new Date(2026, 3, 5, 12, 0, 0);
      expect(formatDateSeparator(date, mockNow)).toBe('CN 05/04/2026');
    });

    it('should return empty string for null, undefined, or invalid dates', () => {
      expect(formatDateSeparator(null, mockNow)).toBe('');
      expect(formatDateSeparator(undefined, mockNow)).toBe('');
      expect(formatDateSeparator('', mockNow)).toBe('');
      expect(formatDateSeparator('invalid-date', mockNow)).toBe('');
    });
  });

  describe('parseFormattedSegments', () => {
    it('should return empty array for empty or null content', () => {
      expect(parseFormattedSegments(null)).toEqual([]);
      expect(parseFormattedSegments(undefined)).toEqual([]);
      expect(parseFormattedSegments('')).toEqual([]);
    });

    it('should return single text segment for plain text without dividers', () => {
      const text = 'Xin chào bạn!\nChúc một ngày tốt lành.';
      const segments = parseFormattedSegments(text);
      expect(segments).toEqual([
        { type: 'text', content: 'Xin chào bạn!\nChúc một ngày tốt lành.' },
      ]);
    });

    it('should detect standard ASCII dash dividers (---)', () => {
      const raw = 'Tiêu đề\n---\nNội dung';
      const segments = parseFormattedSegments(raw);
      expect(segments).toEqual([
        { type: 'text', content: 'Tiêu đề' },
        { type: 'divider' },
        { type: 'text', content: 'Nội dung' },
      ]);
    });

    it('should detect Unicode box-drawing dividers (───)', () => {
      const raw = 'Báo cáo kiểm toán AI\n────────────────────\nKết quả tốt';
      const segments = parseFormattedSegments(raw);
      expect(segments).toEqual([
        { type: 'text', content: 'Báo cáo kiểm toán AI' },
        { type: 'divider' },
        { type: 'text', content: 'Kết quả tốt' },
      ]);
    });

    it('should detect em dash and en dash dividers (———, –––)', () => {
      const raw = 'Phần 1\n——————\nPhần 2\n––––––\nPhần 3';
      const segments = parseFormattedSegments(raw);
      expect(segments).toEqual([
        { type: 'text', content: 'Phần 1' },
        { type: 'divider' },
        { type: 'text', content: 'Phần 2' },
        { type: 'divider' },
        { type: 'text', content: 'Phần 3' },
      ]);
    });

    it('should detect spaced dividers like "- - -"', () => {
      const raw = 'Trước\n - - - \nSau';
      const segments = parseFormattedSegments(raw);
      expect(segments).toEqual([
        { type: 'text', content: 'Trước' },
        { type: 'divider' },
        { type: 'text', content: 'Sau' },
      ]);
    });

    it('should NOT treat text with dashes as dividers (e.g., bullet points or headers)', () => {
      const raw = '- Mục 1\n- Mục 2\n---\n--- BÁO CÁO ---';
      const segments = parseFormattedSegments(raw);
      expect(segments).toEqual([
        { type: 'text', content: '- Mục 1\n- Mục 2' },
        { type: 'divider' },
        { type: 'text', content: '--- BÁO CÁO ---' },
      ]);
    });

    it('should NOT treat 2 dashes or 3 spaces as dividers', () => {
      const raw = 'Text 1\n--\n   \nText 2';
      const segments = parseFormattedSegments(raw);
      expect(segments).toEqual([
        { type: 'text', content: 'Text 1\n--\n   \nText 2' },
      ]);
    });

    it('should handle content starting or ending with dividers', () => {
      const raw = '───\nNội dung\n───';
      const segments = parseFormattedSegments(raw);
      expect(segments).toEqual([
        { type: 'divider' },
        { type: 'text', content: 'Nội dung' },
        { type: 'divider' },
      ]);
    });
  });
});
