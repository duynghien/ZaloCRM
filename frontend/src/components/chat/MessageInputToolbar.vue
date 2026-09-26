<template>
  <div class="message-input-toolbar flex-shrink-0">
    <!-- Safety Compose Bar (Chốt chặn an toàn) -->
    <SafetyComposeBar
      :account="conversation?.zaloAccount"
      :account-color="accountColor"
      :is-account-online="isAccountOnline"
    />

    <!-- Staged Media Bar -->
    <StagedMediaBar
      :files="stagedFiles"
      :uploading="uploading"
      class="flex-shrink-0"
      @remove="$emit('remove-staged-file', $event)"
    />

    <!-- Input Area with Quick Reply Popover -->
    <div class="pa-2 d-flex align-end chat-input-area position-relative">
      <!-- Quick Reply Selector Popup -->
      <QuickReplySelector
        ref="selectorRef"
        :query="query"
        :visible="showSelector"
        @select="insertReply"
        @close="showSelector = false"
        @open-manager="showManager = true"
      />

      <!-- Quick Replies Manager Dialog -->
      <QuickRepliesManagerDialog v-model="showManager" />

      <input
        ref="fileInput"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/gif,.pdf,.xlsx,.xls,.docx,.doc,.txt,.zip,.rar"
        style="display: none;"
        @change="$emit('file-input-change', $event)"
      />
      <v-btn
        icon="mdi-paperclip"
        variant="text"
        rounded="lg"
        class="mr-1 flex-shrink-0"
        :disabled="sending || uploading"
        title="Đính kèm tệp (Tối đa 5 tệp)"
        @click="triggerFileInput"
      />
      <v-btn
        icon="mdi-lightning-bolt"
        variant="text"
        rounded="lg"
        class="mr-1 flex-shrink-0"
        color="primary"
        title="Tin nhắn mẫu (/ hoặc bấm để mở)"
        @click="toggleSelector"
      />
      <v-textarea
        :model-value="inputText"
        placeholder="Nhập tin nhắn (gõ / để mở tin nhắn mẫu)..."
        variant="outlined"
        rounded="lg"
        density="compact"
        hide-details
        auto-grow
        rows="1"
        max-rows="3"
        @compositionstart="isComposing = true"
        @compositionend="isComposing = false"
        @update:model-value="onInputUpdate"
        @keydown="onKeydown"
        @paste="$emit('paste', $event)"
        class="flex-grow-1 mr-2"
      />
      <v-btn
        icon
        color="primary"
        rounded="lg"
        style="border: 1.5px solid var(--border-color);"
        :loading="sending || uploading"
        :disabled="!inputText.trim() && stagedFiles.length === 0"
        @click="$emit('send')"
      >
        <v-icon>send.svg</v-icon>
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Conversation } from '@/composables/use-chat';
import type { StagedFile } from '@/composables/use-staged-media';
import { useQuickReplies } from '@/composables/use-quick-replies';
import { useQuickReplyTrigger } from '@/composables/use-quick-reply-trigger';
import StagedMediaBar from './StagedMediaBar.vue';
import QuickReplySelector from './QuickReplySelector.vue';
import QuickRepliesManagerDialog from './QuickRepliesManagerDialog.vue';
import SafetyComposeBar from './SafetyComposeBar.vue';

const props = defineProps<{
  conversation: Conversation | null;
  accountColor: string;
  isAccountOnline: boolean;
  inputText: string;
  stagedFiles: StagedFile[];
  uploading: boolean;
  sending: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:inputText', text: string): void;
  (e: 'send'): void;
  (e: 'remove-staged-file', index: number): void;
  (e: 'file-input-change', event: Event): void;
  (e: 'paste', event: ClipboardEvent): void;
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const selectorRef = ref<any>(null);
const { loadQuickReplies } = useQuickReplies();

const {
  showSelector,
  query,
  isComposing,
  showManager,
  checkTrigger,
  handleKeydown,
  insertReply,
} = useQuickReplyTrigger(
  () => props.inputText,
  (val) => emit('update:inputText', val)
);

onMounted(() => {
  loadQuickReplies();
});

function triggerFileInput() {
  fileInput.value?.click();
}

function toggleSelector() {
  if (showSelector.value) {
    showSelector.value = false;
  } else {
    loadQuickReplies();
    query.value = '';
    showSelector.value = true;
  }
}

function onInputUpdate(text: string) {
  emit('update:inputText', text);
  checkTrigger(text);
}

function onKeydown(e: KeyboardEvent) {
  handleKeydown(e, selectorRef.value, () => emit('send'));
}

defineExpose({
  triggerFileInput,
  toggleSelector,
});
</script>

<style scoped>
.chat-input-area {
  flex-shrink: 0;
}
</style>
