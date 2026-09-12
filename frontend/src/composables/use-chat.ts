import { ref, computed, onUnmounted, watch } from 'vue';
import { useChatRecovery } from './use-chat-recovery';
import { api, getAccessToken, isSocketAuthenticationFailure, refreshAccessToken } from '@/api/index';
import { io, Socket } from 'socket.io-client';
import type { Contact } from '@/composables/use-contacts';

interface ZaloAccount {
  id: string;
  displayName: string | null;
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
}

export interface Message {
  id: string;
  content: string | null;
  contentType: string;
  senderType: string;
  senderName: string | null;
  sentAt: string;
  isDeleted: boolean;
  zaloMsgId: string | null;
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

  async function selectConversation(convId: string) {
    selectedConvId.value = convId;
    await recovery.request();
    if (selectedConvId.value !== convId) return;
    try {
      await api.post(`/conversations/${convId}/mark-read`);
      const conv = conversations.value.find(c => c.id === convId);
      if (conv) conv.unreadCount = 0;
    } catch {
      // Recovery owns authorization failures and clears unavailable data.
    }
  }

  async function sendMessage(content: string) {
    if (!selectedConvId.value || !content.trim()) return;
    const convId = selectedConvId.value;
    const generation = recovery.generation();
    sendingMsg.value = true;
    try {
      const res = await api.post(`/conversations/${convId}/messages`, { content });
      if (selectedConvId.value === convId && recovery.generation() === generation
        && !messages.value.some(message => message.id === res.data.id)) messages.value.push(res.data);
      void recovery.request();
    } catch (err) {
      console.error('Failed to send message:', err);
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

    socket.on('chat:message', (data: { message: Message; conversationId: string }) => {
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
    fetchConversations,
    selectConversation,
    sendMessage,
    initSocket,
    destroySocket,
  };
}
