/**
 * noise-filter.ts — Filters chat noise, greeting spam, stickers, and cleans transcript data for AI processing.
 */

export interface MessageRecordForFilter {
  id: string;
  senderName: string | null;
  senderType: string;
  content: string | null;
  contentType: string;
  attachments?: any;
  sentAt: Date;
}

export interface CleanedMessage {
  id: string;
  sender: string;
  time: string;
  content: string;
  hasAttachmentText: boolean;
}

const NOISE_PHRASES = new Set([
  'ok',
  'oki',
  'oke',
  'okie',
  'ok nhé',
  'ok nha',
  'ok nhe',
  'ok em',
  'ok e',
  'ok anh',
  'ok a',
  'ok chị',
  'ok c',
  'ok bạn',
  'ok ban',
  'ok roi',
  'ok rồi',
  'da',
  'dạ',
  'da a',
  'dạ anh',
  'da c',
  'dạ chị',
  'da e',
  'dạ em',
  'vang',
  'vâng',
  'vang a',
  'vâng ạ',
  'dạ vâng',
  'da vang',
  'dạ vâng ạ',
  'da e cam on',
  'dạ em cảm ơn',
  'cam on',
  'cảm ơn',
  'cảm ơn anh',
  'cảm ơn chị',
  'cảm ơn bạn',
  'cảm ơn cả nhà',
  'thanks',
  'thx',
  'thank',
  'thank you',
  'ty',
  'tks',
  'chao ca nha',
  'chào cả nhà',
  'chúc mọi người ngày mới tốt lành',
  'chúc ngày mới tốt lành',
  'chuc moi nguoi ngay moi tot lanh',
  'hi',
  'hello',
  'alo',
  '+1',
  'like',
  'done',
  'da xong',
  'đã xong',
  'nhan duoc roi',
  'nhận được rồi',
  'e nhan roi',
  'em nhận rồi',
  '.',
  '..',
  '...',
]);

const EMOJI_AND_PUNCTUATION_REGEX = /^[\p{Emoji}\p{Punctuation}\s]+$/u;

/**
 * Parses Zalo photo message content, extracts total_item_in_group and sanitizes captions.
 */
export function parseZaloPhotoMessage(content: string | null): {
  isPhoto: boolean;
  totalItems?: number;
  caption?: string;
} {
  if (!content) return { isPhoto: false };
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { isPhoto: false };
  }
  try {
    const parsed = JSON.parse(trimmed);
    const item = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!item || typeof item !== 'object') return { isPhoto: false };

    const hasPhotoIndicator =
      Boolean(item.href) ||
      Boolean(item.url) ||
      Boolean(item.photoUrl) ||
      Boolean(item.thumb) ||
      item.total_item_in_group !== undefined ||
      item.msgType === 'chat.photo';

    if (!hasPhotoIndicator) return { isPhoto: false };

    const rawCaption = item.title || item.description || item.caption || '';
    const cleanCaption =
      typeof rawCaption === 'string'
        ? rawCaption.replace(/[\r\n]+/g, ' ').trim().slice(0, 80)
        : '';

    const totalItems =
      typeof item.total_item_in_group === 'number' && item.total_item_in_group > 0
        ? item.total_item_in_group
        : undefined;

    return {
      isPhoto: true,
      totalItems,
      caption: cleanCaption || undefined,
    };
  } catch {
    return { isPhoto: false };
  }
}

function hasImageAttachment(msg: MessageRecordForFilter): boolean {
  if (msg.contentType === 'image') return true;
  if (!msg.attachments) return false;
  const atts = Array.isArray(msg.attachments) ? msg.attachments : [msg.attachments];
  for (const att of atts) {
    if (!att) continue;
    const mime = att.mimeType || att.mimetype || '';
    if (mime.startsWith('image/') || att.msgType === 'chat.photo' || att.extension === 'jpg' || att.extension === 'png') {
      return true;
    }
  }
  return false;
}

/**
 * Determines whether a message is noise (empty, sticker, short pleasantry)
 */
export function isNoiseMessage(msg: MessageRecordForFilter): boolean {
  // If message is an image or contains image attachments, keep it!
  if (hasImageAttachment(msg)) {
    return false;
  }

  // If JSON content is a Zalo photo message, keep it!
  if (parseZaloPhotoMessage(msg.content).isPhoto) {
    return false;
  }

  // If message has extracted attachment text or meaningful attachments, keep it!
  if (msg.attachments) {
    const atts = Array.isArray(msg.attachments) ? msg.attachments : [msg.attachments];
    for (const att of atts) {
      if (att?.extractedText && typeof att.extractedText === 'string' && att.extractedText.trim().length > 10) {
        return false;
      }
    }
  }

  // Pure sticker or location without text is noise for reports
  if (msg.contentType === 'sticker' || msg.contentType === 'location') {
    return true;
  }

  const rawContent = (msg.content || '').trim();

  // Empty message
  if (!rawContent) {
    return true;
  }

  // Very short message (< 3 chars)
  if (rawContent.length < 3) {
    return true;
  }

  // Pure emoji / punctuation
  if (EMOJI_AND_PUNCTUATION_REGEX.test(rawContent)) {
    return true;
  }

  // Standardized lower case check
  const normalized = rawContent.toLowerCase().replace(/[.,!?;:]/g, '').trim();
  if (NOISE_PHRASES.has(normalized)) {
    return true;
  }

  return false;
}

interface PhotoBatch {
  id: string;
  sender: string;
  firstTime: string;
  sentAt: Date;
  count: number;
  totalItemsHint?: number;
  captions: string[];
}

function flushPhotoBatch(batch: PhotoBatch, result: CleanedMessage[]): void {
  const count = Math.max(batch.count, batch.totalItemsHint || 0);
  const captionText = batch.captions.filter(Boolean).join('; ');
  let content = `[Đã gửi ${count > 1 ? `${count} ảnh` : 'ảnh'}`;
  if (captionText) {
    content += `: ${captionText}`;
  }
  content += ']';

  result.push({
    id: batch.id,
    sender: batch.sender,
    time: batch.firstTime,
    content,
    hasAttachmentText: false,
  });
}

/**
 * Filter an array of messages, removing noise and collapsing multi-photo bursts in a 60s sliding window.
 */
export function filterAndFormatMessages(messages: MessageRecordForFilter[]): CleanedMessage[] {
  const result: CleanedMessage[] = [];
  let currentBatch: PhotoBatch | null = null;

  for (const msg of messages) {
    if (isNoiseMessage(msg)) {
      continue;
    }

    const sender = msg.senderName || (msg.senderType === 'self' ? 'Tôi' : 'Thành viên');
    const msgDate = msg.sentAt ? new Date(msg.sentAt) : new Date();
    const time = msg.sentAt
      ? msgDate.toLocaleTimeString('vi-VN', {
          timeZone: 'Asia/Ho_Chi_Minh',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : '';

    const photoInfo = parseZaloPhotoMessage(msg.content);
    const isPhoto = msg.contentType === 'image' || photoInfo.isPhoto || hasImageAttachment(msg);

    if (isPhoto) {
      const caption = photoInfo.caption;
      if (
        currentBatch &&
        currentBatch.sender === sender &&
        Math.abs(msgDate.getTime() - currentBatch.sentAt.getTime()) <= 60_000
      ) {
        currentBatch.count += 1;
        if (photoInfo.totalItems && (!currentBatch.totalItemsHint || photoInfo.totalItems > currentBatch.totalItemsHint)) {
          currentBatch.totalItemsHint = photoInfo.totalItems;
        }
        if (caption && !currentBatch.captions.includes(caption)) {
          currentBatch.captions.push(caption);
        }
      } else {
        if (currentBatch) {
          flushPhotoBatch(currentBatch, result);
        }
        currentBatch = {
          id: msg.id,
          sender,
          firstTime: time,
          sentAt: msgDate,
          count: 1,
          totalItemsHint: photoInfo.totalItems,
          captions: caption ? [caption] : [],
        };
      }
      continue;
    }

    // If there was an active photo batch before this non-photo message, flush it
    if (currentBatch) {
      flushPhotoBatch(currentBatch, result);
      currentBatch = null;
    }

    let fullContent = (msg.content || '').trim();

    // Check if attachments have extracted text
    let hasAttachmentText = false;
    if (msg.attachments) {
      const atts = Array.isArray(msg.attachments) ? msg.attachments : [msg.attachments];
      for (const att of atts) {
        if (att?.extractedText && typeof att.extractedText === 'string' && att.extractedText.trim().length > 0) {
          hasAttachmentText = true;
          const fileName = att.title || att.filename || 'File đính kèm';
          fullContent += `\n[Trích xuất từ tệp: ${fileName}]\n${att.extractedText.trim()}`;
        }
      }
    }

    result.push({
      id: msg.id,
      sender,
      time,
      content: fullContent,
      hasAttachmentText,
    });
  }

  // Flush remaining batch
  if (currentBatch) {
    flushPhotoBatch(currentBatch, result);
  }

  return result;
}

/**
 * Converts cleaned messages into a text block for LLM prompt context.
 */
export function formatTranscriptForPrompt(cleaned: CleanedMessage[]): string {
  if (cleaned.length === 0) {
    return '(Không có hoạt động hoặc tin nhắn đáng chú ý trong khoảng thời gian này)';
  }

  return cleaned.map((m) => `[${m.time}] ${m.sender}: ${m.content}`).join('\n');
}
