<script setup lang="ts">
import type { ConversationTag } from '../../api/conversation-tag-api';

defineProps<{
  tag: ConversationTag;
  isAssigned: boolean;
  isLoading: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle', tag: ConversationTag): void;
  (e: 'edit', tag: ConversationTag, event: Event): void;
  (e: 'delete', tag: ConversationTag, event: Event): void;
}>();
</script>

<template>
  <div
    class="tag-item-row d-flex align-center justify-space-between px-3 py-2"
    :class="{ 'row-assigned': isAssigned }"
    @click="emit('toggle', tag)"
  >
    <div class="d-flex align-center gap-2 overflow-hidden flex-grow-1 mr-2">
      <span class="tag-color-dot" :style="{ backgroundColor: tag.color }" />
      <span class="text-caption font-weight-bold text-truncate" :title="tag.name">{{ tag.name }}</span>
    </div>
    <div class="d-flex align-center gap-1 flex-shrink-0">
      <v-btn
        icon="mdi-pencil-outline"
        size="x-small"
        variant="text"
        density="compact"
        class="tag-action-icon"
        title="Sửa nhãn"
        @click="emit('edit', tag, $event)"
      />
      <v-btn
        icon="mdi-trash-can-outline"
        size="x-small"
        variant="text"
        density="compact"
        class="tag-action-icon text-error"
        title="Xóa nhãn"
        @click="emit('delete', tag, $event)"
      />
      <v-checkbox-btn
        :model-value="isAssigned"
        :loading="isLoading"
        color="primary"
        density="compact"
        hide-details
        class="ma-0 pa-0"
      />
    </div>
  </div>
</template>

<style scoped>
.tag-item-row {
  cursor: pointer;
  border-bottom: 1px solid var(--surface-variant, #E4E4E7);
  transition: background-color 0.1s ease;
}

.tag-item-row:hover {
  background-color: var(--surface-variant, #F4F4F5);
}

.tag-item-row.row-assigned {
  background-color: var(--secondary-brand, #EBF3FE);
}

.tag-color-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid var(--border-color, #18181B);
  flex-shrink: 0;
}

.tag-action-icon {
  opacity: 0.4;
  transition: opacity 0.1s ease;
}

.tag-item-row:hover .tag-action-icon {
  opacity: 1;
}
</style>
