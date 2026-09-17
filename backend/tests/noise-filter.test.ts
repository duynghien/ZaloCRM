import { describe, expect, it } from 'vitest';
import {
  isNoiseMessage,
  parseZaloPhotoMessage,
  filterAndFormatMessages,
  type MessageRecordForFilter,
} from '../src/modules/ai-reports/noise-filter.js';

describe('Noise Filter & Transcript Sanitization (Phase 2)', () => {
  it('does not drop photo messages even if content is empty or very short', () => {
    const emptyPhotoMsg: MessageRecordForFilter = {
      id: 'msg-1',
      senderName: 'Hải Anh',
      senderType: 'contact',
      content: '',
      contentType: 'image',
      sentAt: new Date(),
    };
    expect(isNoiseMessage(emptyPhotoMsg)).toBe(false);

    const attachmentPhotoMsg: MessageRecordForFilter = {
      id: 'msg-2',
      senderName: 'Hải Anh',
      senderType: 'contact',
      content: null,
      contentType: 'text',
      attachments: [{ mimeType: 'image/jpeg', url: 'https://photo-stal-01.zdn.vn/a.jpg' }],
      sentAt: new Date(),
    };
    expect(isNoiseMessage(attachmentPhotoMsg)).toBe(false);

    // Normal noise message is still dropped
    const noiseMsg: MessageRecordForFilter = {
      id: 'msg-3',
      senderName: 'User',
      senderType: 'contact',
      content: 'ok',
      contentType: 'text',
      sentAt: new Date(),
    };
    expect(isNoiseMessage(noiseMsg)).toBe(true);
  });

  it('parses Zalo photo JSON, strips newlines, and truncates to 80 chars', () => {
    const jsonStr = JSON.stringify({
      href: 'https://photo-stal-01.zdn.vn/pic.jpg',
      title: 'Bàn giao ca sáng\n\rNhân sự đầy đủ\nKiểm tra khay hoa quả',
      total_item_in_group: 5,
    });

    const parsed = parseZaloPhotoMessage(jsonStr);
    expect(parsed.isPhoto).toBe(true);
    expect(parsed.totalItems).toBe(5);
    expect(parsed.caption).not.toContain('\n');
    expect(parsed.caption).not.toContain('\r');
    expect(parsed.caption).toBe('Bàn giao ca sáng Nhân sự đầy đủ Kiểm tra khay hoa quả');

    // Super long title should truncate to 80 chars
    const longTitle = 'A'.repeat(120);
    const parsedLong = parseZaloPhotoMessage(JSON.stringify({ url: 'http...', title: longTitle }));
    expect(parsedLong.caption?.length).toBe(80);
  });

  it('collapses consecutive photo messages in 60s window into 1 summary line', () => {
    const now = new Date('2026-09-16T05:56:00.000Z');
    const messages: MessageRecordForFilter[] = [];

    // Simulate 18 consecutive photo messages within 60s
    for (let i = 1; i <= 18; i++) {
      messages.push({
        id: `photo-${i}`,
        senderName: 'Hải Anh',
        senderType: 'contact',
        contentType: 'image',
        content: JSON.stringify({
          href: `https://photo-stal-01.zdn.vn/pic-${i}.jpg`,
          title: i === 1 ? 'Checklist máy móc đầu ca chiều' : undefined,
          total_item_in_group: 18,
        }),
        sentAt: new Date(now.getTime() + i * 1000), // each 1s apart
      });
    }

    // Plus 1 regular text message after
    messages.push({
      id: 'text-19',
      senderName: 'Hải Anh',
      senderType: 'contact',
      contentType: 'text',
      content: 'Đã hoàn tất kiểm tra thiết bị nhé cả nhà.',
      sentAt: new Date(now.getTime() + 30000),
    });

    const cleaned = filterAndFormatMessages(messages);
    expect(cleaned).toHaveLength(2);

    // First line should collapse all 18 photos into 1
    expect(cleaned[0].content).toContain('[Đã gửi 18 ảnh: Checklist máy móc đầu ca chiều]');
    expect(cleaned[0].sender).toBe('Hải Anh');

    // Second line is the text message
    expect(cleaned[1].content).toBe('Đã hoàn tất kiểm tra thiết bị nhé cả nhà.');
  });
});
