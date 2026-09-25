<template>
  <div class="message-thread d-flex flex-column flex-grow-1" style="height: 100%;">
    <!-- Empty state -->
    <div v-if="!conversation" class="d-flex align-center justify-center flex-grow-1">
      <div class="text-center text-grey">
        <v-icon icon="mdi-chat-outline" size="96" color="grey-lighten-2" />
        <p class="text-h6 mt-4">Chọn cuộc trò chuyện</p>
      </div>
    </div>

    <template v-else>
      <!-- Header -->
      <MessageThreadHeader
        :conversation="conversation"
        :mobile="mobile"
        :show-contact-panel="showContactPanel"
        :account-color="accountColor"
        @back="$emit('back')"
        @toggle-contact-panel="$emit('toggle-contact-panel')"
      />

      <!-- Messages Area -->
      <div
        ref="messagesContainer"
        class="flex-grow-1 overflow-y-auto pa-3 chat-messages-area position-relative"
        @dragenter.prevent="onDragEnter"
        @dragover.prevent
        @dragleave.prevent="onDragLeave"
        @drop.prevent="onDrop"
      >
        <!-- Drag & drop overlay -->
        <div v-if="isDragging" class="drag-drop-overlay d-flex flex-column align-center justify-center">
          <v-icon icon="mdi-cloud-upload" size="56" color="primary" class="mb-2" />
          <div class="text-subtitle-1 font-weight-bold">Thả tệp vào đây để gửi</div>
          <div class="text-caption text-grey">Tối đa 5 tệp (Ảnh &le; 15MB, Tài liệu &le; 30MB)</div>
        </div>

        <ChatAnomalyBanner
          v-if="conversation"
          :anomaly="currentAnomaly"
          :conversation-metadata="conversation.contact?.metadata"
          @apply-reply="onApplyReply"
          @resolve="onResolveAnomaly"
        />

        <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />

        <div
          v-for="group in messageDateGroups"
          :key="group.dateKey"
          class="message-date-group"
        >
          <!-- Date Separator Sticky Header -->
          <div v-if="group.dateLabel" class="date-separator-sticky-header">
            <div class="date-separator-pill px-3 py-1 text-center font-weight-medium" :class="dateSeparatorThemeClass">
              {{ group.dateLabel }}
            </div>
          </div>

          <!-- Message Bubble Items -->
          <MessageBubbleItem
            v-for="item in group.renderItems"
            :key="getRenderItemKey(item)"
            :item="item"
            :conversation="conversation"
            :failed-images="failedImages"
            @open-lightbox="openLightbox"
            @open-gallery="onOpenGallery"
            @open-file="openFile"
            @image-error="handleImageError"
            @retry-image="retryLoadImage"
            @album-image-error="handleAlbumImageError"
            @retry-album-image="retryLoadAlbumImage"
            @sync-appointment="syncAppointment(conversation, $event)"
          />
        </div>

        <div v-if="!loading && messages.length === 0" class="text-center pa-8 text-grey">Chưa có tin nhắn</div>
      </div>

      <!-- Copilot Draft Card (1-on-1 chats only) -->
      <div v-if="conversation && conversation.threadType === 'user'" class="px-2 pt-1">
        <ChatAiDraftCard
          :draft="currentSuggestion?.quickDraft"
          :contact-id="conversation.contact?.id"
          :existing-phone="conversation.contact?.phone"
          @open-order-draft="$emit('open-order-draft', $event)"
          @open-appointment-draft="$emit('open-appointment-draft', $event)"
          @enrich-contact="onEnrichContact"
        />
      </div>

      <!-- Copilot Smart Reply Bar -->
      <div v-if="conversation" class="px-2">
        <ChatCopilotBar
          :suggestion="currentSuggestion"
          :conversation-id="conversation.id"
          :loading-manual="loadingManual"
          @apply-reply="onApplyReply"
          @request-manual="requestManualCopilot(conversation.id)"
        />
      </div>

      <!-- Input & Compose Area -->
      <MessageInputToolbar
        v-model:input-text="inputText"
        :conversation="conversation"
        :account-color="accountColor"
        :is-account-online="isAccountOnline"
        :staged-files="stagedFiles"
        :uploading="uploading"
        :sending="sending"
        @send="handleSend"
        @remove-staged-file="removeStagedFile"
        @file-input-change="onFileInputChange"
        @paste="handlePaste"
      />
    </template>

    <!-- Media Lightbox Dialog -->
    <MediaLightboxDialog
      v-model="showLightbox"
      :image-url="lightboxUrl"
      :filename="lightboxFilename"
      :images="galleryImages"
      :initial-index="galleryIndex"
    />

    <!-- Sync snackbar -->
    <v-snackbar v-model="syncSnack.show" :color="syncSnack.color" timeout="3000">{{ syncSnack.text }}</v-snackbar>

    <!-- Error snackbar -->
    <v-snackbar v-model="showErrorSnack" color="error" timeout="4000">{{ errorMessage }}</v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';
import { useDisplay, useTheme } from 'vuetify';
import type { Conversation, Message } from '@/composables/use-chat';
import { getDeterministicAccountColor } from '@/utils/account-colors';
import { groupRenderItemsByDate } from '@/utils/chat-message-formatter';
import { clusterMessagesIntoRenderItems, getRenderItemKey } from '@/utils/chat-message-clustering';
import { useStagedMedia } from '@/composables/use-staged-media';
import { useChatCopilot } from '@/composables/use-chat-copilot';
import { useChatMediaViewer } from '@/composables/use-chat-media-viewer';
import { useChatAppointmentSync } from '@/composables/use-chat-appointment-sync';

import MessageThreadHeader from './MessageThreadHeader.vue';
import MessageBubbleItem from './MessageBubbleItem.vue';
import MessageInputToolbar from './MessageInputToolbar.vue';
import ChatCopilotBar from './ChatCopilotBar.vue';
import ChatAiDraftCard from './ChatAiDraftCard.vue';
import ChatAnomalyBanner from './ChatAnomalyBanner.vue';
import MediaLightboxDialog from './MediaLightboxDialog.vue';

const { mobile } = useDisplay();
const theme = useTheme();

const isDarkTheme = computed(() => theme.global.current.value.dark);
const dateSeparatorThemeClass = computed(() => (isDarkTheme.value ? 'date-separator-dark' : 'date-separator-light'));

const props = defineProps<{
  conversation: Conversation | null;
  messages: Message[];
  loading: boolean;
  sending: boolean;
  showContactPanel?: boolean;
}>();

const emit = defineEmits<{
  send: [content: string, attachmentIds?: string[]];
  'toggle-contact-panel': [];
  back: [];
  'open-order-draft': [draftData: any];
  'open-appointment-draft': [draftData: any];
}>();

const allRenderItems = computed(() => clusterMessagesIntoRenderItems(props.messages));
const messageDateGroups = computed(() => groupRenderItemsByDate(allRenderItems.value));

const {
  currentSuggestion,
  currentAnomaly,
  loadingManual,
  requestManualCopilot,
  resolveAnomaly,
  confirmEnrichContact,
} = useChatCopilot(computed(() => props.conversation?.id || null));

const {
  stagedFiles,
  uploading,
  isDragging,
  errorMessage,
  showErrorSnack,
  removeStagedFile,
  clearStagedFiles,
  onFileInputChange,
  handlePaste,
  handleDrop,
  uploadStagedFiles,
} = useStagedMedia();

const {
  showLightbox,
  lightboxUrl,
  lightboxFilename,
  galleryImages,
  galleryIndex,
  failedImages,
  onOpenGallery,
  openLightbox,
  handleAlbumImageError,
  retryLoadAlbumImage,
  handleImageError,
  retryLoadImage,
  openFile,
} = useChatMediaViewer();

const { syncSnack, syncAppointment } = useChatAppointmentSync();

let dragCounter = 0;
function onDragEnter() {
  dragCounter++;
  isDragging.value = true;
}
function onDragLeave() {
  dragCounter--;
  if (dragCounter <= 0) {
    isDragging.value = false;
    dragCounter = 0;
  }
}
function onDrop(e: DragEvent) {
  dragCounter = 0;
  isDragging.value = false;
  handleDrop(e);
}

function onApplyReply(text: string) {
  inputText.value = text;
}

async function onResolveAnomaly() {
  if (props.conversation?.id) {
    await resolveAnomaly(props.conversation.id);
  }
}

async function onEnrichContact(data: { phone?: string; address?: string }) {
  if (props.conversation?.contact?.id) {
    await confirmEnrichContact(props.conversation.contact.id, data);
  }
}

const accountColor = computed(() => {
  const acc = props.conversation?.zaloAccount;
  if (!acc) return '#0068FF';
  return getDeterministicAccountColor(acc.id, acc.colorTag);
});

const isAccountOnline = computed(() => {
  const acc = props.conversation?.zaloAccount;
  if (!acc) return false;
  return acc.status === 'connected' || acc.status === 'active';
});

const inputText = ref('');
const messagesContainer = ref<HTMLElement | null>(null);

async function handleSend() {
  const text = inputText.value.trim();
  const hasFiles = stagedFiles.value.length > 0;
  if (!text && !hasFiles) return;
  if (props.sending || uploading.value) return;

  let attachmentIds: string[] | undefined = undefined;
  if (hasFiles) {
    try {
      attachmentIds = await uploadStagedFiles();
    } catch (err: any) {
      const errorText = err.response?.data?.error || 'Tải tệp lên thất bại. Vui lòng thử lại.';
      errorMessage.value = errorText;
      showErrorSnack.value = true;
      return;
    }
  }

  emit('send', text, attachmentIds);
  inputText.value = '';
  clearStagedFiles();
}

watch(
  () => props.messages.length,
  async () => {
    await nextTick();
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  }
);
</script>

<style scoped>
.chat-messages-area {
  min-height: 0;
}

.position-relative {
  position: relative;
}

.drag-drop-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(255, 255, 255, 0.94);
  border: 3px dashed var(--primary-brand);
  border-radius: 8px;
  z-index: 20;
  pointer-events: none;
}

.message-date-group {
  position: relative;
}

.date-separator-sticky-header {
  position: sticky;
  top: 4px;
  z-index: 5;
  display: flex;
  justify-content: center;
  pointer-events: none;
  padding: 6px 0;
}

.date-separator-pill {
  pointer-events: auto;
  border-radius: 9999px;
  font-size: 0.72rem;
  line-height: 1.2;
  user-select: none;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.date-separator-light {
  background-color: rgba(0, 0, 0, 0.3);
  color: #FFFFFF;
}

.date-separator-dark {
  background-color: rgba(255, 255, 255, 0.25);
  color: #FFFFFF;
}
</style>
