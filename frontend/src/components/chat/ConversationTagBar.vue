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
  <div class="flex items-center gap-1.5 overflow-x-auto border-b-2 border-black bg-neutral-50 px-3 py-1.5 scrollbar-none">
    <!-- "Tất cả" chip -->
    <button
      type="button"
      class="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors"
      :class="
        !activeTagId
          ? 'border-black bg-black font-black text-white shadow-[1px_1px_0_0_#000]'
          : 'border-neutral-300 bg-white font-bold text-neutral-700 hover:border-black hover:bg-neutral-100'
      "
      @click="setActiveTag(null)"
    >
      <span>Tất cả</span>
    </button>

    <!-- Individual tag chips -->
    <button
      v-for="tag in tags"
      :key="tag.id"
      type="button"
      class="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-transform hover:scale-105"
      :class="
        activeTagId === tag.id
          ? 'border-2 border-black font-black shadow-[2px_2px_0_0_#000] ring-2 ring-black ring-offset-1'
          : 'border border-black font-bold shadow-[1px_1px_0_0_#000]'
      "
      :style="{
        backgroundColor: tag.color,
        color: getContrastTextColor(tag.color),
      }"
      @click="setActiveTag(tag.id)"
    >
      <span>{{ tag.name }}</span>
      <span
        v-if="tag._count && tag._count.assignments > 0"
        class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-black/20 px-1 text-[10px] font-black"
      >
        {{ tag._count.assignments }}
      </span>
    </button>

    <!-- Add tag button -->
    <button
      type="button"
      class="inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-neutral-400 bg-white px-2 py-0.5 text-xs font-bold text-neutral-600 hover:border-black hover:text-black"
      title="Tạo nhãn mới"
      @click="showCreateDialog = true"
    >
      + Nhãn
    </button>

    <ConversationTagDialog
      :show="showCreateDialog"
      @close="showCreateDialog = false"
      @save="handleCreateTag"
    />
  </div>
</template>
