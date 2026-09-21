import { describe, it, expect } from 'vitest';
import type { Message } from '../src/composables/use-chat';
import {
  clusterMessagesIntoRenderItems,
  getRenderItemKey,
  type PhotoAlbumItem,
} from '../src/utils/chat-message-clustering';
import { getImageUrl, isValidMediaUrl } from '../src/utils/chat-message-formatter';

describe('chat-message-clustering utility', () => {
  const baseTime = new Date('2026-09-21T10:00:00.000Z').getTime();

  function createMsg(overrides: Partial<Message> = {}): Message {
    return {
      id: `msg-${Math.random().toString(36).substring(2, 9)}`,
      content: 'Hello',
      contentType: 'text',
      senderType: 'contact',
      senderUid: 'user-123',
      senderName: 'Nguyen Van A',
      sentAt: new Date(baseTime).toISOString(),
      isDeleted: false,
      zaloMsgId: null,
      ...overrides,
    };
  }

  function createImageMsg(idx: number, timeOffsetSec = 0, overrides: Partial<Message> = {}): Message {
    return createMsg({
      id: `img-msg-${idx}`,
      contentType: 'image',
      content: JSON.stringify({
        href: `https://zdn.vn/photo/${idx}.jpg`,
        hdUrl: `https://zdn.vn/photo/${idx}_hd.jpg`,
        title: `photo_${idx}.jpg`,
      }),
      sentAt: new Date(baseTime + timeOffsetSec * 1000).toISOString(),
      ...overrides,
    });
  }

  it('preserves single image message without clustering into album', () => {
    const singleImg = createImageMsg(1);
    const result = clusterMessagesIntoRenderItems([singleImg]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('message');
    if (result[0].type === 'message') {
      expect(result[0].message.id).toBe('img-msg-1');
    }
  });

  it('clusters 12 consecutive image messages with a trailing caption within 8s into 1 album', () => {
    const messages: Message[] = [];
    for (let i = 1; i <= 12; i++) {
      messages.push(createImageMsg(i, i * 2)); // 2s apart
    }

    const captionMsg = createMsg({
      id: 'caption-1',
      content: 'em gửi bc kv cuối ca chiều đầu ca tối',
      contentType: 'text',
      sentAt: new Date(baseTime + 24 * 1000 + 5 * 1000).toISOString(), // 5s after last image
    });
    messages.push(captionMsg);

    const result = clusterMessagesIntoRenderItems(messages);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('album');

    const album = result[0] as PhotoAlbumItem;
    expect(album.id).toBe('album-img-msg-1');
    expect(album.images).toHaveLength(12);
    expect(album.images[0].url).toBe('https://zdn.vn/photo/1.jpg');
    expect(album.images[0].hdUrl).toBe('https://zdn.vn/photo/1_hd.jpg');
    expect(album.caption).toBe('em gửi bc kv cuối ca chiều đầu ca tối');
    expect(album.captionMessageId).toBe('caption-1');
    expect(album.sourceMessageIds).toHaveLength(13);
    expect(album.isDeleted).toBe(false);
  });

  it('does not absorb text sent before the image cluster as caption', () => {
    const textBefore = createMsg({
      id: 'text-before',
      content: 'Chuẩn bị gửi ảnh nhé',
      sentAt: new Date(baseTime - 5000).toISOString(),
    });
    const img1 = createImageMsg(1, 0);
    const img2 = createImageMsg(2, 2);

    const result = clusterMessagesIntoRenderItems([textBefore, img1, img2]);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('message');
    if (result[0].type === 'message') {
      expect(result[0].message.id).toBe('text-before');
    }
    expect(result[1].type).toBe('album');
    const album = result[1] as PhotoAlbumItem;
    expect(album.images).toHaveLength(2);
    expect(album.caption).toBeNull();
  });

  it('does not absorb text sent > 8s after the last image into album caption', () => {
    const img1 = createImageMsg(1, 0);
    const img2 = createImageMsg(2, 2);
    const textLate = createMsg({
      id: 'text-late',
      content: 'Tin nhắn gửi 12s sau ảnh, không phải caption',
      sentAt: new Date(baseTime + 2 * 1000 + 12 * 1000).toISOString(), // 12s after img2
    });

    const result = clusterMessagesIntoRenderItems([img1, img2, textLate]);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('album');
    expect((result[0] as PhotoAlbumItem).caption).toBeNull();
    expect(result[1].type).toBe('message');
    if (result[1].type === 'message') {
      expect(result[1].message.id).toBe('text-late');
    }
  });

  it('preserves intrinsic caption from image payload and does not absorb subsequent text message', () => {
    const imgWithCaption = createMsg({
      id: 'img-with-cap',
      contentType: 'image',
      content: JSON.stringify({
        href: 'https://zdn.vn/photo/1.jpg',
        title: 'photo_1.jpg',
        description: 'Báo cáo doanh thu tháng 9',
      }),
      sentAt: new Date(baseTime).toISOString(),
    });
    const img2 = createImageMsg(2, 2);
    const followUpMsg = createMsg({
      id: 'follow-up',
      content: 'Anh xem giúp em nhé',
      contentType: 'text',
      sentAt: new Date(baseTime + 5000).toISOString(), // 3s after img2
    });

    const result = clusterMessagesIntoRenderItems([imgWithCaption, img2, followUpMsg]);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('album');
    const album = result[0] as PhotoAlbumItem;
    expect(album.caption).toBe('Báo cáo doanh thu tháng 9');
    expect(album.captionMessageId).toBe('img-with-cap');

    // followUpMsg must remain an independent message!
    expect(result[1].type).toBe('message');
    if (result[1].type === 'message') {
      expect(result[1].message.id).toBe('follow-up');
      expect(result[1].message.content).toBe('Anh xem giúp em nhé');
    }
  });

  it('does not cluster images when another sender message intervenes', () => {
    const img1 = createImageMsg(1, 0, { senderUid: 'user-1' });
    const otherMsg = createMsg({
      id: 'other-msg',
      content: 'Chào bạn',
      senderUid: 'user-2',
      sentAt: new Date(baseTime + 2000).toISOString(),
    });
    const img2 = createImageMsg(2, 4, { senderUid: 'user-1' });

    const result = clusterMessagesIntoRenderItems([img1, otherMsg, img2]);

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('message');
    expect(result[1].type).toBe('message');
    expect(result[2].type).toBe('message');
  });

  it('does not cluster images when time difference > 60s', () => {
    const img1 = createImageMsg(1, 0);
    const img2 = createImageMsg(2, 70); // 70s later

    const result = clusterMessagesIntoRenderItems([img1, img2]);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('message');
    expect(result[1].type).toBe('message');
  });

  it('excludes mixed-media messages with non-image attachments from clustering', () => {
    const mixedMsg = createMsg({
      id: 'mixed-msg',
      contentType: 'file',
      attachments: [
        { url: '/api/v1/attachments/photo.png', filename: 'photo.png', mimeType: 'image/png' },
        { url: '/api/v1/attachments/contract.pdf', filename: 'contract.pdf', mimeType: 'application/pdf' },
      ],
      sentAt: new Date(baseTime).toISOString(),
    });

    const imgMsg = createImageMsg(1, 2);

    const result = clusterMessagesIntoRenderItems([mixedMsg, imgMsg]);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('message');
    expect(result[1].type).toBe('message');
  });

  it('does not absorb reminder message as caption', () => {
    const img1 = createImageMsg(1, 0);
    const img2 = createImageMsg(2, 2);
    const reminderMsg = createMsg({
      id: 'reminder-1',
      content: JSON.stringify({
        action: 'msginfo.actionlist',
        title: 'Lịch hẹn tư vấn',
        params: JSON.stringify({ highLightsV2: [{ ts: baseTime + 86400000 }] }),
      }),
      contentType: 'text',
      sentAt: new Date(baseTime + 5000).toISOString(),
    });

    const result = clusterMessagesIntoRenderItems([img1, img2, reminderMsg]);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('album');
    expect((result[0] as PhotoAlbumItem).caption).toBeNull();
    expect(result[1].type).toBe('message');
    if (result[1].type === 'message') {
      expect(result[1].message.id).toBe('reminder-1');
    }
  });

  it('does not cluster images from different senderUid even with same senderType and senderName', () => {
    const img1 = createImageMsg(1, 0, {
      senderUid: 'uid-alice',
      senderType: 'contact',
      senderName: 'Khách hàng',
    });
    const img2 = createImageMsg(2, 2, {
      senderUid: 'uid-bob',
      senderType: 'contact',
      senderName: 'Khách hàng',
    });

    const result = clusterMessagesIntoRenderItems([img1, img2]);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('message');
    expect(result[1].type).toBe('message');
  });

  it('filters out deleted images from album while keeping active ones', () => {
    const img1 = createImageMsg(1, 0);
    const img2Deleted = createImageMsg(2, 2, { isDeleted: true });
    const img3 = createImageMsg(3, 4);

    const result = clusterMessagesIntoRenderItems([img1, img2Deleted, img3]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('album');
    const album = result[0] as PhotoAlbumItem;
    expect(album.images).toHaveLength(2);
    expect(album.images.map(img => img.messageId)).toEqual(['img-msg-1', 'img-msg-3']);
  });

  it('un-absorbs text caption when all images in the cluster are deleted', () => {
    const img1Deleted = createImageMsg(1, 0, { isDeleted: true });
    const img2Deleted = createImageMsg(2, 2, { isDeleted: true });
    const captionMsg = createMsg({
      id: 'caption-survived',
      content: 'Chú thích vẫn còn',
      contentType: 'text',
      sentAt: new Date(baseTime + 5000).toISOString(),
      isDeleted: false,
    });

    const result = clusterMessagesIntoRenderItems([img1Deleted, img2Deleted, captionMsg]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('message');
    if (result[0].type === 'message') {
      expect(result[0].message.id).toBe('caption-survived');
      expect(result[0].message.content).toBe('Chú thích vẫn còn');
    }
  });

  it('returns revoked album bubble when all images and caption are deleted', () => {
    const img1Deleted = createImageMsg(1, 0, { isDeleted: true });
    const img2Deleted = createImageMsg(2, 2, { isDeleted: true });

    const result = clusterMessagesIntoRenderItems([img1Deleted, img2Deleted]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('album');
    const album = result[0] as PhotoAlbumItem;
    expect(album.isDeleted).toBe(true);
    expect(album.images).toHaveLength(0);
  });

  it('does not absorb deleted caption message into album', () => {
    const img1 = createImageMsg(1, 0);
    const img2 = createImageMsg(2, 2);
    const deletedCaption = createMsg({
      id: 'caption-deleted',
      content: 'Caption đã bị thu hồi',
      contentType: 'text',
      sentAt: new Date(baseTime + 5000).toISOString(),
      isDeleted: true,
    });

    const result = clusterMessagesIntoRenderItems([img1, img2, deletedCaption]);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('album');
    expect((result[0] as PhotoAlbumItem).caption).toBeNull();
    expect(result[1].type).toBe('message');
    if (result[1].type === 'message') {
      expect(result[1].message.isDeleted).toBe(true);
    }
  });

  it('correctly handles getRenderItemKey for both message and album', () => {
    const msg = createMsg({ id: 'msg-abc' });
    expect(getRenderItemKey({ type: 'message', message: msg })).toBe('msg-abc');

    const album: PhotoAlbumItem = {
      type: 'album',
      id: 'album-xyz',
      senderType: 'contact',
      senderName: null,
      sentAt: new Date().toISOString(),
      images: [],
      sourceMessageIds: ['xyz'],
    };
    expect(getRenderItemKey(album)).toBe('album-xyz');
  });

  it('rejects dangerous URL schemes in getImageUrl and isValidMediaUrl', () => {
    expect(isValidMediaUrl('javascript:alert(1)')).toBe(false);
    expect(isValidMediaUrl('data:image/png;base64,12345')).toBe(false);
    expect(isValidMediaUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isValidMediaUrl('https://zdn.vn/photo/1.jpg')).toBe(true);
    expect(isValidMediaUrl('http://example.com/pic.png')).toBe(true);
    expect(isValidMediaUrl('/api/v1/attachments/photo.png')).toBe(true);

    const maliciousMsg = createMsg({
      contentType: 'image',
      content: 'javascript:alert("XSS")',
    });
    expect(getImageUrl(maliciousMsg)).toBeNull();

    const dataUriMsg = createMsg({
      contentType: 'image',
      content: 'data:image/png;base64,aGVsbG8=',
    });
    expect(getImageUrl(dataUriMsg)).toBeNull();

    const validZaloMsg = createMsg({
      contentType: 'image',
      content: 'https://zdn.vn/photo/abc.jpg',
    });
    expect(getImageUrl(validZaloMsg)).toBe('https://zdn.vn/photo/abc.jpg');
  });
});
