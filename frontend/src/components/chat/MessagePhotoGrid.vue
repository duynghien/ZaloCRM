<template>
  <div class="message-photo-grid-wrapper">
    <!-- Grid container -->
    <div :class="['photo-grid', gridClass]">
      <div
        v-for="(img, idx) in visibleImages"
        :key="img.url || idx"
        class="grid-item"
        :class="{ 'has-overlay': isLastVisibleWithOverlay(idx) }"
        @click="onImageClick(idx)"
      >
        <!-- HD badge -->
        <span class="hd-badge">HD</span>

        <!-- Image or Fallback -->
        <img
          v-if="!isImageFailed(img)"
          :src="resolveAttachmentUrl(img.url)"
          :alt="img.originalName || img.filename || 'Hình ảnh'"
          class="grid-img"
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          @error="onImageError($event, img)"
        />

        <div v-else class="image-fallback-card pa-2 text-center" @click.stop>
          <v-icon size="20" color="grey-darken-1">mdi-image-off-outline</v-icon>
          <div class="text-caption mt-1 text-grey-darken-1">Ảnh lỗi</div>
          <v-btn
            size="x-small"
            variant="text"
            color="primary"
            class="mt-1"
            prepend-icon="mdi-reload"
            @click.stop="$emit('retry-image', img)"
          >
            Thử lại
          </v-btn>
        </div>

        <!-- +N Overlay on the last visible image -->
        <div v-if="isLastVisibleWithOverlay(idx)" class="more-overlay">
          +{{ remainingCount }}
        </div>
      </div>
    </div>

    <!-- Caption text below the grid -->
    <div v-if="album.caption && captionSegments.length > 0" class="album-caption mt-2 pt-2">
      <template v-for="(seg, sIdx) in captionSegments" :key="sIdx">
        <hr v-if="seg.type === 'divider'" class="msg-divider" />
        <span v-else>{{ seg.content }}</span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PhotoAlbumItem, AlbumImage } from '@/utils/chat-message-clustering';
import { resolveAttachmentUrl } from '@/utils/file-utils';
import { parseFormattedSegments, parseDisplayContent } from '@/utils/chat-message-formatter';

const props = withDefaults(
  defineProps<{
    album: PhotoAlbumItem;
    maxVisible?: number;
    failedImages?: Set<string>;
  }>(),
  {
    maxVisible: 4,
    failedImages: () => new Set<string>(),
  }
);

const emit = defineEmits<{
  (e: 'open-lightbox', payload: { index: number; images: AlbumImage[] }): void;
  (e: 'image-error', payload: { event: Event; image: AlbumImage }): void;
  (e: 'retry-image', image: AlbumImage): void;
}>();

const visibleImages = computed(() => {
  return props.album.images.slice(0, props.maxVisible);
});

const remainingCount = computed(() => {
  return Math.max(0, props.album.images.length - props.maxVisible + 1);
});

const gridClass = computed(() => {
  const count = visibleImages.value.length;
  if (count <= 1) return 'grid-1';
  if (count === 2) return 'grid-2';
  if (count === 3) return 'grid-3';
  return 'grid-4';
});

function isLastVisibleWithOverlay(idx: number): boolean {
  return idx === props.maxVisible - 1 && props.album.images.length > props.maxVisible;
}

function isImageFailed(img: AlbumImage): boolean {
  if (!props.failedImages) return false;
  return (
    props.failedImages.has(img.url) ||
    (img.filename ? props.failedImages.has(img.filename) : false)
  );
}

function onImageClick(idx: number) {
  emit('open-lightbox', {
    index: idx,
    images: [...props.album.images],
  });
}

function onImageError(event: Event, image: AlbumImage) {
  emit('image-error', { event, image });
}

const captionSegments = computed(() => {
  if (!props.album.caption) return [];
  const display = parseDisplayContent(props.album.caption);
  return parseFormattedSegments(display);
});
</script>

<style scoped>
.message-photo-grid-wrapper {
  max-width: 360px;
  width: 100%;
}

.photo-grid {
  display: grid;
  gap: 4px;
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
}

.grid-1 {
  grid-template-columns: 1fr;
}

.grid-1 .grid-item {
  max-height: 320px;
  aspect-ratio: auto;
}

.grid-1 .grid-img {
  max-height: 320px;
  object-fit: cover;
}

.grid-2 {
  grid-template-columns: 1fr 1fr;
}

.grid-3 {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}

.grid-3 .grid-item:first-child {
  grid-row: 1 / span 2;
  aspect-ratio: auto;
  height: 100%;
}

.grid-4 {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}

.grid-item {
  position: relative;
  overflow: hidden;
  border-radius: 6px;
  border: 1.5px solid var(--border-color);
  aspect-ratio: 1 / 1;
  background-color: rgba(0, 0, 0, 0.04);
  cursor: pointer;
  transition: transform 0.15s ease;
}

.grid-item:hover {
  transform: scale(1.02);
  z-index: 1;
}

.grid-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.hd-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 2;
  background: rgba(0, 0, 0, 0.55);
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  pointer-events: none;
  line-height: 1.2;
}

.more-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  color: #ffffff;
  font-size: 20px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
  user-select: none;
}

.image-fallback-card {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.05);
}

.album-caption {
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  font-size: 14px;
  line-height: 1.4;
  word-break: break-word;
}

.msg-divider {
  border: none;
  border-top: 1px dashed rgba(0, 0, 0, 0.2);
  margin: 6px 0;
}
</style>
