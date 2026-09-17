<template>
  <div v-if="files.length > 0" class="staged-media-bar pa-2">
    <div class="d-flex align-center staged-media-list">
      <div
        v-for="(item, index) in files"
        :key="item.file.name + index"
        class="staged-card d-flex align-center mr-2 pa-1 px-2"
      >
        <!-- Thumbnail or File Icon -->
        <div class="staged-thumb mr-2 d-flex align-center justify-center">
          <img
            v-if="item.isImage && item.previewUrl"
            :src="item.previewUrl"
            alt="Preview"
            class="staged-img"
          />
          <v-icon
            v-else
            :icon="getFileIcon(item.file.name)"
            :color="getFileIconColor(item.file.name)"
            size="24"
          />
        </div>

        <!-- File Meta -->
        <div class="staged-meta flex-grow-1 overflow-hidden pr-1">
          <div class="text-caption font-weight-medium text-truncate" style="max-width: 110px;">
            {{ item.originalName || item.file.name }}
          </div>
          <div class="text-caption text-grey" style="font-size: 0.7rem;">
            {{ formatFileSize(item.size || item.file.size) }}
          </div>
        </div>

        <!-- Remove Button -->
        <v-btn
          icon="mdi-close"
          size="x-small"
          variant="text"
          density="compact"
          class="remove-btn ml-1"
          :disabled="uploading"
          @click="$emit('remove', index)"
        />
      </div>
    </div>

    <!-- Uploading indicator -->
    <v-progress-linear
      v-if="uploading"
      indeterminate
      color="primary"
      height="2"
      class="mt-1"
    />
  </div>
</template>

<script setup lang="ts">
export interface StagedFileItem {
  file: File;
  id?: string;
  originalName: string;
  size: number;
  mimeType: string;
  isImage: boolean;
  previewUrl?: string;
}

defineProps<{
  files: StagedFileItem[];
  uploading?: boolean;
}>();

defineEmits<{
  remove: [index: number];
}>();

import { formatFileSize, getFileIcon, getFileIconColor } from '@/utils/file-utils';
</script>

<style scoped>
.staged-media-bar {
  flex-shrink: 0;
  min-height: 64px;
  box-sizing: border-box;
  background-color: var(--bg-surface, #ffffff);
  border-top: 1.5px solid var(--border-color);
  overflow-x: auto;
  white-space: nowrap;
  position: relative;
  z-index: 5;
}

.staged-media-list {
  overflow-x: auto;
  scrollbar-width: thin;
  padding-bottom: 2px;
}

.staged-card {
  background-color: var(--bg-main, #f5f2eb);
  border: 1.5px solid var(--border-color);
  border-radius: 8px;
  min-width: 160px;
  max-width: 200px;
  height: 48px;
  flex-shrink: 0;
}

.staged-thumb {
  width: 32px;
  height: 32px;
  border-radius: 4px;
  overflow: hidden;
  background-color: var(--bg-surface, #ffffff);
  border: 1px solid var(--border-color);
}

.staged-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.remove-btn {
  opacity: 0.7;
  transition: opacity 0.15s;
}

.remove-btn:hover {
  opacity: 1;
  color: var(--color-error, #ef4444);
}
</style>
