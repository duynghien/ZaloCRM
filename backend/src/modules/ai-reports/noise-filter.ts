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
 * Determines whether a message is noise (empty, sticker, short pleasantry)
 */
export function isNoiseMessage(msg: MessageRecordForFilter): boolean {
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

/**
 * Filter an array of messages, removing noise and formatting into clean transcript lines.
 */
export function filterAndFormatMessages(messages: MessageRecordForFilter[]): CleanedMessage[] {
  const result: CleanedMessage[] = [];

  for (const msg of messages) {
    if (isNoiseMessage(msg)) {
      continue;
    }

    const sender = msg.senderName || (msg.senderType === 'self' ? 'Tôi' : 'Thành viên');
    const time = msg.sentAt
      ? new Date(msg.sentAt).toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : '';

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

  return result;
}

/**
 * Converts cleaned messages into a text block for LLM prompt context.
 */
export function formatTranscriptForPrompt(cleaned: CleanedMessage[]): string {
  if (cleaned.length === 0) {
    return '(Không có hoạt động hoặc tin nhắn đáng chú ý trong khoảng thời gian này)';
  }

  return cleaned
    .map((m) => `[${m.time}] ${m.sender}: ${m.content}`)
    .join('\n');
}
