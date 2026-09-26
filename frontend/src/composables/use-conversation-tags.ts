/**
 * use-conversation-tags.ts — Composable managing Conversation Tags state, active filters, and Socket.IO real-time sync.
 */
import { ref, computed } from 'vue';
import {
  fetchConversationTags,
  createConversationTag as apiCreateTag,
  updateConversationTag as apiUpdateTag,
  deleteConversationTag as apiDeleteTag,
  assignConversationTag as apiAssignTag,
  unassignConversationTag as apiUnassignTag,
  type ConversationTag,
  type ConversationTagAssignment,
  type CreateConversationTagInput,
  type UpdateConversationTagInput,
} from '../api/conversation-tag-api';
import { getSharedSocket } from '../services/socket-service';

// Module-level shared reactive state
const tags = ref<ConversationTag[]>([]);
const activeTagId = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
let socketInitialized = false;

function sortTags(list: ConversationTag[]): ConversationTag[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' }));
}

function setupSocketListeners(): void {
  if (socketInitialized) return;
  const socket = getSharedSocket();
  if (!socket) return;

  socket.on('conversation:tag-deleted', (payload: { tagId: string }) => {
    if (!payload?.tagId) return;
    tags.value = tags.value.filter((t) => t.id !== payload.tagId);
    if (activeTagId.value === payload.tagId) {
      activeTagId.value = null;
    }
  });

  socketInitialized = true;
}

export function useConversationTags() {
  async function loadTags(force = false): Promise<ConversationTag[]> {
    setupSocketListeners();
    if (tags.value.length > 0 && !force) {
      return tags.value;
    }

    loading.value = true;
    error.value = null;
    try {
      const data = await fetchConversationTags();
      tags.value = sortTags(data);
      return tags.value;
    } catch (err: any) {
      error.value = err?.response?.data?.error || err?.message || 'Không thể tải danh sách nhãn';
      return [];
    } finally {
      loading.value = false;
    }
  }

  async function createTag(input: CreateConversationTagInput): Promise<ConversationTag> {
    const created = await apiCreateTag(input);
    const idx = tags.value.findIndex((t) => t.id === created.id);
    if (idx !== -1) {
      tags.value[idx] = created;
    } else {
      tags.value.push(created);
    }
    tags.value = sortTags(tags.value);
    return created;
  }

  async function updateTag(id: string, input: UpdateConversationTagInput): Promise<ConversationTag> {
    const updated = await apiUpdateTag(id, input);
    const idx = tags.value.findIndex((t) => t.id === updated.id);
    if (idx !== -1) {
      tags.value[idx] = updated;
    }
    tags.value = sortTags(tags.value);
    return updated;
  }

  async function deleteTag(id: string): Promise<boolean> {
    const success = await apiDeleteTag(id);
    if (success) {
      tags.value = tags.value.filter((t) => t.id !== id);
      if (activeTagId.value === id) {
        activeTagId.value = null;
      }
    }
    return success;
  }

  async function assignTag(conversationId: string, tagId: string): Promise<ConversationTagAssignment[]> {
    const assignments = await apiAssignTag(conversationId, tagId);
    // Increment assignment count locally
    const tag = tags.value.find((t) => t.id === tagId);
    if (tag && tag._count) {
      tag._count.assignments = (tag._count.assignments || 0) + 1;
    }
    return assignments;
  }

  async function unassignTag(conversationId: string, tagId: string): Promise<ConversationTagAssignment[]> {
    const assignments = await apiUnassignTag(conversationId, tagId);
    // Decrement assignment count locally
    const tag = tags.value.find((t) => t.id === tagId);
    if (tag && tag._count && tag._count.assignments > 0) {
      tag._count.assignments -= 1;
    }
    return assignments;
  }

  function setActiveTag(tagId: string | null): void {
    activeTagId.value = activeTagId.value === tagId ? null : tagId;
  }

  const activeTag = computed(() => {
    if (!activeTagId.value) return null;
    return tags.value.find((t) => t.id === activeTagId.value) || null;
  });

  return {
    tags,
    activeTagId,
    activeTag,
    loading,
    error,
    loadTags,
    createTag,
    updateTag,
    deleteTag,
    assignTag,
    unassignTag,
    setActiveTag,
  };
}
