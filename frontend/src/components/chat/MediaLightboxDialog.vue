<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="1100"
    content-class="elevation-0"
  >
    <div class="lightbox-wrapper pa-3">
      <!-- Toolbar -->
      <div class="lightbox-toolbar d-flex align-center justify-space-between mb-2">
        <div class="text-subtitle-2 font-weight-bold text-truncate text-white" style="max-width: 70%;">
          {{ displayTitle }}
        </div>
        <div class="d-flex align-center">
          <v-btn
            icon="mdi-download"
            size="small"
            variant="flat"
            color="surface"
            class="mr-2 neo-btn"
            title="Tải về máy"
            @click="downloadImage"
          />
          <v-btn
            icon="mdi-close"
            size="small"
            variant="flat"
            color="surface"
            class="neo-btn"
            title="Đóng"
            @click="$emit('update:modelValue', false)"
          />
        </div>
      </div>

      <!-- Image Display Area -->
      <div class="lightbox-content text-center" @click="$emit('update:modelValue', false)">
        <!-- Previous Button -->
        <v-btn
          v-if="hasPrev"
          icon="mdi-chevron-left"
          size="large"
          variant="flat"
          color="surface"
          class="nav-btn nav-prev neo-btn"
          title="Ảnh trước (←)"
          @click.stop="prevImage"
        />

        <img
          v-if="currentImage.url"
          :src="resolveAttachmentUrl(currentImage.url)"
          :alt="currentImage.originalName || currentImage.filename || 'Hình ảnh phóng to'"
          class="lightbox-img"
          @click.stop
        />

        <!-- Next Button -->
        <v-btn
          v-if="hasNext"
          icon="mdi-chevron-right"
          size="large"
          variant="flat"
          color="surface"
          class="nav-btn nav-next neo-btn"
          title="Ảnh tiếp theo (→)"
          @click.stop="nextImage"
        />
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { resolveAttachmentUrl } from '@/utils/file-utils';
import { isValidMediaUrl } from '@/utils/chat-message-formatter';

export interface LightboxImageItem {
  url: string;
  hdUrl?: string;
  filename?: string;
  originalName?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    imageUrl?: string;
    filename?: string;
    images?: LightboxImageItem[];
    initialIndex?: number;
  }>(),
  {
    imageUrl: '',
    filename: '',
    images: () => [],
    initialIndex: 0,
  }
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const activeIdx = ref(props.initialIndex || 0);

const totalCount = computed(() => {
  if (props.images && props.images.length > 0) {
    return props.images.length;
  }
  return props.imageUrl ? 1 : 0;
});

const currentImage = computed<LightboxImageItem>(() => {
  if (props.images && props.images.length > 0) {
    const clamped = Math.max(0, Math.min(activeIdx.value, props.images.length - 1));
    return props.images[clamped] || { url: '' };
  }
  return {
    url: props.imageUrl || '',
    filename: props.filename || 'image.png',
  };
});

const displayTitle = computed(() => {
  const name =
    currentImage.value.originalName ||
    currentImage.value.filename ||
    props.filename ||
    'Xem ảnh';
  if (totalCount.value > 1) {
    return `${name} (${activeIdx.value + 1} / ${totalCount.value})`;
  }
  return name;
});

const hasPrev = computed(() => activeIdx.value > 0);
const hasNext = computed(() => activeIdx.value < totalCount.value - 1);

function prevImage() {
  if (hasPrev.value) {
    activeIdx.value--;
  }
}

function nextImage() {
  if (hasNext.value) {
    activeIdx.value++;
  }
}

function downloadImage() {
  const targetUrl = currentImage.value.hdUrl || currentImage.value.url;
  if (!targetUrl || !isValidMediaUrl(targetUrl)) return;

  const resolved = resolveAttachmentUrl(targetUrl);
  const link = document.createElement('a');
  link.href = resolved;
  link.download = currentImage.value.originalName || currentImage.value.filename || 'image.png';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function onKeyDown(e: KeyboardEvent) {
  if (!props.modelValue) return;

  const target = e.target as HTMLElement | null;
  if (target && (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)) {
    return;
  }

  if (e.key === 'ArrowLeft') {
    if (hasPrev.value) {
      e.preventDefault();
      prevImage();
    }
  } else if (e.key === 'ArrowRight') {
    if (hasNext.value) {
      e.preventDefault();
      nextImage();
    }
  }
}

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) {
      activeIdx.value = Math.max(0, Math.min(props.initialIndex || 0, Math.max(0, totalCount.value - 1)));
      window.addEventListener('keydown', onKeyDown);
    } else {
      window.removeEventListener('keydown', onKeyDown);
    }
  },
  { immediate: true }
);

watch(
  () => props.images?.length,
  (newLen) => {
    if (props.images && newLen !== undefined) {
      if (newLen === 0 && !props.imageUrl) {
        emit('update:modelValue', false);
      } else {
        activeIdx.value = Math.min(activeIdx.value, Math.max(0, newLen - 1));
      }
    }
  }
);

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<style scoped>
.lightbox-wrapper {
  background-color: rgba(18, 18, 18, 0.95);
  border: 2px solid var(--border-color);
  border-radius: 12px;
}

.lightbox-toolbar {
  padding-bottom: 8px;
  border-bottom: 1.5px solid rgba(255, 255, 255, 0.2);
}

.neo-btn {
  border: 1.5px solid var(--border-color);
  border-radius: 6px;
}

.lightbox-content {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 12px 0;
  min-height: 200px;
  cursor: pointer;
}

.lightbox-img {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
  border-radius: 8px;
  border: 2px solid var(--border-color);
  background-color: #000000;
  box-shadow: none !important;
}

.nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
  opacity: 0.85;
}

.nav-btn:hover {
  opacity: 1;
}

.nav-prev {
  left: 12px;
}

.nav-next {
  right: 12px;
}
</style>
