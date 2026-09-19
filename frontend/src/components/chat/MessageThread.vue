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
      <div class="pa-3 d-flex align-center" style="border-bottom: 1.5px solid var(--border-color);">
        <v-btn
          v-if="mobile"
          icon="mdi-arrow-left"
          size="small"
          variant="text"
          class="mr-2"
          @click="$emit('back')"
        />
        <v-avatar size="36" color="grey-lighten-2" class="mr-3" rounded="circle">
          <v-icon v-if="conversation.threadType === 'group'" icon="mdi-account-group" />
          <v-img v-else-if="conversation.contact?.avatarUrl" :src="conversation.contact.avatarUrl" />
          <v-icon v-else icon="user-alt.svg" />
        </v-avatar>
        <div class="flex-grow-1 text-truncate">
          <div class="d-flex align-center">
            <span class="font-weight-medium text-truncate">
              {{ conversation.threadType === 'group' ? (conversation.contact?.fullName || 'Nhóm') : (conversation.contact?.fullName || 'Khách hàng') }}
            </span>
            <v-chip
              v-if="conversation.threadType === 'group'"
              size="x-small"
              color="info"
              variant="tonal"
              rounded="pill"
              class="ml-1 neo-pill"
            >
              Nhóm
            </v-chip>
            <v-chip
              v-if="conversation.zaloAccount?.branchTag"
              size="x-small"
              class="ml-2 font-weight-bold neo-pill"
              :style="{
                backgroundColor: accountColor,
                color: '#FFFFFF',
                border: '1px solid var(--border-color)',
                fontSize: '0.65rem !important'
              }"
            >
              {{ conversation.zaloAccount.branchTag }}
            </v-chip>
          </div>
          <div class="text-caption text-grey d-flex align-center">
            <span class="mr-1">Tiếp nhận qua:</span>
            <span class="font-weight-medium" :style="{ color: accountColor }">
              {{ conversation.zaloAccount?.displayName || 'Zalo' }}
            </span>
          </div>
        </div>
        <v-btn
          :icon="showContactPanel ? 'mdi-account-details' : 'water.svg'"
          size="small" variant="text"
          :color="showContactPanel ? 'primary' : undefined"
          @click="$emit('toggle-contact-panel')"
        />
      </div>

      <!-- Messages -->
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
        <div v-for="msg in messages" :key="msg.id" class="mb-2 d-flex" :class="msg.senderType === 'self' ? 'justify-end' : 'justify-start'">
          <div style="max-width: 70%;">
            <div v-if="conversation.threadType === 'group' && msg.senderType !== 'self'" class="text-caption mb-1 font-weight-bold" style="color: var(--primary-brand);">
              {{ msg.senderName || 'Unknown' }}
            </div>
            <div class="message-bubble pa-2 px-3" :class="msg.senderType === 'self' ? 'bg-primary text-white' : 'msg-contact-bubble'" style="word-wrap: break-word;">
              <!-- Deleted -->
              <div v-if="msg.isDeleted" class="text-decoration-line-through font-italic" style="opacity: 0.6;">
                {{ msg.content || '(tin nhắn)' }}<span class="text-caption"> (đã thu hồi)</span>
              </div>
              <!-- Structured multi-attachment (new format) -->
              <div v-else-if="msg.attachments && msg.attachments.length > 0" class="message-attachments-container">
                <div v-for="(att, attIdx) in msg.attachments" :key="att.filename || attIdx" class="mb-1">
                  <!-- Image attachment -->
                  <div v-if="isImageFile(att.filename || att.originalName, att.mimeType, att.url)">
                    <img
                      v-if="!failedImages.has(getAttachmentKey(msg, att))"
                      :src="resolveAttachmentUrl(att.url)"
                      :alt="att.originalName || 'Hình ảnh'"
                      class="chat-image"
                      loading="lazy"
                      decoding="async"
                      referrerpolicy="no-referrer"
                      @click="openLightbox(resolveAttachmentUrl(att.url), att.originalName || att.filename)"
                      @error="handleImageError($event, att, msg)"
                    />
                    <div v-else class="image-fallback-card pa-3 text-center border rounded">
                      <v-icon size="24" color="grey-darken-1">mdi-image-off-outline</v-icon>
                      <div class="text-caption mt-1 text-grey-darken-1">Ảnh không khả dụng</div>
                      <v-btn
                        size="x-small"
                        variant="text"
                        color="primary"
                        class="mt-1"
                        prepend-icon="mdi-reload"
                        @click="retryLoadImage(att, msg)"
                      >
                        Thử lại
                      </v-btn>
                    </div>
                  </div>
                  <!-- Document attachment -->
                  <div v-else class="file-card">
                    <v-icon size="20" class="mr-2" :color="getFileIconColor(att.originalName || att.filename)">
                      {{ getFileIcon(att.originalName || att.filename) }}
                    </v-icon>
                    <div class="flex-grow-1 overflow-hidden mr-2">
                      <div class="text-body-2 font-weight-medium text-truncate">{{ att.originalName || att.filename }}</div>
                      <div class="text-caption" style="opacity: 0.6;">{{ formatFileSize(att.size) }}</div>
                    </div>
                    <v-btn icon size="x-small" variant="text" @click="openFile(resolveAttachmentUrl(att.url))">
                      <v-icon size="16">mdi-download</v-icon>
                    </v-btn>
                  </div>
                </div>
                <!-- Optional Caption text -->
                <div v-if="hasCustomCaption(msg)" class="mt-2 text-body-2" style="white-space: pre-wrap;">
                  {{ getDisplayCaption(msg) }}
                </div>
              </div>
              <!-- Image -->
              <div v-else-if="getImageUrl(msg)">
                <img
                  v-if="!failedImages.has(getAttachmentKey(msg))"
                  :src="resolveAttachmentUrl(getImageUrl(msg)!)"
                  alt="Hình ảnh"
                  class="chat-image"
                  loading="lazy"
                  decoding="async"
                  referrerpolicy="no-referrer"
                  @click="openLightbox(resolveAttachmentUrl(getImageUrl(msg)!))"
                  @error="handleImageError($event, undefined, msg)"
                />
                <div v-else class="image-fallback-card pa-3 text-center border rounded">
                  <v-icon size="24" color="grey-darken-1">mdi-image-off-outline</v-icon>
                  <div class="text-caption mt-1 text-grey-darken-1">Ảnh không khả dụng</div>
                  <v-btn
                    size="x-small"
                    variant="text"
                    color="primary"
                    class="mt-1"
                    prepend-icon="mdi-reload"
                    @click="retryLoadImage(undefined, msg)"
                  >
                    Thử lại
                  </v-btn>
                </div>
                <div v-if="hasCustomCaption(msg)" class="mt-2 text-body-2" style="white-space: pre-wrap;">
                  {{ getDisplayCaption(msg) }}
                </div>
              </div>
              <!-- File/PDF -->
              <div v-else-if="getFileInfo(msg)" class="file-card">
                <v-icon size="20" class="mr-2" color="info">mdi-file-document-outline</v-icon>
                <div class="flex-grow-1">
                  <div class="text-body-2 font-weight-medium">{{ getFileInfo(msg)!.name }}</div>
                  <div class="text-caption" style="opacity: 0.6;">{{ getFileInfo(msg)!.size }}</div>
                </div>
                <v-btn v-if="getFileInfo(msg)!.href" icon size="x-small" variant="text" @click="openFile(resolveAttachmentUrl(getFileInfo(msg)!.href))">
                  <v-icon size="16">mdi-download</v-icon>
                </v-btn>
              </div>
              <!-- Sticker/Video/Voice/GIF -->
              <div v-else-if="msg.contentType === 'sticker'">🏷️ Sticker</div>
              <div v-else-if="msg.contentType === 'video'">🎥 Video</div>
              <div v-else-if="msg.contentType === 'voice'">🎤 Tin nhắn thoại</div>
              <div v-else-if="msg.contentType === 'gif'">GIF</div>
              <!-- Reminder/Calendar -->
              <div v-else-if="isReminderMessage(msg)" class="reminder-card">
                <div class="d-flex align-center mb-1">
                  <v-icon size="16" color="warning" class="mr-1">mdi-calendar-clock</v-icon>
                  <span class="text-caption font-weight-bold" style="color: #FFB74D;">Nhắc hẹn</span>
                </div>
                <div class="text-body-2">{{ getReminderTitle(msg) }}</div>
                <div v-if="getReminderTime(msg)" class="text-caption mt-1" style="opacity: 0.7;">
                  <v-icon size="12" class="mr-1">mdi-clock-outline</v-icon>{{ getReminderTime(msg) }}
                </div>
                <v-btn size="x-small" variant="tonal" color="warning" class="mt-2" prepend-icon="mdi-calendar-sync" @click="syncAppointment(msg)">
                  Đồng bộ lịch
                </v-btn>
              </div>
              <!-- Default text -->
              <div v-else>{{ parseDisplayContent(msg.content) }}</div>
              <!-- Timestamp -->
              <div class="text-caption mt-1 msg-time" :class="msg.senderType === 'self' ? 'msg-time-self' : 'msg-time-contact'" style="font-size: 0.7rem;">
                {{ formatMessageTime(msg.sentAt) }}
              </div>
            </div>
          </div>
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
        @remove="removeStagedFile"
      />

      <!-- Input -->
      <div class="pa-2 d-flex align-end chat-input-area">
        <input
          ref="fileInput"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif,.pdf,.xlsx,.xls,.docx,.doc,.txt,.zip,.rar"
          style="display: none;"
          @change="onFileInputChange"
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
          v-model="inputText"
          placeholder="Nhập tin nhắn..."
          variant="outlined"
          rounded="lg"
          density="compact"
          hide-details
          auto-grow
          rows="1"
          max-rows="3"
          @keydown.enter.exact.prevent="handleSend"
          @paste="handlePaste"
          class="flex-grow-1 mr-2"
        />
        <v-btn
          icon
          color="primary"
          rounded="lg"
          style="border: 1.5px solid var(--border-color);"
          :loading="sending || uploading"
          :disabled="!inputText.trim() && stagedFiles.length === 0"
          @click="handleSend"
        >
          <v-icon>send.svg</v-icon>
        </v-btn>
      </div>
    </template>

    <!-- Media Lightbox Dialog -->
    <MediaLightboxDialog
      v-model="showLightbox"
      :image-url="lightboxUrl"
      :filename="lightboxFilename"
    />

    <!-- Sync snackbar -->
    <v-snackbar v-model="syncSnack.show" :color="syncSnack.color" timeout="3000">{{ syncSnack.text }}</v-snackbar>

    <!-- Error snackbar -->
    <v-snackbar v-model="showErrorSnack" color="error" timeout="4000">{{ errorMessage }}</v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';
import { useDisplay } from 'vuetify';
import type { Conversation, Message } from '@/composables/use-chat';
import { api } from '@/api/index';
import { getDeterministicAccountColor } from '@/utils/account-colors';
import { formatFileSize, getFileIcon, getFileIconColor, isImageFile, resolveAttachmentUrl } from '@/utils/file-utils';
import { useStagedMedia } from '@/composables/use-staged-media';
import ChatCopilotBar from './ChatCopilotBar.vue';
import ChatAiDraftCard from './ChatAiDraftCard.vue';
import ChatAnomalyBanner from './ChatAnomalyBanner.vue';
import StagedMediaBar from './StagedMediaBar.vue';
import MediaLightboxDialog from './MediaLightboxDialog.vue';
import { useChatCopilot } from '@/composables/use-chat-copilot';

const { mobile } = useDisplay();

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

const fileInput = ref<HTMLInputElement | null>(null);
function triggerFileInput() {
  fileInput.value?.click();
}

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

const lightboxUrl = ref('');
const lightboxFilename = ref('');
const showLightbox = ref(false);

function openLightbox(url: string, filename?: string) {
  if (!url) return;
  lightboxUrl.value = url;
  lightboxFilename.value = filename || '';
  showLightbox.value = true;
}

const imageRetries = new Set<string>();
const failedImages = ref<Set<string>>(new Set());

function getAttachmentKey(msg: Message, att?: any): string {
  return att?.url || att?.filename || msg.id;
}

async function handleImageError(e: Event, att?: any, msg?: Message) {
  const key = getAttachmentKey(msg || ({} as any), att);
  const target = e.target as HTMLImageElement | null;
  if (!target) {
    failedImages.value.add(key);
    return;
  }

  const filename = att?.filename || target.src.split('/attachments/')[1]?.split('?')[0];
  if (!filename) {
    failedImages.value.add(key);
    return;
  }

  // Thử lấy ticket media một lần
  if (!imageRetries.has(filename)) {
    imageRetries.add(filename);
    try {
      const res = await api.post('/attachments/ticket', { filename });
      if (res.data?.ticket) {
        target.src = `/api/v1/attachments/${encodeURIComponent(filename)}?ticket=${encodeURIComponent(res.data.ticket)}`;
        return;
      }
    } catch (err) {
      console.warn('[chat-image] Failed to refresh media ticket:', err);
    }
  }

  // Nếu vẫn thất bại -> Kích hoạt fallback card
  failedImages.value.add(key);
}

function retryLoadImage(att?: any, msg?: Message) {
  const key = getAttachmentKey(msg || ({} as any), att);
  const target = att?.filename || att?.url?.split('/attachments/')[1]?.split('?')[0];
  if (target) {
    imageRetries.delete(target);
  }
  failedImages.value.delete(key);
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
const syncSnack = ref({ show: false, text: '', color: 'success' });

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
function formatMessageTime(d: string) { return new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); }

function openFile(url: string) {
  if (!url) return;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  } catch {
    // Invalid URL scheme rejected
  }
}

/** Extract image URL from JSON content */
function getImageUrl(msg: Message): string | null {
  if (msg.contentType === 'image' && msg.content) {
    if (msg.content.startsWith('http')) return msg.content;
    try { const p = JSON.parse(msg.content); return p.href || p.thumb || p.hdUrl || null; } catch {}
  }
  if (msg.content?.startsWith('{')) {
    try {
      const p = JSON.parse(msg.content);
      const href = p.href || p.thumb || '';
      if (href && /\.(jpg|jpeg|png|webp|gif)/i.test(href)) return href;
      if (href && href.includes('zdn.vn') && !p.params?.includes('fileExt')) return href;
    } catch {}
  }
  return null;
}

/** Extract file info from JSON content (PDF, docs, etc.) */
function getFileInfo(msg: Message): { name: string; size: string; href: string } | null {
  if (!msg.content?.startsWith('{')) return null;
  try {
    const p = JSON.parse(msg.content);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    if (params?.fileExt || params?.fType === 1) {
      const bytes = parseInt(params.fileSize || '0');
      const size = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
      return { name: p.title || `file.${params.fileExt || 'unknown'}`, size, href: p.href || '' };
    }
  } catch {}
  return null;
}

function isImageFilenameOrPlaceholder(str: string): boolean {
  const trimmed = str.trim();
  if (!trimmed) return true;
  if (trimmed === '[Hình ảnh]' || trimmed === 'Ảnh' || trimmed === '[Ảnh]') return true;
  if (/\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(trimmed)) return true;
  return false;
}

function hasCustomCaption(msg: Message): boolean {
  if (!msg.content || !msg.content.trim()) return false;
  if (!msg.content.startsWith('{')) return true;
  try {
    const p = JSON.parse(msg.content);
    // Nếu là tin nhắn chia sẻ web link (Link preview) -> Luôn hiển thị
    if (msg.contentType === 'link' || (p.href && p.title && !p.href.includes('zdn.vn') && !p.href.includes('/attachments/'))) {
      return true;
    }
    // Nếu là payload ảnh Zalo:
    if (p.description && p.description.trim() && p.description !== p.href && !isImageFilenameOrPlaceholder(p.description)) {
      return true;
    }
    if (p.title && p.title.trim() && !p.title.startsWith('http') && !isImageFilenameOrPlaceholder(p.title)) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

function getDisplayCaption(msg: Message): string {
  if (!msg.content) return '';
  if (!msg.content.startsWith('{')) return msg.content;
  try {
    const p = JSON.parse(msg.content);
    // Link preview thông thường
    if (msg.contentType === 'link' || (p.href && p.title && !p.href.includes('zdn.vn') && !p.href.includes('/attachments/'))) {
      return p.title ? `🔗 ${p.title}` : p.href;
    }
    if (p.description && p.description !== p.href && !isImageFilenameOrPlaceholder(p.description)) {
      return p.description;
    }
    if (p.title && !p.title.startsWith('http') && !isImageFilenameOrPlaceholder(p.title)) {
      return p.title;
    }
    return '';
  } catch {
    return msg.content;
  }
}

function parseDisplayContent(content: string | null): string {
  if (!content) return '';
  if (!content.startsWith('{')) return content;
  try {
    const p = JSON.parse(content);
    if (p.title && p.href) return `🔗 ${p.title}`;
    if (p.title) return p.title;
    if (p.href) return `🔗 ${p.description || p.href}`;
    return content;
  } catch { return content; }
}

function isReminderMessage(msg: Message): boolean {
  if (!msg.content) return false;
  try { const p = JSON.parse(msg.content); return p.action === 'msginfo.actionlist'; } catch { return false; }
}

function getReminderTitle(msg: Message): string {
  try { return JSON.parse(msg.content!).title || ''; } catch { return msg.content || ''; }
}

function getReminderTime(msg: Message): string | null {
  try {
    const p = JSON.parse(msg.content!);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    for (const h of (params?.highLightsV2 || [])) {
      if (h.ts > 1e12) return new Date(h.ts).toLocaleString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  } catch {}
  return null;
}

/** Sync Zalo reminder to CRM appointments via API */
async function syncAppointment(msg: Message) {
  if (!props.conversation?.contact?.id) { syncSnack.value = { show: true, text: 'Không có thông tin khách hàng', color: 'error' }; return; }
  try {
    const p = JSON.parse(msg.content!);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    let appointmentDate: string | null = null;
    for (const h of (params?.highLightsV2 || [])) {
      if (h.ts > 1e12) { appointmentDate = new Date(h.ts).toISOString(); break; }
    }
    if (!appointmentDate) { syncSnack.value = { show: true, text: 'Không tìm thấy thời gian hẹn', color: 'warning' }; return; }
    await api.post('/appointments', {
      contactId: props.conversation.contact.id,
      appointmentDate,
      appointmentTime: new Date(appointmentDate).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      type: 'tai_kham',
      notes: `[Zalo] ${p.title || ''}`,
    });
    syncSnack.value = { show: true, text: 'Đã đồng bộ lịch hẹn thành công!', color: 'success' };
  } catch (err: any) {
    syncSnack.value = { show: true, text: err.response?.data?.error || 'Đồng bộ thất bại', color: 'error' };
  }
}

watch(() => props.messages.length, async () => { await nextTick(); if (messagesContainer.value) messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight; });
</script>

<style scoped>
.message-bubble {
  box-shadow: none !important;
  border-radius: var(--radius-bubble, 12px) !important;
  border-width: 1.5px !important;
  border-style: solid !important;
}

.msg-contact-bubble {
  background-color: var(--surface-card) !important;
  color: var(--text-main) !important;
  border-color: var(--border-color) !important;
}

.reminder-card {
  padding: 8px 12px;
  border-left: 3px solid var(--primary-brand) !important;
  border: 1.5px solid var(--border-color);
  border-radius: 8px;
  background: var(--surface-variant);
}

.file-card {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--surface-variant);
  border: 1.5px solid var(--border-color);
}

.chat-image {
  max-width: 100%;
  max-height: 300px;
  border-radius: 8px;
  border: 1.5px solid var(--border-color);
  cursor: pointer;
  transition: transform 0.15s ease-in-out;
}

.chat-image:hover {
  transform: scale(1.01);
}

.chat-messages-area {
  min-height: 0;
}

.safety-compose-bar {
  flex-shrink: 0;
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

.message-attachments-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
