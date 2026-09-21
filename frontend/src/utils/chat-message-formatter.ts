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

export interface MessageDateGroup<T = any> {
  dateKey: string;
  dateLabel: string;
  messages: T[];
}

/**
 * Groups messages chronologically by calendar date for sticky date header rendering.
 */
export function groupMessagesByDate<T extends { sentAt: string | Date }>(
  messages: T[],
  now?: Date | string
): MessageDateGroup<T>[] {
  if (!messages || messages.length === 0) return [];

  const groups: MessageDateGroup<T>[] = [];
  let currentGroup: MessageDateGroup<T> | null = null;

  for (const msg of messages) {
    const label = formatDateSeparator(msg.sentAt, now);
    let dateKey = 'unknown';

    if (msg.sentAt) {
      const d = typeof msg.sentAt === 'string' ? new Date(msg.sentAt) : new Date(msg.sentAt.getTime());
      if (!isNaN(d.getTime())) {
        dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
    }

    if (!currentGroup || currentGroup.dateKey !== dateKey) {
      currentGroup = {
        dateKey,
        dateLabel: label,
        messages: [msg],
      };
      groups.push(currentGroup);
    } else {
      currentGroup.messages.push(msg);
    }
  }

  return groups;
}

export interface RenderItemGroup<T = any> {
  dateKey: string;
  dateLabel: string;
  renderItems: T[];
}

/**
 * Groups RenderableItems chronologically by calendar date for sticky date header rendering.
 */
export function groupRenderItemsByDate<T extends { type: string; sentAt?: string | Date; message?: { sentAt: string | Date } }>(
  items: T[],
  now?: Date | string
): RenderItemGroup<T>[] {
  if (!items || items.length === 0) return [];

  const groups: RenderItemGroup<T>[] = [];
  let currentGroup: RenderItemGroup<T> | null = null;

  for (const item of items) {
    const rawSentAt = item.type === 'message' ? item.message?.sentAt : item.sentAt;
    const label = formatDateSeparator(rawSentAt, now);
    let dateKey = 'unknown';

    if (rawSentAt) {
      const d = typeof rawSentAt === 'string' ? new Date(rawSentAt) : new Date(rawSentAt.getTime());
      if (!isNaN(d.getTime())) {
        dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
    }

    if (!currentGroup || currentGroup.dateKey !== dateKey) {
      currentGroup = {
        dateKey,
        dateLabel: label,
        renderItems: [item],
      };
      groups.push(currentGroup);
    } else {
      currentGroup.renderItems.push(item);
    }
  }

  return groups;
}

/**
 * Validate media URL scheme to prevent Stored XSS.
 * Only accepts http:, https:, or /api/v1/attachments/
 */
export function isValidMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('/api/v1/attachments/')) return true;
  if (/^https?:\/\//i.test(trimmed)) return true;
  return false;
}

/** Extract image URL from JSON content or plain URL */
export function getImageUrl(msg: { content: string | null; contentType?: string }): string | null {
  if (!msg.content) return null;
  let url: string | null = null;
  if (msg.contentType === 'image') {
    if (msg.content.startsWith('http') || msg.content.startsWith('/api/v1/attachments/')) {
      url = msg.content;
    } else {
      try {
        const p = JSON.parse(msg.content);
        url = p.href || p.thumb || p.hdUrl || null;
      } catch {}
    }
  } else if (msg.content.startsWith('{')) {
    try {
      const p = JSON.parse(msg.content);
      const href = p.href || p.thumb || '';
      if (href && /\.(jpg|jpeg|png|webp|gif)/i.test(href)) {
        url = href;
      } else if (href && href.includes('zdn.vn') && !p.params?.includes('fileExt')) {
        url = href;
      }
    } catch {}
  }

  if (url && isValidMediaUrl(url)) {
    return url;
  }
  return null;
}

/** Extract file info from JSON content (PDF, docs, etc.) */
export function getFileInfo(msg: { content: string | null }): { name: string; size: string; href: string } | null {
  if (!msg.content?.startsWith('{')) return null;
  try {
    const p = JSON.parse(msg.content);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    if (params?.fileExt || params?.fType === 1) {
      const bytes = parseInt(params.fileSize || '0');
      const size = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
      return { name: p.title || `file.${params.fileExt || 'unknown'}`, size, href: p.href || '' };
    }
  } catch {}
  return null;
}

export function isImageFilenameOrPlaceholder(str: string): boolean {
  const trimmed = str.trim();
  if (!trimmed) return true;
  if (trimmed === '[Hình ảnh]' || trimmed === 'Ảnh' || trimmed === '[Ảnh]') return true;
  if (/\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(trimmed)) return true;
  return false;
}

export function hasCustomCaption(msg: { content: string | null; contentType?: string }): boolean {
  if (!msg.content || !msg.content.trim()) return false;
  if (msg.content === getImageUrl(msg)) return false;
  if (!msg.content.startsWith('{')) return true;
  try {
    const p = JSON.parse(msg.content);
    // Nếu là tin nhắn chia sẻ web link (Link preview) -> Luôn hiển thị
    if (msg.contentType === 'link' || (p.href && p.title && !p.href.includes('zdn.vn') && !p.href.includes('/attachments/'))) {
      return true;
    }
    // Nếu là payload tệp đính kèm (PDF, docs...)
    if (getFileInfo(msg)) {
      return !!(p.description && p.description.trim() && p.description !== p.href && !isImageFilenameOrPlaceholder(p.description));
    }
    // Nếu là payload ảnh Zalo:
    if (p.description && p.description.trim() && p.description !== p.href && !isImageFilenameOrPlaceholder(p.description)) {
      return true;
    }
    if (p.title && p.title.trim() && !p.title.startsWith('http') && !isImageFilenameOrPlaceholder(p.title)) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

export function getDisplayCaption(msg: { content: string | null; contentType?: string }): string {
  if (!msg.content) return '';
  if (!msg.content.startsWith('{')) return msg.content;
  try {
    const p = JSON.parse(msg.content);
    // Link preview thông thường
    if (msg.contentType === 'link' || (p.href && p.title && !p.href.includes('zdn.vn') && !p.href.includes('/attachments/'))) {
      return p.title ? p.title : p.href;
    }
    // Nếu là payload tệp đính kèm (PDF, docs...)
    if (getFileInfo(msg)) {
      if (p.description && p.description !== p.href && !isImageFilenameOrPlaceholder(p.description)) {
        return p.description;
      }
      return '';
    }
    if (p.description && p.description !== p.href && !isImageFilenameOrPlaceholder(p.description)) {
      return p.description;
    }
    if (p.title && !p.title.startsWith('http') && !isImageFilenameOrPlaceholder(p.title)) {
      return p.title;
    }
    return '';
  } catch {
    return msg.content;
  }
}

export function parseDisplayContent(content: string | null): string {
  if (!content) return '';
  if (!content.startsWith('{')) return content;
  try {
    const p = JSON.parse(content);
    if (p.title && p.href) return p.title;
    if (p.title) return p.title;
    if (p.href) return p.description || p.href;
    return content;
  } catch { return content; }
}

export function isReminderMessage(msg: { content: string | null }): boolean {
  if (!msg.content) return false;
  try { const p = JSON.parse(msg.content); return p.action === 'msginfo.actionlist'; } catch { return false; }
}

