<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="440"
  >
    <v-card class="pa-4" style="border: 1.5px solid var(--border-color); border-radius: 12px;">
      <v-card-title class="font-weight-bold neo-subtitle pa-0 mb-3" style="font-size: 0.95rem;">
        THÊM TÀI KHOẢN ZALO
      </v-card-title>

      <v-card-text class="pa-0">
        <v-text-field
          v-model="name"
          label="Tên hiển thị (VD: Zalo Sale Hương)"
          variant="outlined"
          density="compact"
          rounded="lg"
          class="mb-3"
          hide-details
        />
        <v-text-field
          v-model="branch"
          label="Thương hiệu / Chi nhánh (VD: Chi nhánh Hà Nội)"
          variant="outlined"
          density="compact"
          rounded="lg"
          class="mb-3"
          hide-details
        />
        <div class="mb-2">
          <label class="text-caption font-weight-bold mb-1 d-block text-muted neo-subtitle" style="font-size: 0.72rem;">
            MÀU NHẬN DIỆN:
          </label>
          <div class="d-flex flex-wrap gap-2 mb-2" style="gap: 6px;">
            <button
              v-for="color in NEO_BRUTALISM_PALETTE"
              :key="color"
              type="button"
              class="color-swatch-btn"
              :class="{ 'swatch-active': colorTag?.toUpperCase() === color }"
              :style="{ backgroundColor: color }"
              :title="color"
              @click="colorTag = color"
            />
          </div>
          <v-text-field
            v-model="colorTag"
            label="Mã màu HEX (tùy chọn)"
            placeholder="#0068FF"
            variant="outlined"
            density="compact"
            rounded="lg"
            hide-details
          />
        </div>
      </v-card-text>

      <v-card-actions class="pa-0 mt-3">
        <v-spacer />
        <v-btn rounded="lg" @click="$emit('update:modelValue', false)">Hủy</v-btn>
        <v-btn
          color="primary"
          rounded="lg"
          class="font-weight-bold text-white px-4"
          style="border: 1.5px solid var(--border-color);"
          :loading="loading"
          @click="handleSubmit"
        >
          Thêm
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { NEO_BRUTALISM_PALETTE } from '@/utils/account-colors';

const props = defineProps<{
  modelValue: boolean;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'add', payload: { name: string; branch: string; color: string }): void;
}>();

const name = ref('');
const branch = ref('');
const colorTag = ref('');

watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      name.value = '';
      branch.value = '';
      colorTag.value = '';
    }
  },
);

function handleSubmit() {
  emit('add', {
    name: name.value.trim(),
    branch: branch.value.trim(),
    color: colorTag.value.trim().toUpperCase(),
  });
}
</script>

<style scoped>
.color-swatch-btn {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 1.5px solid var(--border-color);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  padding: 0;
}

.color-swatch-btn:hover {
  transform: scale(1.15);
}

.swatch-active {
  box-shadow: 0 0 0 2px var(--surface-card, #ffffff), 0 0 0 4px var(--border-color, #111827);
  transform: scale(1.1);
}
</style>
