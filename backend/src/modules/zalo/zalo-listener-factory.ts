/**
 * zalo-listener-factory.ts — sets up zca-js listener events for one Zalo account.
 * Handles message routing, user-info caching, group detection, and undo events.
 * Extracted from ZaloAccountPool to keep zalo-pool.ts under 200 lines.
 */
import type { Server } from 'socket.io';
import { emitAccountEvent } from '../../shared/realtime/socket-event-delivery.js';
import { logger } from '../../shared/utils/logger.js';
import { handleIncomingMessage, handleMessageUndo } from '../chat/message-handler.js';
import { detectContentType, updateContactAvatar } from './zalo-message-helpers.js';

// Cached user info entry with 5-minute TTL
export interface UserInfoCacheEntry {
  zaloName: string;
  avatar: string;
  phone?: string;
  cachedAt: number;
}

const USER_INFO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Fetch zaloName + avatar from API with a per-pool in-memory cache
async function resolveZaloName(
  api: any,
  uid: string,
  cache: Map<string, UserInfoCacheEntry>,
): Promise<{ zaloName: string; avatar: string }> {
  const cached = cache.get(uid);
  if (cached && Date.now() - cached.cachedAt < USER_INFO_CACHE_TTL_MS) {
    return { zaloName: cached.zaloName, avatar: cached.avatar };
  }

  try {
    const result = await api.getUserInfo(uid);
    const profiles = result?.changed_profiles || {};
    const profile = profiles[uid] || profiles[`${uid}_0`];
    if (profile) {
      const entry: UserInfoCacheEntry = {
        zaloName:
          profile.zaloName ||
          profile.zalo_name ||
          profile.displayName ||
          profile.display_name ||
          '',
        avatar: profile.avatar || '',
        phone: profile.phoneNumber || '',
        cachedAt: Date.now(),
      };
      cache.set(uid, entry);
      return { zaloName: entry.zaloName, avatar: entry.avatar };
    }
  } catch (err) {
    logger.warn(`[zalo] getUserInfo failed for ${uid}:`, err);
  }
  return { zaloName: '', avatar: '' };
}

// Fetch zaloName + avatar from API with a per-pool in-memory cache and 3s safety timeout
async function resolveZaloNameWithTimeout(
  api: any,
  uid: string,
  cache: Map<string, UserInfoCacheEntry>,
  timeoutMs = 3000,
): Promise<{ zaloName: string; avatar: string }> {
  try {
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<{ zaloName: string; avatar: string }>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      timer.unref?.();
    });
    const res = await Promise.race([
      resolveZaloName(api, uid, cache),
      timeoutPromise,
    ]);
    if (timer) clearTimeout(timer);
    return res;
  } catch {
    return { zaloName: '', avatar: '' };
  }
}

// Fetch group display name from the zca-js API
async function resolveGroupName(api: any, groupId: string): Promise<string> {
  try {
    const result = await api.getGroupInfo(groupId);
    const info = result?.gridInfoMap?.[groupId];
    return info?.name || '';
  } catch (err) {
    logger.warn(`[zalo] getGroupInfo failed for ${groupId}:`, err);
    return '';
  }
}

export interface ListenerContext {
  accountId: string;
  accountDisplayName?: string;
  orgId?: string;
  api: any;
  io: Server | null;
  userInfoCache: Map<string, UserInfoCacheEntry>;
  onDisconnected: (accountId: string) => void;
}

/**
 * Attach all zca-js listener events for the given account.
 * Calls listener.start() with retryOnClose at the end.
 */
export function attachZaloListener(ctx: ListenerContext): () => Promise<void> {
  const { accountId, api, io, userInfoCache, onDisconnected } = ctx;
  const listener = api.listener;

  // Keep the existing concurrent ingestion path. Only an undo for the same ID
  // waits for its message; a slow lookup must not queue unrelated payloads.
  const messagesInFlight = new Map<string, Promise<void>>();
  const active = new Set<Promise<void>>();
  let closed = false;
  const track = (work: () => Promise<void>) => {
    if (closed) return Promise.resolve();
    const run = work().catch(() => logger.error(`[zalo:${accountId}] Incoming event failed`))
      .finally(() => active.delete(run));
    active.add(run);
    return run;
  };
  const emitScoped = async (event: string, payload: unknown) => {
    if (!closed && io) await emitAccountEvent(io, accountId, event, payload);
  };

  listener.on('connected', () => {
    logger.info(`[zalo:${accountId}] Listener connected`);
  });

  listener.on('message', (message: any) => {
    // Ignore self reaction or self typing events
    if (message.isSelf && (message.data?.cmd === 612 || message.data?.msgType?.includes('reaction') || message.data?.msgType?.includes('typing'))) {
      return;
    }

    const msgId = String(message.data?.msgId || '');
    const messageKey = JSON.stringify([message.threadId, msgId]);
    if (msgId && messagesInFlight.has(messageKey)) return messagesInFlight.get(messageKey);
    const run = track(async () => {
      try {
        // ThreadType in zca-js: 0 = User, 1 = Group
        const isGroup = message.type === 1;
        const senderUid = String(message.data?.uidFrom || '');

        let senderName: string = message.data?.dName || '';
        let recipientName: string | undefined;
        let recipientAvatar: string | undefined;

        if (message.isSelf) {
          senderName = ctx.accountDisplayName || 'Bạn';
          if (!isGroup && message.threadId && api.getUserInfo) {
            const recipientInfo = await resolveZaloNameWithTimeout(api, message.threadId, userInfoCache, 3000);
            if (recipientInfo.zaloName) recipientName = recipientInfo.zaloName;
            if (recipientInfo.avatar) {
              recipientAvatar = recipientInfo.avatar;
              updateContactAvatar(message.threadId, recipientInfo.avatar, ctx.orgId);
            }
          }
        } else if (senderUid && api.getUserInfo) {
          const userInfo = await resolveZaloNameWithTimeout(api, senderUid, userInfoCache, 3000);
          if (userInfo.zaloName) senderName = userInfo.zaloName;
          if (userInfo.avatar) updateContactAvatar(senderUid, userInfo.avatar, ctx.orgId);
        }

        // Resolve group name for group threads
        let groupName: string | undefined;
        if (isGroup && message.threadId) {
          groupName = await resolveGroupName(api, message.threadId);
        }

        const rawContent = message.data?.content;
        let parsedContentObj: any = null;
        if (typeof rawContent === 'object' && rawContent !== null) {
          parsedContentObj = rawContent;
        } else if (typeof rawContent === 'string' && (rawContent.startsWith('{') || rawContent.startsWith('['))) {
          try {
            parsedContentObj = JSON.parse(rawContent);
          } catch {}
        }

        const attachments: any[] = [];
        const fileUrl =
          parsedContentObj?.href ||
          parsedContentObj?.url ||
          parsedContentObj?.fileUrl ||
          message.data?.url ||
          message.data?.href;

        if (fileUrl) {
          attachments.push({
            url: fileUrl,
            title: parsedContentObj?.title || parsedContentObj?.name || message.data?.title || '',
            thumb: parsedContentObj?.thumb || message.data?.thumb || '',
            size: parsedContentObj?.size || message.data?.size,
            extension: parsedContentObj?.extension || '',
            msgType: message.data?.msgType,
          });
        }

        if (Array.isArray(message.data?.attachments)) {
          attachments.push(...message.data.attachments);
        }

        const content =
          typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent || '');
        const contentType = detectContentType(message.data?.msgType, rawContent);

        const result = await handleIncomingMessage({
          accountId,
          senderUid,
          senderName,
          recipientName,
          recipientAvatar,
          content,
          contentType,
          msgId: String(message.data?.msgId || ''),
          timestamp: parseInt(message.data?.ts || String(Date.now())),
          isSelf: message.isSelf || false,
          threadId: message.threadId || '',
          threadType: isGroup ? 'group' : 'user',
          groupName,
          attachments,
        });

        if (result) {
          await emitScoped('chat:message', {
            accountId,
            message: result.message,
            conversationId: result.conversationId,
          });
        }
      } catch (err) {
        logger.error(`[zalo:${accountId}] Message handler error:`, err);
      }
    });
    if (msgId) messagesInFlight.set(messageKey, run);
    void run.finally(() => { if (messagesInFlight.get(messageKey) === run) messagesInFlight.delete(messageKey); });
    return run;
  });

  listener.on('undo', (data: any) => track(async () => {
    const msgId = data.data?.msgId || data.msgId;
    const threadId = data.threadId || data.groupId || data.data?.threadId || data.data?.groupId;
    if (typeof threadId !== 'string' || !threadId) return;
    await messagesInFlight.get(JSON.stringify([threadId, String(msgId)]));
    if (msgId) {
      const conversationId = await handleMessageUndo(accountId, String(msgId), threadId);
      if (conversationId) await emitScoped('chat:deleted', { accountId, conversationId, msgId: String(msgId) });
    }
  }));

  listener.on('closed', (code: number, reason: string) => {
    logger.warn(`[zalo:${accountId}] Listener closed: ${code} ${reason}`);
    onDisconnected(accountId);
    void emitScoped('zalo:disconnected', { accountId, code, reason })
      .catch(() => logger.error(`[zalo:${accountId}] Disconnected delivery failed`));
  });

  listener.on('error', (err: any) => {
    logger.error(`[zalo:${accountId}] Listener error:`, err);
  });

  listener.start({ retryOnClose: true });
  return async () => {
    closed = true;
    await Promise.allSettled(active);
  };
}
