<script setup lang="ts">
import { ref, computed } from 'vue';
import { useConversationTags } from '../../composables/use-conversation-tags';
import ConversationTagDialog from './ConversationTagDialog.vue';
import ConversationTagMenuItem from './ConversationTagMenuItem.vue';
import type { Conversation } from '../../composables/use-chat';
import type { ConversationTag } from '../../api/conversation-tag-api';

const props = defineProps<{ conversation: Conversation }>();
const { tags, assignTag, unassignTag, createTag, updateTag, deleteTag } = useConversationTags();

const isOpen = ref(false);
const showDialog = ref(false);
const editingTag = ref<ConversationTag | null>(null);
const searchQuery = ref('');
const errorMsg = ref<string | null>(null);
const loadingTagId = ref<string | null>(null);

const assignedTagIds = computed(() => new Set((props.conversation.tags || []).map((t) => t.tagId)));
const assignedCount = computed(() => assignedTagIds.value.size);
const filteredTags = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return q ? tags.value.filter((t) => t.name.toLowerCase().includes(q)) : tags.value;
});

function isAssigned(tagId: string): boolean {
  return assignedTagIds.value.has(tagId);
}

async function toggleTag(tag: ConversationTag) {
  errorMsg.value = null;
  loadingTagId.value = tag.id;
  try {
    if (isAssigned(tag.id)) {
      await unassignTag(props.conversation.id, tag.id);
    } else {
      if (assignedCount.value >= 6) {
        errorMsg.value = 'Tối đa 6 nhãn cho mỗi cuộc hội thoại';
        return;
      }
      await assignTag(props.conversation.id, tag.id);
    }
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.error || err?.message || 'Không thể cập nhật nhãn';
  } finally {
    loadingTagId.value = null;
  }
}

function openCreateDialog() {
  isOpen.value = false;
  editingTag.value = null;
  showDialog.value = true;
}

function openEditDialog(tag: ConversationTag, event: Event) {
  event.stopPropagation();
  isOpen.value = false;
  editingTag.value = tag;
  showDialog.value = true;
}

async function handleDeleteTag(tag: ConversationTag, event: Event) {
  event.stopPropagation();
  if (!confirm(`Bạn có chắc muốn xóa nhãn "${tag.name}" khỏi toàn bộ hệ thống?`)) return;
  try {
    await deleteTag(tag.id);
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.error || err?.message || 'Không thể xóa nhãn';
  }
}

async function handleSaveTag(data: { name: string; color: string; description?: string }) {
  try {
    if (editingTag.value) {
      await updateTag(editingTag.value.id, data);
    } else {
      const created = await createTag(data);
      if (assignedCount.value < 6) await assignTag(props.conversation.id, created.id);
    }
    showDialog.value = false;
    editingTag.value = null;
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.error || err?.message || 'Lỗi khi lưu nhãn';
  }
}
</script>

<template>
  <div class="conversation-tag-assign-wrapper">
    <v-menu v-model="isOpen" :close-on-content-click="false" location="bottom end" offset="6">
      <template #activator="{ props: menuProps }">
        <v-btn
          v-bind="menuProps"
          size="small"
          variant="text"
          class="topbar-action-btn tag-menu-trigger"
          :class="{ 'has-tags': assignedCount > 0 }"
          :title="`Gắn nhãn (${assignedCount}/6)`"
        >
          <v-badge v-if="assignedCount > 0" :content="assignedCount" color="primary" floating offset-x="-2" offset-y="-2">
            <v-icon size="18" color="primary">mdi-tag</v-icon>
          </v-badge>
          <v-icon v-else size="18">mdi-tag-outline</v-icon>
        </v-btn>
      </template>

      <v-card width="310" class="tag-menu-card pa-0" elevation="0">
        <!-- Header -->
        <div class="px-3 py-2 border-b d-flex align-center justify-space-between bg-surface-variant">
          <div>
            <div class="font-weight-bold neo-subtitle text-caption" style="font-size: 0.72rem;">GẮN NHÃN HỘI THOẠI</div>
            <div class="text-caption text-grey-darken-1 font-weight-medium" style="font-size: 0.68rem;">
              {{ assignedCount }}/6 nhãn đã chọn
            </div>
          </div>
          <v-btn size="x-small" variant="text" icon="mdi-close" density="compact" @click="isOpen = false" />
        </div>

        <!-- Search input if > 4 tags -->
        <div v-if="tags.length > 4" class="px-2 pt-2 pb-1 border-b">
          <v-text-field
            v-model="searchQuery"
            placeholder="Tìm kiếm nhãn..."
            density="compact"
            variant="outlined"
            rounded="lg"
            prepend-inner-icon="mdi-magnify"
            hide-details
          />
        </div>

        <!-- Error alert -->
        <div v-if="errorMsg" class="px-3 py-1.5 bg-red-lighten-5 text-error font-weight-bold text-caption border-b d-flex align-center justify-space-between">
          <span>{{ errorMsg }}</span>
          <v-btn icon="mdi-close" size="x-small" variant="text" density="compact" @click="errorMsg = null" />
        </div>

        <!-- Tag list -->
        <div class="tag-items-list">
          <div v-if="filteredTags.length === 0" class="pa-4 text-center text-caption text-grey">
            {{ searchQuery ? 'Không tìm thấy nhãn phù hợp' : 'Chưa có nhãn nào. Bấm nút bên dưới để tạo.' }}
          </div>
          <ConversationTagMenuItem
            v-for="tag in filteredTags"
            :key="tag.id"
            :tag="tag"
            :is-assigned="isAssigned(tag.id)"
            :is-loading="loadingTagId === tag.id"
            @toggle="toggleTag"
            @edit="openEditDialog"
            @delete="handleDeleteTag"
          />
        </div>

        <!-- Footer -->
        <div class="pa-2 border-t bg-surface-card">
          <v-btn
            color="primary"
            variant="tonal"
            rounded="lg"
            block
            density="compact"
            class="font-weight-bold text-caption"
            @click="openCreateDialog"
          >
            <v-icon start size="16">mdi-plus</v-icon>
            Tạo nhãn mới
          </v-btn>
        </div>
      </v-card>
    </v-menu>

    <!-- Modal Dialog outside menu context -->
    <ConversationTagDialog :show="showDialog" :tag="editingTag" @close="showDialog = false" @save="handleSaveTag" />
  </div>
</template>

<style scoped>
.tag-menu-card {
  border: 1.5px solid var(--border-color) !important;
  border-radius: 12px !important;
  background-color: var(--surface-card, #FFFFFF) !important;
  box-shadow: 4px 4px 0px 0px rgba(0, 0, 0, 0.15) !important;
  overflow: hidden;
}

.tag-items-list {
  max-height: 250px;
  overflow-y: auto;
}
</style>
