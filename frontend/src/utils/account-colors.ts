/**
 * Utility functions and palette for Zalo multi-account brand and color management.
 * Follows Neo-Brutalism high-contrast design specifications.
 */

export const NEO_BRUTALISM_PALETTE = [
  '#0068FF', // Zalo Blue
  '#10B981', // Emerald Green
  '#F59E0B', // Amber
  '#EF4444', // Coral / Crimson Red
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#14B8A6', // Teal
  '#F97316', // Bright Orange
  '#6366F1', // Indigo
  '#84CC16', // Lime
  '#D946EF', // Fuchsia
] as const;

/**
 * Returns custom color if valid hex, or a deterministic palette color based on account ID.
 */
export function getDeterministicAccountColor(id?: string | null, customColor?: string | null): string {
  if (customColor && /^#[0-9A-Fa-f]{6}$/.test(customColor.trim())) {
    return customColor.trim().toUpperCase();
  }
  if (!id) return NEO_BRUTALISM_PALETTE[0];

  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % NEO_BRUTALISM_PALETTE.length;
  return NEO_BRUTALISM_PALETTE[index];
}

/**
 * Generates a 2-character monogram abbreviation with multi-tier fallback:
 * branchTag -> displayName -> phone -> zaloUid -> "ZL"
 */
export function getAccountMonogram(
  branch?: string | null,
  name?: string | null,
  phone?: string | null,
  zaloUid?: string | null,
): string {
  if (branch && branch.trim()) {
    const words = branch.trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return branch.trim().slice(0, 2).toUpperCase();
  }

  if (name && name.trim()) {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.trim().slice(0, 2).toUpperCase();
  }

  if (phone && phone.trim()) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length >= 2) {
      return digits.slice(-2);
    }
  }

  if (zaloUid && zaloUid.trim()) {
    return zaloUid.trim().slice(0, 2).toUpperCase();
  }

  return 'ZL';
}

/**
 * Returns either '#FFFFFF' or '#000000' based on the luminance of the given hex color.
 */
export function getContrastTextColor(hexColor?: string | null): string {
  if (!hexColor || !/^#[0-9A-Fa-f]{6}$/.test(hexColor.trim())) {
    return '#FFFFFF';
  }
  const hex = hexColor.trim().replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.65 ? '#111827' : '#FFFFFF';
}
