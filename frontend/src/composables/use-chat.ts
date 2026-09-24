import { ref, computed, onUnmounted, watch } from 'vue';
import { useChatRecovery } from './use-chat-recovery';
import { api, getAccessToken, isSocketAuthenticationFailure, refreshAccessToken } from '@/api/index';
import { io, Socket } from 'socket.io-client';
import type { Contact } from '@/composables/use-contacts';
import { bindCopilotSocket, unbindCopilotSocket, useChatCopilot } from './use-chat-copilot';

export interface ZaloAccount {
  id: string;
  displayName: string | null;
  zaloUid?: string | null;
  status?: string;
  branchTag?: string | null;
  colorTag?: string | null;
}

interface ConversationMessage {
  content: string | null;
  contentType: string;
  senderType: string;
  sentAt: string;
  isDeleted: boolean;
}

export interface Conversation {
  id: string;
  threadType: 'user' | 'group';
  contact: Contact | null;
  zaloAccount: ZaloAccount | null;
  lastMessageAt: string | null;
  unreadCount: number;
  isReplied: boolean;
  messages?: ConversationMessage[];
  metadata?: Record<string, any> | null;
}

export interface MessageAttachment {
  url: string;
  filename: string;
  originalName?: string;
  size?: number;
  mimeType?: string;
}

export interface UploadedMedia {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface Message {
  id: string;
  content: string | null;
  contentType: string;
  senderType: string;
  senderUid?: string | null;
  senderName: string | null;
  sentAt: string;
  isDeleted: boolean;
  zaloMsgId: string | null;
  attachments?: MessageAttachment[];
}

export function useChat() {
  const conversations = ref<Conversation[]>([]);
  const selectedConvId = ref<string | null>(null);
  const messages = ref<Message[]>([]);
  const loadingConvs = ref(false);
  const loadingMsgs = ref(false);
  const sendingMsg = ref(false);
  const searchQuery = ref('');
  const accountFilter = ref<string | null>(null);
  const accountUnreadMap = ref<Record<string, number>>({});
  let socket: Socket | null = null;
  let socketRefreshAttempted = false;
  let lastSocketRefresh = 0;
  let removeTokenListener: (() => void) | null = null;

  const selectedConv = computed(() =>
    conversations.value.find(c => c.id === selectedConvId.value) || null,
  );

  const recovery = useChatRecovery({ conversations, selectedConvId, messages,
    loadingConvs, loadingMsgs, searchQuery, accountFilter });
  const fetchConversations = recovery.request;
  watch(selectedConvId, () => { messages.value = []; recovery.invalidate(); }, { flush: 'sync' });

  async function fetchAccountUnreads() {
    try {
      const res = await api.get('/zalo-accounts');
      const accountsList = Array.isArray(res.data) ? res.data : [];
      const map: Record<string, number> = {};
      for (const acc of accountsList) {
        map[acc.id] = acc.unreadCount || 0;
      }
      accountUnreadMap.value = map;
    } catch (err) {
      console.error('Failed to fetch account unreads:', err);
    }
  }

  async function selectConversation(convId: string) {
    selectedConvId.value = convId;
    await recovery.request();
    if (selectedConvId.value !== convId) return;
    try {
      await api.post(`/conversations/${convId}/mark-read`);
      const conv = conversations.value.find(c => c.id === convId);
      if (conv) {
        if (conv.unreadCount > 0 && conv.zaloAccount?.id) {
          const current = accountUnreadMap.value[conv.zaloAccount.id] || 0;
          accountUnreadMap.value[conv.zaloAccount.id] = Math.max(0, current - conv.unreadCount);
        }
        conv.unreadCount = 0;
      }
    } catch {
      // Recovery owns authorization failures and clears unavailable data.
    }
  }

  async function uploadMediaFiles(files: File[]): Promise<UploadedMedia[]> {
    if (!files || files.length === 0) return [];
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }
    const res = await api.post('/media/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return res.data.files || [];
  }

  async function deleteStagedFile(id: string): Promise<void> {
    if (!id) return;
    try {
      await api.delete(`/media/upload/${encodeURIComponent(id)}`);
    } catch (err) {
      console.warn('Failed to delete staged media file:', err);
    }
  }

  async function sendMessage(
    content: string,
    attachmentIds?: string[],
    options?: { clientMessageId?: string }
  ) {
    const hasText = Boolean(content && content.trim());
    const hasAttachments = Boolean(attachmentIds && attachmentIds.length > 0);
    if (!selectedConvId.value || (!hasText && !hasAttachments)) return;
    const convId = selectedConvId.value;
    const generation = recovery.generation();
    const clientMessageId = options?.clientMessageId || crypto.randomUUID();
    sendingMsg.value = true;
    try {
      const payload: { content?: string; attachmentIds?: string[]; clientMessageId: string } = {
        clientMessageId,
      };
      if (hasText) payload.content = content.trim();
      if (hasAttachments) payload.attachmentIds = attachmentIds;

      const res = await api.post(`/conversations/${convId}/messages`, payload);
      if (selectedConvId.value === convId && recovery.generation() === generation
        && !messages.value.some(message => message.id === res.data.id)) messages.value.push(res.data);
      useChatCopilot().clearSuggestion(convId);
      void recovery.request();
      return res.data;
    } catch (err) {
      console.error('Failed to send message:', err);
      throw err;
    } finally {
      sendingMsg.value = false;
    }
  }

  function initSocket() {
    if (socket) {
      if (!socket.active && !socket.connected) socket.connect();
      return;
    }

    socket = io({
      auth: (callback) => callback({ token: getAccessToken() }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
    });
    bindCopilotSocket(socket);

    const onTokenChanged = (event: Event) => {
      const nextToken = (event as CustomEvent<string>).detail || '';
      if (!socket) return;
      if (!nextToken) {
        selectedConvId.value = null;
        messages.value = [];
        conversations.value = [];
        destroySocket();
        return;
      }
      socket.auth = { token: nextToken };
      socketRefreshAttempted = false;
      if (socket.connected) {
        socket.disconnect().connect();
      } else {
        socket.connect();
      }
    };
    window.addEventListener('zalo-crm:access-token-changed', onTokenChanged as EventListener);
    if (removeTokenListener) removeTokenListener();
    removeTokenListener = () => window.removeEventListener('zalo-crm:access-token-changed', onTokenChanged as EventListener);

    socket.on('disconnect', async (reason) => {
      // Server-enforced token expiry is not retried by Socket.IO. Refresh once per
      // disconnect burst; a rejected refresh follows the REST logout policy.
      if (reason !== 'io server disconnect' || !socket || !getAccessToken()) return;
      const now = Date.now();
      if (lastSocketRefresh && now - lastSocketRefresh < 5000) return;
      lastSocketRefresh = now;
      const disconnectedSocket = socket;
      try {
        await refreshAccessToken();
        if (socket === disconnectedSocket) socket.connect();
      } catch {
        // A later explicit token change may reconnect after a transient failure.
      }
    });

    socket.on('connect_error', async (error) => {
      const unauthorized = isSocketAuthenticationFailure(error.message);
      if (!unauthorized || socketRefreshAttempted || !socket) return;

      const now = Date.now();
      if (lastSocketRefresh && now - lastSocketRefresh < 5000) return;
      lastSocketRefresh = now;
      socketRefreshAttempted = true;
      try {
        await refreshAccessToken();
        socket?.connect();
      } catch {
        // The REST client redirects only after an explicit refresh 401/403.
      }
    });

    socket.on('connect', () => { void recovery.request(); });
    socket.on('realtime:resync-required', () => { void recovery.request(); });

    socket.on('chat:message', (data: { message: Message; conversationId: string; accountId?: string }) => {
      const accId = data.accountId;
      if (accId && data.message.senderType !== 'self' && data.conversationId !== selectedConvId.value) {
        accountUnreadMap.value[accId] = (accountUnreadMap.value[accId] || 0) + 1;
      }

      // Add to messages if viewing this conversation
      if (data.conversationId === selectedConvId.value) {
        // Avoid duplicates
        if (!messages.value.find(m => m.id === data.message.id)) {
          messages.value.push(data.message);
        }
      }
      // Refresh conversation list to update last message / unread count
      void recovery.request();
    });

    socket.on('chat:message:attachments-updated', (data: { accountId: string; conversationId: string; messageId: string; attachments: any[] }) => {
      if (data.conversationId === selectedConvId.value) {
        const msg = messages.value.find(m => m.id === data.messageId);
        if (msg) {
          msg.attachments = data.attachments;
        }
      }
    });

    socket.on('chat:deleted', (data: { accountId: string; conversationId?: string; msgId: string }) => {
      const msg = selectedConv.value?.zaloAccount?.id === data.accountId && selectedConv.value?.id === data.conversationId
        ? messages.value.find(m => m.zaloMsgId === data.msgId) : undefined;
      if (msg) {
        msg.isDeleted = true;
      }
      void recovery.request();
    });
  }

  function destroySocket() {
    recovery.cancel();
    if (socket) unbindCopilotSocket(socket);
    socket?.removeAllListeners();
    socket?.disconnect();
    socket = null;
    socketRefreshAttempted = false;
    if (removeTokenListener) {
      removeTokenListener();
      removeTokenListener = null;
    }
  }

  onUnmounted(() => {
    recovery.dispose();
    destroySocket();
  });

  return {
    conversations,
    selectedConvId,
    selectedConv,
    messages,
    loadingConvs,
    loadingMsgs,
    sendingMsg,
    searchQuery,
    accountFilter,
    accountUnreadMap,
    fetchAccountUnreads,
    fetchConversations,
    selectConversation,
    uploadMediaFiles,
    deleteStagedFile,
    sendMessage,
    initSocket,
    destroySocket,
  };
}
