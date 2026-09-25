<template>
  <div class="message-input-toolbar flex-shrink-0">
    <!-- Safety Compose Bar (Chốt chặn an toàn) -->
    <div
      v-if="conversation?.zaloAccount"
      class="safety-compose-bar px-3 py-1 d-flex align-center justify-space-between"
      :style="{
        borderLeft: `4px solid ${accountColor}`,
        borderTop: '1.5px solid var(--border-color)',
        backgroundColor: 'var(--bg-main, #f8f9fa)',
      }"
    >
      <div class="d-flex align-center text-caption font-weight-medium text-truncate mr-2">
        <span class="mr-1 text-grey-darken-1 font-mono" style="font-size: 0.7rem;">ĐANG TRẢ LỜI BẰNG:</span>
        <span class="font-weight-bold mr-2 text-truncate" :style="{ color: accountColor, fontSize: '0.78rem' }">
          {{ conversation.zaloAccount.displayName || 'Zalo' }}
        </span>
        <span
          v-if="conversation.zaloAccount.branchTag"
          class="neo-pill px-1 py-0 font-weight-bold"
          :style="{
            backgroundColor: accountColor,
            color: '#FFFFFF',
            border: '1px solid var(--border-color)',
            fontSize: '0.65rem !important',
          }"
        >
          {{ conversation.zaloAccount.branchTag }}
        </span>
      </div>

      <div class="d-flex align-center text-caption text-grey-darken-1 flex-shrink-0" style="font-size: 0.72rem;">
        <span
          class="status-dot mr-1"
          :class="isAccountOnline ? 'status-online' : 'status-offline'"
        />
        <span>{{ isAccountOnline ? 'Online' : 'Mất kết nối' }}</span>
      </div>
    </div>

    <!-- Staged Media Bar -->
    <StagedMediaBar
      :files="stagedFiles"
      :uploading="uploading"
      class="flex-shrink-0"
      @remove="$emit('remove-staged-file', $event)"
    />

    <!-- Input Area -->
    <div class="pa-2 d-flex align-end chat-input-area">
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
      <v-textarea
        :model-value="inputText"
        placeholder="Nhập tin nhắn..."
        variant="outlined"
        rounded="lg"
        density="compact"
        hide-details
        auto-grow
        rows="1"
        max-rows="3"
        @update:model-value="$emit('update:inputText', $event)"
        @keydown.enter.exact.prevent="$emit('send')"
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
import { ref } from 'vue';
import type { Conversation } from '@/composables/use-chat';
import type { StagedFile } from '@/composables/use-staged-media';
import StagedMediaBar from './StagedMediaBar.vue';

defineProps<{
  conversation: Conversation | null;
  accountColor: string;
  isAccountOnline: boolean;
  inputText: string;
  stagedFiles: StagedFile[];
  uploading: boolean;
  sending: boolean;
}>();

defineEmits<{
  (e: 'update:inputText', text: string): void;
  (e: 'send'): void;
  (e: 'remove-staged-file', index: number): void;
  (e: 'file-input-change', event: Event): void;
  (e: 'paste', event: ClipboardEvent): void;
}>();

const fileInput = ref<HTMLInputElement | null>(null);

function triggerFileInput() {
  fileInput.value?.click();
}

defineExpose({
  triggerFileInput,
});
</script>

<style scoped>
.safety-compose-bar {
  user-select: none;
}

.chat-input-area {
  flex-shrink: 0;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.status-online {
  background-color: #10B981;
}

.status-offline {
  background-color: #9CA3AF;
}
</style>
