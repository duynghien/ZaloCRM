<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { NEO_BRUTALISM_PALETTE, getContrastTextColor } from '../../utils/account-colors';
import type { ConversationTag } from '../../api/conversation-tag-api';

const props = defineProps<{
  show: boolean;
  tag?: ConversationTag | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', data: { name: string; color: string; description?: string }): void;
}>();

const name = ref('');
const color = ref<string>(NEO_BRUTALISM_PALETTE[0]);
const description = ref('');
const error = ref<string | null>(null);

watch(
  () => [props.show, props.tag],
  () => {
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
  },
  { immediate: true }
);

const textColor = computed(() => getContrastTextColor(color.value));

function selectColor(hex: string) {
  color.value = hex;
}

function handleSave() {
  const trimmedName = name.value.trim();
  if (!trimmedName) {
    error.value = 'Vui lòng nhập tên nhãn';
    return;
  }
  if (trimmedName.length > 50) {
    error.value = 'Tên nhãn tối đa 50 ký tự';
    return;
  }
  const trimmedColor = color.value.trim();
  if (!trimmedColor) {
    error.value = 'Vui lòng chọn màu sắc';
    return;
  }
  emit('save', {
    name: trimmedName,
    color: trimmedColor,
    description: description.value.trim() || undefined,
  });
}
</script>

<template>
  <div
    v-if="show"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    @click.self="emit('close')"
  >
    <div
      class="w-full max-w-md rounded-none border-2 border-black bg-white p-6 shadow-[6px_6px_0px_0px_#000000]"
    >
      <div class="mb-4 flex items-center justify-between border-b-2 border-black pb-3">
        <h3 class="text-base font-black uppercase tracking-wider text-black">
          {{ tag ? 'Chỉnh sửa nhãn hội thoại' : 'Tạo nhãn mới' }}
        </h3>
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center border-2 border-black font-black hover:bg-neutral-100"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <div v-if="error" class="mb-3 border border-red-500 bg-red-50 p-2 text-xs font-bold text-red-600">
        {{ error }}
      </div>

      <div class="space-y-4">
        <!-- Tag preview badge -->
        <div>
          <label class="mb-1 block text-xs font-bold uppercase text-neutral-600">Xem trước</label>
          <div class="flex items-center gap-2">
            <span
              class="inline-flex items-center rounded-full border border-black px-3 py-1 text-xs font-black shadow-[2px_2px_0_0_#000]"
              :style="{ backgroundColor: color, color: textColor }"
            >
              {{ name.trim() || 'Tên nhãn' }}
            </span>
          </div>
        </div>

        <!-- Name input -->
        <div>
          <label class="mb-1 block text-xs font-bold uppercase text-neutral-700">Tên nhãn *</label>
          <input
            v-model="name"
            type="text"
            maxlength="50"
            placeholder="Ví dụ: Chờ cọc, Khách VIP, Đã chốt..."
            class="w-full border-2 border-black px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>

        <!-- Color Palette -->
        <div>
          <label class="mb-1 block text-xs font-bold uppercase text-neutral-700">Bảng màu Neo-Brutalism</label>
          <div class="grid grid-cols-6 gap-2">
            <button
              v-for="preset in NEO_BRUTALISM_PALETTE"
              :key="preset"
              type="button"
              class="h-8 w-8 rounded-none border-2 border-black transition-transform hover:scale-105"
              :class="{ 'ring-2 ring-black ring-offset-2': color.toUpperCase() === preset.toUpperCase() }"
              :style="{ backgroundColor: preset }"
              @click="selectColor(preset)"
            />
          </div>
          <div class="mt-2 flex items-center gap-2">
            <input
              v-model="color"
              type="text"
              maxlength="20"
              placeholder="#HEX hoặc tên màu"
              class="w-32 border-2 border-black px-2 py-1 text-xs font-mono font-bold focus:outline-none"
            />
            <span class="text-xs text-neutral-500">Mã màu tùy biến (Hex)</span>
          </div>
        </div>

        <!-- Description -->
        <div>
          <label class="mb-1 block text-xs font-bold uppercase text-neutral-700">Mô tả (tùy chọn)</label>
          <input
            v-model="description"
            type="text"
            maxlength="200"
            placeholder="Ghi chú ngắn về mục đích của nhãn..."
            class="w-full border-2 border-black px-3 py-1.5 text-xs focus:outline-none"
          />
        </div>
      </div>

      <div class="mt-6 flex justify-end gap-2 border-t-2 border-black pt-4">
        <button
          type="button"
          class="border-2 border-black bg-white px-4 py-1.5 text-xs font-bold uppercase text-black hover:bg-neutral-100"
          @click="emit('close')"
        >
          Hủy
        </button>
        <button
          type="button"
          class="border-2 border-black bg-yellow-400 px-4 py-1.5 text-xs font-black uppercase text-black shadow-[2px_2px_0_0_#000] hover:bg-yellow-300 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
          @click="handleSave"
        >
          {{ tag ? 'Lưu thay đổi' : 'Tạo nhãn' }}
        </button>
      </div>
    </div>
  </div>
</template>
