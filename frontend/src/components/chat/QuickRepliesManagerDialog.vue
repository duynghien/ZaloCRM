<template>
  <v-dialog :model-value="modelValue" max-width="680" persistent @update:model-value="$emit('update:modelValue', $event)">
    <v-card class="quick-replies-manager-card">
      <!-- Header -->
      <v-card-title class="manager-header d-flex align-center justify-space-between px-4 py-3">
        <div class="d-flex align-center gap-2">
          <v-icon color="primary">mdi-lightning-bolt</v-icon>
          <span class="font-weight-bold text-h6">Quản Lý Tin Nhắn Mẫu</span>
        </div>
        <v-btn icon="mdi-close" variant="text" density="compact" @click="closeDialog" />
      </v-card-title>

      <!-- Alert / Error message -->
      <v-alert v-if="localError" type="error" density="compact" closable class="ma-3" @click:close="localError = null">
        {{ localError }}
      </v-alert>

      <!-- Mode 1: Editor Form (Create or Edit) -->
      <div v-if="isEditing" class="editor-section pa-4">
        <div class="text-subtitle-1 font-weight-bold mb-3">
          {{ editingId ? 'Chỉnh Sửa Tin Nhắn Mẫu' : 'Thêm Mẫu Tin Nhắn Mới' }}
        </div>
        <v-row dense>
          <v-col cols="12" sm="5">
            <v-text-field
              v-model="form.shortcut"
              label="Phím tắt (VD: stk, diachi)*"
              prefix="/"
              density="compact"
              variant="outlined"
              hide-details="auto"
              :rules="[(v) => !!v || 'Bắt buộc']"
            />
          </v-col>
          <v-col cols="12" sm="4">
            <v-select
              v-model="form.category"
              :items="categoryOptions"
              label="Danh mục"
              density="compact"
              variant="outlined"
              hide-details
            />
          </v-col>
          <v-col cols="12" sm="12">
            <v-text-field
              v-model="form.title"
              label="Tiêu đề gợi nhớ*"
              density="compact"
              variant="outlined"
              counter="100"
              hide-details="auto"
              :rules="[(v) => !!v || 'Bắt buộc']"
            />
          </v-col>
          <v-col cols="12">
            <v-textarea
              v-model="form.content"
              label="Nội dung tin nhắn đầy đủ*"
              density="compact"
              variant="outlined"
              rows="4"
              counter="2000"
              hide-details="auto"
              :rules="[(v) => !!v || 'Bắt buộc', (v) => v.length <= 2000 || 'Tối đa 2.000 ký tự']"
            />
          </v-col>
        </v-row>
        <div class="d-flex justify-end gap-2 mt-4">
          <v-btn variant="outlined" density="comfortable" @click="cancelEdit">Hủy</v-btn>
          <v-btn color="primary" density="comfortable" :loading="saving" @click="saveQuickReply">Lưu mẫu</v-btn>
        </div>
      </div>

      <!-- Mode 2: Table / List of Quick Replies -->
      <div v-else class="list-section">
        <div class="d-flex align-center justify-space-between px-4 py-2 border-b">
          <v-text-field
            v-model="searchQuery"
            placeholder="Tìm theo phím tắt, tiêu đề..."
            density="compact"
            variant="outlined"
            prepend-inner-icon="mdi-magnify"
            hide-details
            class="search-input"
          />
          <v-btn color="primary" class="ml-2 font-weight-bold" density="comfortable" @click="startCreate">
            <v-icon start>mdi-plus</v-icon> Thêm mới
          </v-btn>
        </div>

        <div class="items-container px-4 py-2">
          <div v-if="filteredItems.length === 0" class="text-center py-8 text-medium-emphasis">
            Chưa có tin nhắn mẫu nào phù hợp.
          </div>
          <div
            v-for="item in filteredItems"
            :key="item.id"
            class="item-row d-flex align-center justify-space-between py-2 border-b"
          >
            <div class="item-info mr-2 text-truncate">
              <div class="d-flex align-center gap-2 mb-1">
                <span class="pill-shortcut">/{{ item.shortcut }}</span>
                <span class="font-weight-bold text-body-2">{{ item.title }}</span>
                <v-chip size="x-small" label variant="outlined">{{ item.category }}</v-chip>
              </div>
              <div class="text-caption text-truncate text-medium-emphasis">{{ item.content }}</div>
            </div>
            <div class="item-actions d-flex align-center gap-1">
              <v-btn icon="mdi-pencil-outline" size="small" variant="text" @click="startEdit(item)" />
              <v-btn icon="mdi-delete-outline" size="small" color="error" variant="text" @click="deleteItem(item.id)" />
            </div>
          </div>
        </div>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch } from 'vue';
import { useQuickReplies } from '@/composables/use-quick-replies';
import type { QuickReply, QuickReplyCategory } from '@/api/quick-reply-api';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const { quickReplies, loadQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply } = useQuickReplies();

const searchQuery = ref('');
const isEditing = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);
const localError = ref<string | null>(null);

const categoryOptions = [
  { title: 'Chung (general)', value: 'general' },
  { title: 'Thanh toán (payment)', value: 'payment' },
  { title: 'Địa chỉ (address)', value: 'address' },
  { title: 'Báo giá (pricing)', value: 'pricing' },
  { title: 'Chính sách (policy)', value: 'policy' },
];

const form = reactive({
  shortcut: '',
  title: '',
  content: '',
  category: 'general' as QuickReplyCategory,
});

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      loadQuickReplies(true);
      isEditing.value = false;
      localError.value = null;
    }
  }
);

const filteredItems = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  if (!q) return quickReplies.value;
  return quickReplies.value.filter(
    (item) => item.shortcut.toLowerCase().includes(q) || item.title.toLowerCase().includes(q)
  );
});

function closeDialog() {
  emit('update:modelValue', false);
}

function startCreate() {
  editingId.value = null;
  form.shortcut = '';
  form.title = '';
  form.content = '';
  form.category = 'general';
  isEditing.value = true;
  localError.value = null;
}

function startEdit(item: QuickReply) {
  editingId.value = item.id;
  form.shortcut = item.shortcut;
  form.title = item.title;
  form.content = item.content;
  form.category = item.category;
  isEditing.value = true;
  localError.value = null;
}

function cancelEdit() {
  isEditing.value = false;
  localError.value = null;
}

async function saveQuickReply() {
  if (!form.shortcut.trim() || !form.title.trim() || !form.content.trim()) {
    localError.value = 'Vui lòng nhập đầy đủ phím tắt, tiêu đề và nội dung';
    return;
  }
  saving.value = true;
  localError.value = null;
  try {
    if (editingId.value) {
      await updateQuickReply(editingId.value, { ...form });
    } else {
      await createQuickReply({ ...form });
    }
    isEditing.value = false;
  } catch (err: any) {
    localError.value = err?.response?.data?.error || err?.message || 'Có lỗi xảy ra khi lưu mẫu';
  } finally {
    saving.value = false;
  }
}

async function deleteItem(id: string) {
  if (!confirm('Bạn có chắc chắn muốn xóa tin nhắn mẫu này?')) return;
  try {
    await deleteQuickReply(id);
  } catch (err: any) {
    localError.value = err?.response?.data?.error || err?.message || 'Lỗi khi xóa mẫu';
  }
}
</script>

<style scoped>
.quick-replies-manager-card {
  border: 1.5px solid #000000 !important;
  box-shadow: 4px 4px 0px #000000 !important;
}
.manager-header {
  border-bottom: 1.5px solid #000000;
  background: #f8fafc;
}
.pill-shortcut {
  font-family: 'Space Grotesk', monospace;
  font-weight: 700;
  font-size: 0.75rem;
  padding: 1px 6px;
  background: #fef08a;
  border: 1px solid #000000;
  border-radius: 4px;
}
.items-container {
  max-height: 380px;
  overflow-y: auto;
}
.search-input {
  max-width: 320px;
}
</style>
