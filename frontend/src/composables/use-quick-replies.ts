/**
 * use-quick-replies.ts — Composable managing QuickReply message templates and real-time cache.
 */
import { ref, computed } from 'vue';
import {
  fetchQuickReplies,
  createQuickReply as apiCreate,
  updateQuickReply as apiUpdate,
  deleteQuickReply as apiDelete,
  type QuickReply,
  type CreateQuickReplyInput,
  type UpdateQuickReplyInput,
  type QuickReplyCategory,
} from '../api/quick-reply-api';
import { getSharedSocket } from '../services/socket-service';

// Module-level shared state
const quickReplies = ref<QuickReply[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
let socketInitialized = false;

function sortQuickReplies(list: QuickReply[]): QuickReply[] {
  return [...list].sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.shortcut.localeCompare(b.shortcut);
  });
}

function setupSocketListeners(): void {
  if (socketInitialized) return;
  const socket = getSharedSocket();
  if (!socket) return;

  socket.on('quick-reply:updated', (payload: { quickReply: QuickReply }) => {
    if (!payload?.quickReply) return;
    const item = payload.quickReply;
    const idx = quickReplies.value.findIndex((qr) => qr.id === item.id);
    if (idx !== -1) {
      quickReplies.value[idx] = item;
    } else {
      quickReplies.value.push(item);
    }
    quickReplies.value = sortQuickReplies(quickReplies.value);
  });

  socket.on('quick-reply:deleted', (payload: { id: string }) => {
    if (!payload?.id) return;
    quickReplies.value = quickReplies.value.filter((qr) => qr.id !== payload.id);
  });

  socketInitialized = true;
}

export function useQuickReplies() {
  async function loadQuickReplies(force = false): Promise<QuickReply[]> {
    setupSocketListeners();
    if (quickReplies.value.length > 0 && !force) {
      return quickReplies.value;
    }

    loading.value = true;
    error.value = null;
    try {
      const data = await fetchQuickReplies();
      quickReplies.value = sortQuickReplies(data);
      return quickReplies.value;
    } catch (err: any) {
      error.value = err?.response?.data?.error || err?.message || 'Không thể tải tin nhắn mẫu';
      return [];
    } finally {
      loading.value = false;
    }
  }

  function filterQuickReplies(query: string, category?: QuickReplyCategory | 'all'): QuickReply[] {
    const q = query.toLowerCase().trim().replace(/^\/+/, '');
    return quickReplies.value.filter((qr) => {
      if (category && category !== 'all' && qr.category !== category) {
        return false;
      }
      if (!q) return true;
      const matchShortcut = qr.shortcut.toLowerCase().includes(q);
      const matchTitle = qr.title.toLowerCase().includes(q);
      return matchShortcut || matchTitle;
    }).sort((a, b) => {
      // Prioritize prefix match on shortcut
      const aStarts = a.shortcut.toLowerCase().startsWith(q);
      const bStarts = b.shortcut.toLowerCase().startsWith(q);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return 0;
    });
  }

  async function createItem(input: CreateQuickReplyInput): Promise<QuickReply> {
    const created = await apiCreate(input);
    const idx = quickReplies.value.findIndex((qr) => qr.id === created.id);
    if (idx === -1) {
      quickReplies.value.push(created);
      quickReplies.value = sortQuickReplies(quickReplies.value);
    } else {
      quickReplies.value[idx] = created;
    }
    return created;
  }

  async function updateItem(id: string, input: UpdateQuickReplyInput): Promise<QuickReply> {
    const updated = await apiUpdate(id, input);
    const idx = quickReplies.value.findIndex((qr) => qr.id === id);
    if (idx !== -1) {
      quickReplies.value[idx] = updated;
      quickReplies.value = sortQuickReplies(quickReplies.value);
    }
    return updated;
  }

  async function deleteItem(id: string): Promise<boolean> {
    const success = await apiDelete(id);
    if (success) {
      quickReplies.value = quickReplies.value.filter((qr) => qr.id !== id);
    }
    return success;
  }

  return {
    quickReplies: computed(() => quickReplies.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    loadQuickReplies,
    filterQuickReplies,
    createQuickReply: createItem,
    updateQuickReply: updateItem,
    deleteQuickReply: deleteItem,
    setQuickRepliesForTest: (items: QuickReply[]) => { quickReplies.value = items; },
  };
}
