<template>
  <div
    class="mb-2 d-flex"
    :class="senderType === 'self' ? 'justify-end' : 'justify-start'"
  >
    <div style="max-width: 70%;">
      <!-- Group Sender Name -->
      <div
        v-if="conversation.threadType === 'group' && senderType !== 'self'"
        class="text-caption mb-1 font-weight-bold"
        style="color: var(--primary-brand);"
      >
        {{ senderName || 'Unknown' }}
      </div>

      <!-- Album Item -->
      <div
        v-if="item.type === 'album'"
        class="message-bubble pa-2 px-3"
        :class="senderType === 'self' ? 'bg-primary text-white' : 'msg-contact-bubble'"
        style="word-wrap: break-word;"
      >
        <!-- Deleted Album -->
        <div v-if="item.isDeleted" class="text-decoration-line-through font-italic" style="opacity: 0.6;">
          (tin nhắn)<span class="text-caption"> (đã thu hồi)</span>
        </div>
        <!-- Active Photo Grid -->
        <MessagePhotoGrid
          v-else
          :album="item"
          :failed-images="failedImages"
          @open-lightbox="$emit('open-gallery', $event)"
          @image-error="$emit('album-image-error', $event)"
          @retry-image="$emit('retry-album-image', $event)"
        />
        <!-- Timestamp -->
        <div class="text-caption mt-1 msg-time" :class="senderType === 'self' ? 'msg-time-self' : 'msg-time-contact'" style="font-size: 0.7rem;">
          {{ formatMessageTime(item.sentAt) }}
        </div>
      </div>

      <!-- Single Message Item -->
      <div
        v-else
        class="message-bubble pa-2 px-3"
        :class="senderType === 'self' ? 'bg-primary text-white' : 'msg-contact-bubble'"
        style="word-wrap: break-word;"
      >
        <!-- Deleted -->
        <div v-if="item.message.isDeleted" class="text-decoration-line-through font-italic" style="opacity: 0.6;">
          {{ item.message.content || '(tin nhắn)' }}<span class="text-caption"> (đã thu hồi)</span>
        </div>

        <!-- Structured multi-attachment (new format) -->
        <div v-else-if="item.message.attachments && item.message.attachments.length > 0">
          <!-- Text/Caption on top -->
          <div v-if="hasCustomCaption(item.message)" class="mb-2 msg-text-body">
            <template v-for="(seg, sIdx) in getCaptionSegments(item.message)" :key="sIdx">
              <hr v-if="seg.type === 'divider'" class="msg-divider" />
              <span v-else>{{ seg.content }}</span>
            </template>
          </div>
          <!-- Attachments below -->
          <div class="message-attachments-container">
            <div v-for="(att, attIdx) in item.message.attachments" :key="att.filename || attIdx" class="mb-1">
              <!-- Image attachment -->
              <div v-if="isImageFile(att.filename || att.originalName, att.mimeType, att.url)">
                <img
                  v-if="!failedImages.has(getAttachmentKey(item.message, att))"
                  :src="resolveAttachmentUrl(att.url)"
                  :alt="att.originalName || 'Hình ảnh'"
                  class="chat-image"
                  loading="lazy"
                  decoding="async"
                  referrerpolicy="no-referrer"
                  @click="$emit('open-lightbox', resolveAttachmentUrl(att.url), att.originalName || att.filename)"
                  @error="$emit('image-error', { event: $event, att, msg: item.message })"
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
                    @click="$emit('retry-image', { att, msg: item.message })"
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
                <v-btn icon size="x-small" variant="text" @click="$emit('open-file', resolveAttachmentUrl(att.url))">
                  <v-icon size="16">mdi-download</v-icon>
                </v-btn>
              </div>
            </div>
          </div>
        </div>

        <!-- Single Image -->
        <div v-else-if="getImageUrl(item.message)">
          <!-- Text/Caption on top -->
          <div v-if="hasCustomCaption(item.message)" class="mb-2 msg-text-body">
            <template v-for="(seg, sIdx) in getCaptionSegments(item.message)" :key="sIdx">
              <hr v-if="seg.type === 'divider'" class="msg-divider" />
              <span v-else>{{ seg.content }}</span>
            </template>
          </div>
          <!-- Image below -->
          <div>
            <img
              v-if="!failedImages.has(getAttachmentKey(item.message))"
              :src="resolveAttachmentUrl(getImageUrl(item.message)!)"
              alt="Hình ảnh"
              class="chat-image"
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
              @click="$emit('open-lightbox', resolveAttachmentUrl(getImageUrl(item.message)!))"
              @error="$emit('image-error', { event: $event, att: undefined, msg: item.message })"
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
                @click="$emit('retry-image', { att: undefined, msg: item.message })"
              >
                Thử lại
              </v-btn>
            </div>
          </div>
        </div>

        <!-- File/PDF -->
        <div v-else-if="getFileInfo(item.message)">
          <!-- Optional Caption on top -->
          <div v-if="hasCustomCaption(item.message)" class="mb-2 msg-text-body">
            <template v-for="(seg, sIdx) in getCaptionSegments(item.message)" :key="sIdx">
              <hr v-if="seg.type === 'divider'" class="msg-divider" />
              <span v-else>{{ seg.content }}</span>
            </template>
          </div>
          <!-- File card below -->
          <div class="file-card">
            <v-icon size="20" class="mr-2" :color="getFileIconColor(getFileInfo(item.message)!.name)">
              {{ getFileIcon(getFileInfo(item.message)!.name) }}
            </v-icon>
            <div class="flex-grow-1 overflow-hidden mr-2">
              <div class="text-body-2 font-weight-medium text-truncate">{{ getFileInfo(item.message)!.name }}</div>
              <div class="text-caption" style="opacity: 0.6;">{{ getFileInfo(item.message)!.size }}</div>
            </div>
            <v-btn v-if="getFileInfo(item.message)!.href" icon size="x-small" variant="text" @click="$emit('open-file', resolveAttachmentUrl(getFileInfo(item.message)!.href))">
              <v-icon size="16">mdi-download</v-icon>
            </v-btn>
          </div>
        </div>

        <!-- Sticker -->
        <div v-else-if="item.message.contentType === 'sticker'">
          <img
            v-if="item.message.content"
            :src="item.message.content"
            alt="Sticker"
            style="max-width: 130px; max-height: 130px; object-fit: contain;"
            loading="lazy"
          />
          <span v-else>[Sticker]</span>
        </div>

        <!-- Voice -->
        <div v-else-if="item.message.contentType === 'voice'" class="d-flex align-center">
          <v-icon size="20" class="mr-2">mdi-microphone</v-icon>
          <audio v-if="item.message.content" controls :src="resolveAttachmentUrl(item.message.content)" style="max-width: 220px; height: 32px;" />
          <span v-else>[Tin nhắn thoại]</span>
        </div>

        <!-- Video -->
        <div v-else-if="item.message.contentType === 'video'">
          <video v-if="item.message.content" controls :src="resolveAttachmentUrl(item.message.content)" style="max-width: 280px; max-height: 200px; border-radius: 8px;" />
          <span v-else>[Video]</span>
        </div>

        <!-- GIF -->
        <div v-else-if="item.message.contentType === 'gif'">GIF</div>

        <!-- Reminder/Calendar -->
        <div v-else-if="isReminderMessage(item.message)" class="reminder-card">
          <div class="d-flex align-center mb-1">
            <v-icon size="16" color="warning" class="mr-1">mdi-calendar-clock</v-icon>
            <span class="text-caption font-weight-bold" style="color: #FFB74D;">Nhắc hẹn</span>
          </div>
          <div class="text-body-2">{{ getReminderTitle(item.message) }}</div>
          <div v-if="getReminderTime(item.message)" class="text-caption mt-1" style="opacity: 0.7;">
            <v-icon size="12" class="mr-1">mdi-clock-outline</v-icon>{{ getReminderTime(item.message) }}
          </div>
          <v-btn size="x-small" variant="tonal" color="warning" class="mt-2" prepend-icon="mdi-calendar-sync" @click="$emit('sync-appointment', item.message)">
            Đồng bộ lịch
          </v-btn>
        </div>

        <!-- Default text -->
        <div v-else class="msg-text-body">
          <template v-for="(seg, sIdx) in getMessageSegments(item.message.content)" :key="sIdx">
            <hr v-if="seg.type === 'divider'" class="msg-divider" />
            <span v-else>{{ seg.content }}</span>
          </template>
        </div>

        <!-- Timestamp -->
        <div class="text-caption mt-1 msg-time" :class="item.message.senderType === 'self' ? 'msg-time-self' : 'msg-time-contact'" style="font-size: 0.7rem;">
          {{ formatMessageTime(item.message.sentAt) }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Conversation, Message } from '@/composables/use-chat';
import type { RenderItem, AlbumImage } from '@/utils/chat-message-clustering';
import {
  parseFormattedSegments,
  getFileInfo,
  getImageUrl,
  hasCustomCaption,
  getDisplayCaption,
  parseDisplayContent,
  isReminderMessage,
  type TextSegment,
} from '@/utils/chat-message-formatter';
import {
  formatFileSize,
  getFileIcon,
  getFileIconColor,
  isImageFile,
  resolveAttachmentUrl,
} from '@/utils/file-utils';
import MessagePhotoGrid from './MessagePhotoGrid.vue';

const props = defineProps<{
  item: RenderItem;
  conversation: Conversation;
  failedImages: Set<string>;
}>();

defineEmits<{
  (e: 'open-lightbox', url: string, filename?: string): void;
  (e: 'open-gallery', payload: { index: number; images: AlbumImage[] }): void;
  (e: 'open-file', url: string): void;
  (e: 'image-error', payload: { event: Event; att?: any; msg?: Message }): void;
  (e: 'retry-image', payload: { att?: any; msg?: Message }): void;
  (e: 'album-image-error', payload: { event: Event; image: AlbumImage }): void;
  (e: 'retry-album-image', image: AlbumImage): void;
  (e: 'sync-appointment', msg: Message): void;
}>();

const senderType = computed(() => (props.item.type === 'message' ? props.item.message.senderType : props.item.senderType));
const senderName = computed(() => (props.item.type === 'message' ? props.item.message.senderName : props.item.senderName));

function getMessageSegments(content: string | null): TextSegment[] {
  const displayContent = parseDisplayContent(content);
  return parseFormattedSegments(displayContent);
}

function getCaptionSegments(msg: Message): TextSegment[] {
  const caption = getDisplayCaption(msg);
  return parseFormattedSegments(caption);
}

function getAttachmentKey(msg: Message, att?: any): string {
  return att?.url || att?.filename || msg.id;
}

function getReminderTitle(msg: Message): string {
  try {
    return JSON.parse(msg.content!).title || '';
  } catch {
    return msg.content || '';
  }
}

function getReminderTime(msg: Message): string | null {
  try {
    const p = JSON.parse(msg.content!);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    for (const h of params?.highLightsV2 || []) {
      if (h.ts > 1e12) {
        return new Date(h.ts).toLocaleString('vi-VN', {
          weekday: 'long',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      }
    }
  } catch {}
  return null;
}

function formatMessageTime(d: string) {
  return new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}
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

.message-attachments-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.msg-text-body {
  white-space: pre-wrap;
  line-height: 1.55;
  word-break: break-word;
  font-size: 0.875rem;
}

.msg-divider {
  border: none;
  border-top: 1px solid currentColor;
  opacity: 0.25;
  margin: 6px 0;
}
</style>
