/**
 * Utility functions for chat message formatting and date separation.
 * Follows Zalo App design patterns and Neo-Brutalism CQA guidelines.
 */

export interface TextSegment {
  type: 'text' | 'divider';
  content?: string;
}

// Matches lines containing only spaces and at least 3 dash / box-drawing characters
const DIVIDER_LINE_REGEX = /^[\s\-\u2500\u2014\u2013]{3,}$/;
const CONTAINS_DASH_REGEX = /[\-\u2500\u2014\u2013]{3,}/;

// TODO: i18n - Vietnamese day abbreviations for Zalo App parity
const VI_DAYS_OF_WEEK = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/**
 * Compare two dates to determine if they fall on different calendar days.
 */
export function isDifferentDay(
  d1: string | Date | null | undefined,
  d2: string | Date | null | undefined
): boolean {
  if (!d1 && !d2) return false;
  if (!d1 || !d2) return true;

  const date1 = typeof d1 === 'string' ? new Date(d1) : new Date(d1.getTime());
  const date2 = typeof d2 === 'string' ? new Date(d2) : new Date(d2.getTime());

  if (isNaN(date1.getTime()) || isNaN(date2.getTime())) {
    return isNaN(date1.getTime()) !== isNaN(date2.getTime());
  }

  return (
    date1.getFullYear() !== date2.getFullYear() ||
    date1.getMonth() !== date2.getMonth() ||
    date1.getDate() !== date2.getDate()
  );
}

/**
 * Format date for the date separator pill:
 * - "Hôm nay" if today
 * - "Hôm qua" if yesterday
 * - "T7 19/09/2026", "CN 20/09/2026", etc. for other dates
 */
export function formatDateSeparator(
  dateStr: string | Date | null | undefined,
  now?: Date | string
): string {
  if (!dateStr) return '';

  const d = typeof dateStr === 'string' ? new Date(dateStr) : new Date(dateStr.getTime());
  if (isNaN(d.getTime())) return '';

  const n = now ? (typeof now === 'string' ? new Date(now) : new Date(now.getTime())) : new Date();
  if (isNaN(n.getTime())) return '';

  const dZero = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const nZero = new Date(n.getFullYear(), n.getMonth(), n.getDate());

  const diffTime = nZero.getTime() - dZero.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Hôm nay';
  if (diffDays === 1) return 'Hôm qua';

  const dow = VI_DAYS_OF_WEEK[d.getDay()];
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();

  return `${dow} ${day}/${month}/${year}`;
}

/**
 * Parse raw text into structured text and divider segments.
 * Chains with parseDisplayContent() output.
 */
export function parseFormattedSegments(rawContent: string | null | undefined): TextSegment[] {
  if (!rawContent) return [];

  const lines = rawContent.split(/\r?\n/);
  const segments: TextSegment[] = [];
  let currentTextLines: string[] = [];

  function flushText() {
    if (currentTextLines.length > 0) {
      segments.push({ type: 'text', content: currentTextLines.join('\n') });
      currentTextLines = [];
    }
  }

  for (const line of lines) {
    const isDivider =
      DIVIDER_LINE_REGEX.test(line) &&
      CONTAINS_DASH_REGEX.test(line.replace(/\s+/g, ''));

    if (isDivider) {
      flushText();
      segments.push({ type: 'divider' });
    } else {
      currentTextLines.push(line);
    }
  }

  flushText();
  return segments;
}
