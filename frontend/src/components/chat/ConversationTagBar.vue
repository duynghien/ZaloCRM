<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useConversationTags } from '../../composables/use-conversation-tags';
import { getContrastTextColor } from '../../utils/account-colors';
import ConversationTagDialog from './ConversationTagDialog.vue';

const {
  tags,
  activeTagId,
  loadTags,
  createTag,
  setActiveTag,
} = useConversationTags();

const showCreateDialog = ref(false);

onMounted(() => {
  loadTags();
});

async function handleCreateTag(data: { name: string; color: string; description?: string }) {
  try {
    await createTag(data);
    showCreateDialog.value = false;
  } catch (err: any) {
    alert(err?.response?.data?.error || err?.message || 'Lỗi khi tạo nhãn');
  }
}
</script>

<template>
  <div class="conversation-tag-bar px-2 py-1.5 d-flex align-center">
    <div class="tag-scroll-track d-flex align-center gap-1.5">
      <!-- "Tất cả" chip -->
      <button
        type="button"
        class="tag-filter-chip all-chip"
        :class="{ 'chip-active': !activeTagId }"
        @click="setActiveTag(null)"
      >
        <span>Tất cả</span>
      </button>

      <!-- Individual tag chips -->
      <button
        v-for="tag in tags"
        :key="tag.id"
        type="button"
        class="tag-filter-chip custom-tag-chip"
        :class="{ 'chip-active': activeTagId === tag.id }"
        :style="{
          backgroundColor: activeTagId === tag.id ? tag.color : 'var(--surface-card, #FFFFFF)',
          color: activeTagId === tag.id ? getContrastTextColor(tag.color) : 'var(--text-main, #18181B)',
          borderColor: activeTagId === tag.id ? 'var(--border-color)' : 'var(--border-color)',
        }"
        :title="tag.description ? `${tag.name}: ${tag.description}` : tag.name"
        @click="setActiveTag(tag.id)"
      >
        <span
          v-if="activeTagId !== tag.id"
          class="tag-color-bullet"
          :style="{ backgroundColor: tag.color }"
        />
        <v-icon
          v-else
          size="12"
          class="mr-0.5"
          :color="getContrastTextColor(tag.color)"
        >
          mdi-check
        </v-icon>
        <span class="text-truncate" style="max-width: 100px;">{{ tag.name }}</span>
        <span
          v-if="tag._count && tag._count.assignments > 0"
          class="tag-count-bubble"
          :style="{
            backgroundColor: activeTagId === tag.id ? 'rgba(0,0,0,0.2)' : 'var(--surface-variant)',
            color: activeTagId === tag.id ? 'inherit' : 'var(--text-muted)'
          }"
        >
          {{ tag._count.assignments }}
        </span>
      </button>

      <!-- Quick Add Tag Button -->
      <button
        type="button"
        class="tag-filter-chip add-tag-btn"
        title="Tạo nhãn mới"
        @click="showCreateDialog = true"
      >
        <v-icon size="13" class="mr-0.5">mdi-plus</v-icon>
        <span>{{ tags.length === 0 ? 'Thêm nhãn' : 'Nhãn' }}</span>
      </button>
    </div>

    <!-- Create tag modal dialog -->
    <ConversationTagDialog
      :show="showCreateDialog"
      @close="showCreateDialog = false"
      @save="handleCreateTag"
    />
  </div>
</template>

<style scoped>
.conversation-tag-bar {
  border-bottom: 1.5px solid var(--border-color, #18181B);
  background-color: var(--surface-card, #FFFFFF);
  min-height: 38px;
  overflow: hidden;
}

.tag-scroll-track {
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  white-space: nowrap;
  width: 100%;
  padding-bottom: 2px;
}

.tag-scroll-track::-webkit-scrollbar {
  display: none;
}

.tag-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border-radius: 9999px;
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
  border: 1.5px solid var(--border-color, #18181B);
  transition: transform 0.1s ease, background-color 0.15s ease;
  user-select: none;
}

.tag-filter-chip:active {
  transform: translate(1px, 1px);
}

.all-chip {
  background-color: var(--surface-variant, #F4F4F5);
  color: var(--text-main, #18181B);
}

.all-chip.chip-active {
  background-color: var(--text-main, #18181B);
  color: #FFFFFF;
}

.custom-tag-chip {
  background-color: var(--surface-card, #FFFFFF);
}

.tag-color-bullet {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.2);
  flex-shrink: 0;
}

.tag-count-bubble {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 9999px;
  font-size: 0.62rem;
  font-weight: 800;
}

.add-tag-btn {
  border: 1.5px dashed var(--text-muted, #71717A);
  background-color: transparent;
  color: var(--text-muted, #71717A);
}

.add-tag-btn:hover {
  border-color: var(--text-main, #18181B);
  color: var(--text-main, #18181B);
  background-color: var(--surface-variant, #F4F4F5);
}
</style>
