<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="1000"
    content-class="elevation-0"
  >
    <div class="lightbox-wrapper pa-3">
      <!-- Toolbar -->
      <div class="lightbox-toolbar d-flex align-center justify-space-between mb-2">
        <div class="text-subtitle-2 font-weight-bold text-truncate text-white" style="max-width: 70%;">
          {{ filename || 'Xem ảnh' }}
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
        <img
          :src="imageUrl"
          alt="Hình ảnh phóng to"
          class="lightbox-img"
          @click.stop
        />
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean;
  imageUrl: string;
  filename?: string;
}>();

defineEmits<{
  'update:modelValue': [value: boolean];
}>();

function downloadImage() {
  if (!props.imageUrl) return;
  const link = document.createElement('a');
  link.href = props.imageUrl;
  link.download = props.filename || 'image.png';
  link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
</script>

<style scoped>
.lightbox-wrapper {
  background-color: rgba(24, 24, 27, 0.92);
  border: 2px solid var(--border-color);
  border-radius: 12px;
  backdrop-filter: blur(8px);
}

.lightbox-toolbar {
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}

.neo-btn {
  border: 1.5px solid var(--border-color);
  border-radius: 6px;
}

.lightbox-content {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 0;
  cursor: pointer;
}

.lightbox-img {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
  border-radius: 8px;
  border: 2px solid var(--border-color);
  background-color: #000000;
  box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.5);
}
</style>
