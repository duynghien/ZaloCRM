import type { Message } from '@/composables/use-chat';
import { isImageFile } from '@/utils/file-utils';
import {
  getImageUrl,
  isValidMediaUrl,
  isReminderMessage,
  hasCustomCaption,
  getDisplayCaption,
} from '@/utils/chat-message-formatter';

export interface AlbumImage {
  url: string;
  hdUrl?: string; // URL ảnh gốc chất lượng cao trích xuất từ payload Zalo nếu có
  filename?: string;
  originalName?: string;
  messageId: string;
}

export interface PhotoAlbumItem {
  type: 'album';
  id: string; // Deterministic: `album-${firstSourceMessageId}`
  senderUid?: string | null;
  senderType: string;
  senderName: string | null;
  sentAt: string;
  images: AlbumImage[];
  caption?: string | null;
  captionMessageId?: string;
  sourceMessageIds: string[];
  isDeleted?: boolean;
}

export type RenderableItem = 
  | { type: 'message'; message: Message }
  | PhotoAlbumItem;

export function getRenderItemKey(item: RenderableItem): string {
  return item.type === 'message' ? item.message.id : item.id;
}

function getSenderKey(msg: Message): string {
  if (msg.senderUid) return `uid:${msg.senderUid}`;
  return `type:${msg.senderType}:name:${msg.senderName || ''}`;
}

function isImageMessage(msg: Message): boolean {
  if (msg.attachments && msg.attachments.length > 0) {
    const hasNonImage = msg.attachments.some(a => !isImageFile(a.filename || a.originalName, a.mimeType, a.url));
    if (hasNonImage) return false;
    return true;
  }
  if (msg.contentType === 'image') return true;
  if (getImageUrl(msg) !== null) return true;
  return false;
}

function extractImagesFromMessage(msg: Message): AlbumImage[] {
  const images: AlbumImage[] = [];
  if (msg.attachments && msg.attachments.length > 0) {
    for (const att of msg.attachments) {
      if (isImageFile(att.filename || att.originalName, att.mimeType, att.url)) {
        images.push({
          url: att.url,
          filename: att.filename,
          originalName: att.originalName,
          messageId: msg.id,
        });
      }
    }
    return images;
  }

  const url = getImageUrl(msg);
  if (url) {
    let hdUrl: string | undefined;
    let filename: string | undefined;
    let originalName: string | undefined;
    if (msg.content?.startsWith('{')) {
      try {
        const p = JSON.parse(msg.content);
        if (p.hdUrl && isValidMediaUrl(p.hdUrl)) hdUrl = p.hdUrl;
        filename = p.title || undefined;
        originalName = p.title || undefined;
      } catch {}
    }
    images.push({
      url,
      hdUrl,
      filename,
      originalName,
      messageId: msg.id,
    });
  }
  return images;
}

function isValidCaptionCandidate(msg: Message): boolean {
  if (msg.isDeleted) return false;
  if (msg.contentType !== 'text') return false;
  if (msg.attachments && msg.attachments.length > 0) return false;
  if (isReminderMessage(msg)) return false;
  if (msg.content?.startsWith('{')) {
    try {
      const p = JSON.parse(msg.content);
      if (p.action || p.params || (p.href && p.title)) return false;
    } catch {}
  }
  return !!(msg.content && msg.content.trim().length > 0);
}

/**
 * Cluster consecutive image messages into PhotoAlbumItem.
 * Trailing text messages within captionWindowMs (default 8s) are absorbed as caption
 * only if the album does not already have an intrinsic caption from image payloads.
 */
export function clusterMessagesIntoRenderItems(
  messages: Message[],
  burstWindowMs = 60000,
  captionWindowMs = 8000
): RenderableItem[] {
  if (!messages || messages.length === 0) return [];

  const result: RenderableItem[] = [];
  let i = 0;

  while (i < messages.length) {
    const currentMsg = messages[i];

    if (!isImageMessage(currentMsg)) {
      result.push({ type: 'message', message: currentMsg });
      i++;
      continue;
    }

    // Collect consecutive image messages from same sender within burstWindowMs
    const candidateMessages: Message[] = [currentMsg];
    let lastMsg = currentMsg;
    let nextIdx = i + 1;

    while (nextIdx < messages.length) {
      const nextMsg = messages[nextIdx];
      if (!isImageMessage(nextMsg)) break;
      if (getSenderKey(nextMsg) !== getSenderKey(lastMsg)) break;

      const tPrev = new Date(lastMsg.sentAt).getTime();
      const tNext = new Date(nextMsg.sentAt).getTime();
      if (isNaN(tPrev) || isNaN(tNext) || Math.abs(tNext - tPrev) > burstWindowMs) break;

      candidateMessages.push(nextMsg);
      lastMsg = nextMsg;
      nextIdx++;
    }

    // Check total potential images
    const totalPotentialImages = candidateMessages.reduce((sum, m) => {
      if (m.attachments && m.attachments.length > 0) {
        return sum + m.attachments.filter(a => isImageFile(a.filename || a.originalName, a.mimeType, a.url)).length;
      }
      return sum + (getImageUrl(m) ? 1 : 0);
    }, 0);

    // If only 1 image and not multiple messages, it is a single message, not a cluster
    if (candidateMessages.length === 1 && totalPotentialImages <= 1) {
      result.push({ type: 'message', message: currentMsg });
      i++;
      continue;
    }

    // Check for trailing text caption
    // 1. Only look for trailing caption if images do not already contain an intrinsic caption
    const hasIntrinsicCaption = candidateMessages.some(m => hasCustomCaption(m));

    let captionMsg: Message | undefined;
    if (!hasIntrinsicCaption && nextIdx < messages.length) {
      const potentialCaption = messages[nextIdx];
      if (
        isValidCaptionCandidate(potentialCaption) &&
        getSenderKey(potentialCaption) === getSenderKey(lastMsg)
      ) {
        const tLast = new Date(lastMsg.sentAt).getTime();
        const tCaption = new Date(potentialCaption.sentAt).getTime();
        if (!isNaN(tLast) && !isNaN(tCaption) && Math.abs(tCaption - tLast) <= captionWindowMs) {
          captionMsg = potentialCaption;
          nextIdx++;
        }
      }
    }

    // Extract active (non-deleted) images
    const activeImages: AlbumImage[] = [];
    for (const m of candidateMessages) {
      if (!m.isDeleted) {
        activeImages.push(...extractImagesFromMessage(m));
      }
    }

    const sourceMessageIds = candidateMessages.map(m => m.id);
    if (captionMsg) {
      sourceMessageIds.push(captionMsg.id);
    }

    // If all images were deleted
    if (activeImages.length === 0) {
      if (captionMsg && !captionMsg.isDeleted) {
        // Un-absorb surviving caption text into independent message
        result.push({ type: 'message', message: captionMsg });
      } else {
        // Return standard revoked album bubble
        result.push({
          type: 'album',
          id: `album-${candidateMessages[0].id}`,
          senderUid: candidateMessages[0].senderUid,
          senderType: candidateMessages[0].senderType,
          senderName: candidateMessages[0].senderName,
          sentAt: candidateMessages[0].sentAt,
          images: [],
          caption: null,
          sourceMessageIds,
          isDeleted: true,
        });
      }
      i = nextIdx;
      continue;
    }

    // Determine album caption:
    // 1. If trailing caption message was absorbed, use it
    // 2. Otherwise if any candidate image message had an intrinsic caption, extract it
    let albumCaption: string | null = null;
    let albumCaptionMsgId: string | undefined;

    if (captionMsg && !captionMsg.isDeleted) {
      albumCaption = captionMsg.content;
      albumCaptionMsgId = captionMsg.id;
    } else {
      const intrinsicMsg = candidateMessages.find(m => !m.isDeleted && hasCustomCaption(m));
      if (intrinsicMsg) {
        albumCaption = getDisplayCaption(intrinsicMsg);
        albumCaptionMsgId = intrinsicMsg.id;
      }
    }

    // Build active album
    result.push({
      type: 'album',
      id: `album-${candidateMessages[0].id}`,
      senderUid: candidateMessages[0].senderUid,
      senderType: candidateMessages[0].senderType,
      senderName: candidateMessages[0].senderName,
      sentAt: candidateMessages[0].sentAt,
      images: activeImages,
      caption: albumCaption,
      captionMessageId: albumCaptionMsgId,
      sourceMessageIds,
      isDeleted: false,
    });

    i = nextIdx;
  }

  return result;
}
