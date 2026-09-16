<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="480"
  >
    <v-card class="pa-4" style="border: 1.5px solid var(--border-color); border-radius: 12px;">
      <v-card-title class="font-weight-bold neo-subtitle pa-0 mb-3" style="font-size: 1rem;">
        CẤU HÌNH THƯƠNG HIỆU & MÃ MÀU
      </v-card-title>

      <v-card-text class="pa-0">
        <!-- Live Preview -->
        <div class="mb-4 pa-3 rounded-lg preview-box" style="border: 1.5px dashed var(--border-color); background: var(--surface-variant);">
          <div class="text-caption font-weight-bold text-muted mb-2 neo-subtitle" style="font-size: 0.68rem;">
            XEM TRƯỚC HIỂN THỊ:
          </div>
          <div class="d-flex align-center">
            <div
              class="preview-avatar mr-3 d-flex align-center justify-center font-weight-bold"
              :style="{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                border: '1.5px solid var(--border-color)',
                backgroundColor: previewColor,
                color: previewTextColor,
              }"
            >
              {{ previewMonogram }}
            </div>
            <div>
              <div class="font-weight-bold text-body-2">
                {{ form.displayName || 'Tên Zalo' }}
              </div>
              <div class="d-flex align-center mt-1">
                <span
                  v-if="form.branchTag"
                  class="neo-pill px-2 py-0 font-weight-bold"
                  :style="{
                    backgroundColor: previewColor,
                    color: previewTextColor,
                    fontSize: '0.68rem !important',
                  }"
                >
                  {{ form.branchTag }}
                </span>
                <span v-else class="text-caption text-muted">
                  (Chưa đặt thương hiệu / chi nhánh)
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Form fields -->
        <v-text-field
          v-model="form.displayName"
          label="Tên hiển thị"
          placeholder="VD: Zalo Sale Hương"
          variant="outlined"
          density="compact"
          rounded="lg"
          class="mb-3"
          hide-details
        />

        <v-text-field
          v-model="form.branchTag"
          label="Thương hiệu / Chi nhánh"
          placeholder="VD: Chi nhánh Hà Nội, Brand Luxury..."
          variant="outlined"
          density="compact"
          rounded="lg"
          class="mb-3"
          hide-details
        />

        <!-- Color Palette Selection -->
        <div class="mb-2">
          <label class="text-caption font-weight-bold mb-1 d-block text-muted neo-subtitle" style="font-size: 0.72rem;">
            MÃ MÀU NHẬN DIỆN (NEO-BRUTALISM PALETTE):
          </label>
          <div class="d-flex flex-wrap gap-2 mb-2" style="gap: 8px;">
            <button
              v-for="color in NEO_BRUTALISM_PALETTE"
              :key="color"
              type="button"
              class="color-swatch-btn"
              :class="{ 'swatch-active': form.colorTag?.toUpperCase() === color }"
              :style="{ backgroundColor: color }"
              :title="color"
              @click="form.colorTag = color"
            />
          </div>

          <v-text-field
            v-model="form.colorTag"
            label="Mã màu HEX tùy chỉnh"
            placeholder="#0068FF"
            variant="outlined"
            density="compact"
            rounded="lg"
            hide-details
            :rules="[validateHexColor]"
          >
            <template #prepend-inner>
              <span
                class="color-indicator-box mr-1"
                :style="{ backgroundColor: previewColor }"
              />
            </template>
          </v-text-field>
        </div>

        <v-alert
          v-if="errorMessage"
          type="error"
          density="compact"
          class="mt-2"
        >
          {{ errorMessage }}
        </v-alert>
      </v-card-text>

      <v-card-actions class="pa-0 mt-4">
        <v-spacer />
        <v-btn
          rounded="lg"
          @click="$emit('update:modelValue', false)"
        >
          Hủy
        </v-btn>
        <v-btn
          color="primary"
          rounded="lg"
          class="font-weight-bold text-white px-4"
          style="border: 1.5px solid var(--border-color);"
          :loading="saving"
          @click="handleSave"
        >
          Lưu thay đổi
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue';
import type { ZaloAccount } from '@/composables/use-zalo-accounts';
import {
  NEO_BRUTALISM_PALETTE,
  getDeterministicAccountColor,
  getAccountMonogram,
  getContrastTextColor,
} from '@/utils/account-colors';

const props = defineProps<{
  modelValue: boolean;
  account: ZaloAccount | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'save', payload: { id: string; displayName?: string | null; branchTag?: string | null; colorTag?: string | null }): void;
}>();

const saving = ref(false);
const errorMessage = ref('');

const form = reactive({
  displayName: '',
  branchTag: '',
  colorTag: '',
});

watch(
  () => props.account,
  (acc) => {
    if (acc) {
      form.displayName = acc.displayName || '';
      form.branchTag = acc.branchTag || '';
      form.colorTag = acc.colorTag || getDeterministicAccountColor(acc.id, acc.colorTag);
      errorMessage.value = '';
    }
  },
  { immediate: true },
);

const previewColor = computed(() => {
  if (form.colorTag && /^#[0-9A-Fa-f]{6}$/.test(form.colorTag.trim())) {
    return form.colorTag.trim().toUpperCase();
  }
  return getDeterministicAccountColor(props.account?.id, null);
});

const previewTextColor = computed(() => {
  return getContrastTextColor(previewColor.value);
});

const previewMonogram = computed(() => {
  return getAccountMonogram(
    form.branchTag,
    form.displayName,
    props.account?.phone,
    props.account?.zaloUid,
  );
});

function validateHexColor(value: string) {
  if (!value) return true;
  return /^#[0-9A-Fa-f]{6}$/.test(value.trim()) || 'Mã màu phải là định dạng hex chuẩn (#RRGGBB)';
}

async function handleSave() {
  if (!props.account) return;

  if (form.colorTag && !/^#[0-9A-Fa-f]{6}$/.test(form.colorTag.trim())) {
    errorMessage.value = 'Mã màu không hợp lệ, vui lòng nhập định dạng #RRGGBB (ví dụ: #0068FF)';
    return;
  }

  saving.value = true;
  errorMessage.value = '';

  try {
    emit('save', {
      id: props.account.id,
      displayName: form.displayName.trim() || null,
      branchTag: form.branchTag.trim() || null,
      colorTag: form.colorTag.trim() ? form.colorTag.trim().toUpperCase() : null,
    });
  } catch (err: any) {
    errorMessage.value = err.message || 'Lưu thất bại';
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.color-swatch-btn {
  width: 28px;
  height: 28px;
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

.color-indicator-box {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  display: inline-block;
}
</style>
