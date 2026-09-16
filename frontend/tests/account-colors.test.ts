import { describe, it, expect } from 'vitest';
import {
  NEO_BRUTALISM_PALETTE,
  getDeterministicAccountColor,
  getAccountMonogram,
  getContrastTextColor,
} from '../src/utils/account-colors';

describe('account-colors utility', () => {
  it('should have 12 unique colors in the Neo-Brutalism palette', () => {
    expect(NEO_BRUTALISM_PALETTE.length).toBe(12);
    const uniqueColors = new Set(NEO_BRUTALISM_PALETTE);
    expect(uniqueColors.size).toBe(12);
    for (const color of NEO_BRUTALISM_PALETTE) {
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  describe('getDeterministicAccountColor', () => {
    it('should return valid custom hex color when provided', () => {
      expect(getDeterministicAccountColor('acc-1', '#FF5733')).toBe('#FF5733');
      expect(getDeterministicAccountColor('acc-1', '#0068ff')).toBe('#0068FF');
    });

    it('should return deterministic color from palette for the same ID', () => {
      const color1 = getDeterministicAccountColor('account-abc-123');
      const color2 = getDeterministicAccountColor('account-abc-123');
      expect(color1).toBe(color2);
      expect(NEO_BRUTALISM_PALETTE).toContain(color1);
    });

    it('should handle null or undefined gracefully', () => {
      const colorNull = getDeterministicAccountColor(null);
      const colorUndefined = getDeterministicAccountColor(undefined);
      expect(NEO_BRUTALISM_PALETTE).toContain(colorNull);
      expect(NEO_BRUTALISM_PALETTE).toContain(colorUndefined);
    });
  });

  describe('getAccountMonogram', () => {
    it('should extract monogram from branch tag first', () => {
      expect(getAccountMonogram('Hà Nội', 'Sale 1')).toBe('HN');
      expect(getAccountMonogram('Hồ Chí Minh', 'Sale 1')).toBe('HC');
      expect(getAccountMonogram('Brand', 'Sale 1')).toBe('BR');
    });

    it('should fallback to display name when branch tag is empty', () => {
      expect(getAccountMonogram('', 'Nguyễn Văn A')).toBe('NV');
      expect(getAccountMonogram(null, 'Sale Hương')).toBe('SH');
      expect(getAccountMonogram(undefined, 'VIP')).toBe('VI');
    });

    it('should fallback to phone when branch and name are empty', () => {
      expect(getAccountMonogram('', '', '0987654321')).toBe('21');
    });

    it('should fallback to zaloUid when branch, name, and phone are empty', () => {
      expect(getAccountMonogram('', '', '', 'uid_987654')).toBe('UI');
    });

    it('should fallback to "ZL" when all fields are empty or null', () => {
      expect(getAccountMonogram('', '', '', '')).toBe('ZL');
      expect(getAccountMonogram(null, null, null, null)).toBe('ZL');
      expect(getAccountMonogram(undefined, undefined, undefined, undefined)).toBe('ZL');
    });
  });

  describe('getContrastTextColor', () => {
    it('should return dark text for bright colors (luminance > 0.65)', () => {
      expect(getContrastTextColor('#FFFFFF')).toBe('#111827');
      expect(getContrastTextColor('#F59E0B')).toBe('#111827'); // Amber (luminance ~0.66)
      expect(getContrastTextColor('#FFFF00')).toBe('#111827'); // Pure Yellow
      expect(getContrastTextColor('#E2E8F0')).toBe('#111827'); // Light Gray
    });

    it('should return white text for dark colors and medium saturated colors', () => {
      expect(getContrastTextColor('#000000')).toBe('#FFFFFF');
      expect(getContrastTextColor('#1E1B4B')).toBe('#FFFFFF');
      expect(getContrastTextColor('#0068FF')).toBe('#FFFFFF'); // Zalo Blue
      expect(getContrastTextColor('#10B981')).toBe('#FFFFFF'); // Emerald Green
      expect(getContrastTextColor('#EF4444')).toBe('#FFFFFF'); // Coral Red
      expect(getContrastTextColor('#8B5CF6')).toBe('#FFFFFF'); // Purple
    });

    it('should return default safe text (#FFFFFF) for empty or invalid hex', () => {
      expect(getContrastTextColor(null)).toBe('#FFFFFF');
      expect(getContrastTextColor('')).toBe('#FFFFFF');
      expect(getContrastTextColor('invalid')).toBe('#FFFFFF');
    });
  });
});
