<template>
  <div
    v-if="visible && (items.length > 0 || query)"
    class="quick-reply-selector"
    role="listbox"
    aria-label="Gợi ý tin nhắn mẫu"
  >
    <div class="selector-header d-flex align-center justify-space-between px-3 py-2">
      <div class="d-flex align-center gap-1">
        <v-icon size="16" color="primary">mdi-lightning-bolt</v-icon>
        <span class="text-caption font-weight-bold text-uppercase">Tin nhắn mẫu ({{ items.length }})</span>
      </div>
      <v-btn
        v-if="canManage"
        variant="text"
        density="compact"
        size="small"
        class="text-caption font-weight-bold px-1"
        @click.stop="$emit('openManager')"
      >
        <v-icon size="14" start>mdi-cog-outline</v-icon>
        Quản lý
      </v-btn>
    </div>

    <div v-if="items.length > 0" class="selector-list" ref="listRef">
      <div
        v-for="(item, index) in items"
        :key="item.id"
        class="selector-item px-3 py-2 cursor-pointer"
        :class="{ 'item-selected': index === selectedIndex }"
        @click="selectItem(item)"
        @mouseenter="selectedIndex = index"
      >
        <div class="d-flex align-center justify-space-between mb-1">
          <div class="d-flex align-center gap-2">
            <span class="shortcut-pill">/{{ item.shortcut }}</span>
            <span class="item-title text-body-2 font-weight-bold text-truncate">{{ item.title }}</span>
          </div>
          <span class="category-badge text-caption">{{ getCategoryLabel(item.category) }}</span>
        </div>
        <div class="item-preview text-caption text-truncate text-medium-emphasis">
          {{ item.content }}
        </div>
      </div>
    </div>

    <div v-else class="empty-state px-4 py-3 text-center text-caption text-medium-emphasis">
      Không tìm thấy mẫu phù hợp với "<strong>/{{ query }}</strong>"
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useQuickReplies } from '@/composables/use-quick-replies';
import type { QuickReply } from '@/api/quick-reply-api';

const props = withDefaults(
  defineProps<{
    query?: string;
    visible?: boolean;
    canManage?: boolean;
  }>(),
  {
    query: '',
    visible: false,
    canManage: true,
  }
);

const emit = defineEmits<{
  (e: 'select', item: QuickReply): void;
  (e: 'close'): void;
  (e: 'openManager'): void;
}>();

const { filterQuickReplies } = useQuickReplies();
const selectedIndex = ref(0);
const listRef = ref<HTMLElement | null>(null);

const items = computed(() => {
  return filterQuickReplies(props.query || '');
});

watch(
  () => props.query,
  () => {
    selectedIndex.value = 0;
  }
);

watch(
  () => props.visible,
  (val) => {
    if (val) selectedIndex.value = 0;
  }
);

function getCategoryLabel(cat: string): string {
  const map: Record<string, string> = {
    payment: 'Thanh toán',
    address: 'Địa chỉ',
    pricing: 'Báo giá',
    policy: 'Chính sách',
    general: 'Chung',
  };
  return map[cat] || cat;
}

function selectItem(item: QuickReply) {
  emit('select', item);
}

function selectCurrent(): boolean {
  if (items.value.length > 0 && items.value[selectedIndex.value]) {
    selectItem(items.value[selectedIndex.value]);
    return true;
  }
  return false;
}

function navigateDown() {
  if (items.value.length === 0) return;
  selectedIndex.value = (selectedIndex.value + 1) % items.value.length;
  scrollToSelected();
}

function navigateUp() {
  if (items.value.length === 0) return;
  selectedIndex.value = (selectedIndex.value - 1 + items.value.length) % items.value.length;
  scrollToSelected();
}

function scrollToSelected() {
  nextTick(() => {
    if (!listRef.value) return;
    const selectedEl = listRef.value.querySelector('.item-selected') as HTMLElement;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  });
}

defineExpose({
  navigateDown,
  navigateUp,
  selectCurrent,
  selectedIndex,
  items,
});
</script>

<style scoped>
.quick-reply-selector {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 100%;
  max-width: 480px;
  max-height: 320px;
  background: #ffffff;
  border: 1.5px solid #000000;
  box-shadow: 3px 3px 0px #000000;
  z-index: 100;
  display: flex;
  flex-direction: column;
}

.selector-header {
  border-bottom: 1.5px solid #000000;
  background: #f8fafc;
}

.selector-list {
  overflow-y: auto;
  max-height: 260px;
}

.selector-item {
  border-bottom: 1px solid #e2e8f0;
  transition: background-color 0.1s ease;
}

.selector-item:last-child {
  border-bottom: none;
}

.item-selected {
  background-color: #fef08a !important;
}

.shortcut-pill {
  font-family: 'Space Grotesk', monospace;
  font-weight: 700;
  font-size: 0.75rem;
  padding: 1px 6px;
  background: #e2e8f0;
  border: 1px solid #000000;
  border-radius: 4px;
}

.item-selected .shortcut-pill {
  background: #ffffff;
}

.category-badge {
  font-size: 0.7rem;
  padding: 1px 6px;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 9999px;
  color: #475569;
}
</style>
