<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { NEO_BRUTALISM_PALETTE, getContrastTextColor } from '../../utils/account-colors';
import type { ConversationTag } from '../../api/conversation-tag-api';

const props = defineProps<{ show: boolean; tag?: ConversationTag | null }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', data: { name: string; color: string; description?: string }): void;
}>();

const name = ref('');
const color = ref<string>(NEO_BRUTALISM_PALETTE[0]);
const description = ref('');
const error = ref<string | null>(null);

watch(() => [props.show, props.tag], () => {
  if (props.tag) {
    name.value = props.tag.name;
    color.value = props.tag.color;
    description.value = props.tag.description || '';
  } else {
    name.value = '';
    color.value = NEO_BRUTALISM_PALETTE[0];
    description.value = '';
  }
  error.value = null;
}, { immediate: true });

const textColor = computed(() => getContrastTextColor(color.value));

function selectColor(hex: string) { color.value = hex; }
function handleColorPicker(event: Event) {
  const target = event.target as HTMLInputElement;
  if (target?.value) color.value = target.value.toUpperCase();
}

function handleSave() {
  const trimmedName = name.value.trim();
  if (!trimmedName) { error.value = 'Vui lòng nhập tên nhãn'; return; }
  if (trimmedName.length > 50) { error.value = 'Tên nhãn tối đa 50 ký tự'; return; }
  const trimmedColor = color.value.trim();
  if (!trimmedColor || !/^#[0-9A-Fa-f]{6}$/.test(trimmedColor)) {
    error.value = 'Mã màu Hex không hợp lệ (Ví dụ: #0068FF)';
    return;
  }
  emit('save', {
    name: trimmedName,
    color: trimmedColor.toUpperCase(),
    description: description.value.trim() || undefined,
  });
}
</script>

<template>
  <v-dialog :model-value="show" max-width="480" persistent @update:model-value="(val: boolean) => { if (!val) emit('close'); }">
    <v-card class="pa-5 neo-tag-dialog-card" elevation="0">
      <div class="d-flex align-center justify-space-between mb-4 pb-2 border-b">
        <div class="d-flex align-center">
          <v-avatar size="32" color="primary" class="rounded-lg mr-2" variant="tonal">
            <v-icon size="18" color="primary">mdi-tag-outline</v-icon>
          </v-avatar>
          <div>
            <div class="font-weight-bold neo-subtitle text-body-2" style="font-size: 0.95rem;">
              {{ tag ? 'CẬP NHẬT NHÃN HỘI THOẠI' : 'TẠO NHÃN HỘI THOẠI MỚI' }}
            </div>
            <div class="text-caption text-grey">Phân loại hội thoại và trạng thái xử lý</div>
          </div>
        </div>
        <v-btn icon="mdi-close" variant="text" size="small" density="compact" @click="emit('close')" />
      </div>

      <v-alert v-if="error" type="error" density="compact" variant="tonal" closable class="mb-3 font-weight-bold" @click:close="error = null">
        {{ error }}
      </v-alert>

      <div class="mb-4 pa-3 rounded-lg preview-box" style="border: 1.5px dashed var(--border-color); background: var(--surface-variant);">
        <div class="text-caption font-weight-bold text-muted mb-2 neo-subtitle" style="font-size: 0.68rem;">XEM TRƯỚC HIỂN THỊ:</div>
        <div class="d-flex align-center gap-2">
          <span class="neo-pill px-3 py-1 font-weight-bold d-inline-flex align-center" :style="{ backgroundColor: color, color: textColor, border: '1.5px solid var(--border-color)' }">
            <span class="tag-preview-bullet mr-1.5" :style="{ backgroundColor: textColor }" />
            {{ name.trim() || 'Tên nhãn mẫu' }}
          </span>
          <span class="text-caption text-grey ml-1">Độ tương phản tự động</span>
        </div>
      </div>

      <div class="mb-3">
        <label class="text-caption font-weight-bold mb-1 d-block text-muted neo-subtitle" style="font-size: 0.72rem;">TÊN NHÃN <span class="text-error">*</span></label>
        <v-text-field v-model="name" placeholder="Ví dụ: Chờ cọc, Khách VIP, Đã chốt đơn..." variant="outlined" density="compact" rounded="lg" maxlength="50" counter hide-details="auto" />
      </div>

      <div class="mb-3">
        <label class="text-caption font-weight-bold mb-1 d-block text-muted neo-subtitle" style="font-size: 0.72rem;">BẢNG MÀU NEO-BRUTALISM:</label>
        <div class="d-flex flex-wrap gap-2 mb-2" style="gap: 8px;">
          <button
            v-for="preset in NEO_BRUTALISM_PALETTE"
            :key="preset"
            type="button"
            class="color-swatch-btn"
            :class="{ 'swatch-active': color.toUpperCase() === preset.toUpperCase() }"
            :style="{ backgroundColor: preset }"
            :title="preset"
            @click="selectColor(preset)"
          >
            <v-icon v-if="color.toUpperCase() === preset.toUpperCase()" size="14" :color="getContrastTextColor(preset)">mdi-check</v-icon>
          </button>
        </div>

        <div class="d-flex align-center gap-2 mt-2">
          <div class="color-picker-wrapper">
            <input type="color" :value="color" class="native-color-picker" @input="handleColorPicker" />
            <div class="color-picker-preview" :style="{ backgroundColor: color }" />
          </div>
          <v-text-field v-model="color" label="Mã màu HEX" placeholder="#0068FF" variant="outlined" density="compact" rounded="lg" maxlength="7" hide-details style="max-width: 140px;" class="font-mono" />
          <span class="text-caption text-grey">Click ô màu để mở bảng chọn tự do</span>
        </div>
      </div>

      <div class="mb-4">
        <label class="text-caption font-weight-bold mb-1 d-block text-muted neo-subtitle" style="font-size: 0.72rem;">MÔ TẢ (TÙY CHỌN):</label>
        <v-text-field v-model="description" placeholder="Ghi chú ngắn về mục đích sử dụng..." variant="outlined" density="compact" rounded="lg" maxlength="200" hide-details />
      </div>

      <div class="d-flex justify-end gap-2 pt-3 border-t">
        <v-btn variant="outlined" rounded="lg" class="px-4" @click="emit('close')">Hủy</v-btn>
        <v-btn color="primary" rounded="lg" class="primary-cta-btn font-weight-bold px-5" @click="handleSave">
          {{ tag ? 'Lưu thay đổi' : 'Tạo nhãn' }}
        </v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.neo-tag-dialog-card { border: 1.5px solid var(--border-color) !important; border-radius: 12px !important; background-color: var(--surface-card, #FFFFFF) !important; }
.tag-preview-bullet { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.color-swatch-btn { width: 32px; height: 32px; border-radius: 6px; border: 1.5px solid var(--border-color); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform 0.15s ease, box-shadow 0.15s ease; padding: 0; }
.color-swatch-btn:hover { transform: scale(1.15); }
.swatch-active { box-shadow: 0 0 0 2px var(--surface-card, #ffffff), 0 0 0 4px var(--border-color, #111827); transform: scale(1.1); }
.color-picker-wrapper { position: relative; width: 38px; height: 38px; border: 1.5px solid var(--border-color); border-radius: 8px; overflow: hidden; cursor: pointer; flex-shrink: 0; }
.native-color-picker { position: absolute; top: -10px; left: -10px; width: 60px; height: 60px; opacity: 0; cursor: pointer; }
.color-picker-preview { width: 100%; height: 100%; }
</style>
