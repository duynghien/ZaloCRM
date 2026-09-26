<script setup lang="ts">
import { ref, computed } from 'vue';
import { useConversationTags } from '../../composables/use-conversation-tags';
import ConversationTagDialog from './ConversationTagDialog.vue';
import type { Conversation } from '../../composables/use-chat';
import type { ConversationTag } from '../../api/conversation-tag-api';

const props = defineProps<{
  conversation: Conversation;
}>();

const { tags, assignTag, unassignTag, createTag } = useConversationTags();

const isOpen = ref(false);
const showCreateDialog = ref(false);
const errorMsg = ref<string | null>(null);
const loadingTagId = ref<string | null>(null);

const assignedTagIds = computed(() => {
  return new Set((props.conversation.tags || []).map((t) => t.tagId));
});

const assignedCount = computed(() => assignedTagIds.value.size);

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

async function handleCreateTag(data: { name: string; color: string; description?: string }) {
  try {
    const created = await createTag(data);
    showCreateDialog.value = false;
    if (assignedCount.value < 6) {
      await assignTag(props.conversation.id, created.id);
    }
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.error || err?.message || 'Không thể tạo nhãn';
  }
}
</script>

<template>
  <div>
    <v-menu v-model="isOpen" :close-on-content-click="false" location="bottom end">
      <template #activator="{ props: menuProps }">
        <v-btn
          v-bind="menuProps"
          icon="mdi-tag-outline"
          size="small"
          variant="text"
          :color="assignedCount > 0 ? 'primary' : undefined"
          title="Gắn nhãn cuộc trò chuyện"
        />
      </template>

      <v-card width="280" class="border-2 border-black rounded-none shadow-[4px_4px_0_0_#000] pa-0">
        <!-- Header -->
        <div class="pa-3 border-b-2 border-black bg-neutral-100 d-flex align-center justify-space-between">
          <div>
            <div class="text-caption font-weight-black text-uppercase">Gắn nhãn hội thoại</div>
            <div class="text-caption text-grey-darken-1 font-weight-bold" style="font-size: 0.7rem;">
              {{ assignedCount }}/6 nhãn đã chọn
            </div>
          </div>
          <v-btn
            size="x-small"
            variant="text"
            icon="mdi-close"
            @click="isOpen = false"
          />
        </div>

        <!-- Error alert -->
        <div v-if="errorMsg" class="pa-2 bg-red-lighten-5 text-red font-weight-bold text-caption border-b">
          {{ errorMsg }}
        </div>

        <!-- Tag list -->
        <div class="overflow-y-auto" style="max-height: 240px;">
          <div v-if="tags.length === 0" class="pa-4 text-center text-caption text-grey">
            Chưa có nhãn nào. Bấm bên dưới để tạo nhãn đầu tiên.
          </div>
          <div
            v-for="tag in tags"
            :key="tag.id"
            class="d-flex align-center justify-space-between px-3 py-2 cursor-pointer hover:bg-neutral-50 border-b border-neutral-200"
            @click="toggleTag(tag)"
          >
            <div class="d-flex align-center gap-2 overflow-hidden mr-2">
              <span
                class="d-inline-block rounded-full flex-shrink-0"
                :style="{ backgroundColor: tag.color, width: '12px', height: '12px', border: '1px solid #000' }"
              />
              <span class="text-caption font-weight-bold text-truncate">{{ tag.name }}</span>
            </div>
            <v-checkbox-btn
              :model-value="isAssigned(tag.id)"
              :loading="loadingTagId === tag.id"
              color="primary"
              density="compact"
              hide-details
            />
          </div>
        </div>

        <!-- Footer: Create tag button -->
        <div class="pa-2 border-t-2 border-black bg-white">
          <button
            type="button"
            class="w-full border-2 border-black bg-neutral-100 py-1.5 px-3 text-xs font-black uppercase text-black hover:bg-neutral-200"
            @click="showCreateDialog = true"
          >
            + Tạo nhãn mới
          </button>
        </div>
      </v-card>
    </v-menu>

    <ConversationTagDialog
      :show="showCreateDialog"
      @close="showCreateDialog = false"
      @save="handleCreateTag"
    />
  </div>
</template>
