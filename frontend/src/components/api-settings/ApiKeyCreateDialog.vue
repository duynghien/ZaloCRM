<template>
  <div>
    <!-- Create Form Dialog -->
    <v-dialog v-model="visible" max-width="600" persistent>
      <v-card elevation="0" class="neo-card pa-4">
        <v-card-title class="text-h6 font-weight-bold" style="font-family: 'Space Grotesk', sans-serif;">
          TẠO KHÓA API MỚI
        </v-card-title>
        <v-card-text class="pt-2">
          <v-text-field
            v-model="form.name"
            label="Tên khóa (Mục đích sử dụng)"
            placeholder="Ví dụ: Tích hợp KiotViet, Landing Page, App Nội Bộ"
            variant="outlined"
            rounded="lg"
            class="mb-3"
            :error-messages="errors.name"
          />

          <div class="mb-3">
            <label class="text-caption font-weight-bold d-block mb-1">THỜI HẠN HIỆU LỰC</label>
            <v-select
              v-model="form.expirationDays"
              :items="expirationOptions"
              variant="outlined"
              rounded="lg"
              density="comfortable"
            />
          </div>

          <div class="mb-3">
            <label class="text-caption font-weight-bold d-block mb-1">GIỚI HẠN TỐC ĐỘ (REQUEST/PHÚT)</label>
            <v-text-field
              v-model.number="form.rateLimit"
              type="number"
              min="1"
              max="1000"
              variant="outlined"
              rounded="lg"
              density="comfortable"
            />
          </div>

          <div class="mb-3">
            <div class="d-flex justify-space-between align-center mb-1">
              <label class="text-caption font-weight-bold">PHÂN QUYỀN TRUY CẬP (LEAST PRIVILEGE)</label>
              <span class="text-caption text-primary cursor-pointer" @click="selectAllScopes">Chọn tất cả</span>
            </div>
            <div class="scope-groups pa-3 rounded-lg" style="border: 1px solid var(--border-color); background: var(--surface-variant);">
              <div v-for="group in scopeGroups" :key="group.title" class="mb-2">
                <div class="text-caption font-weight-bold text-medium-emphasis mb-1">{{ group.title }}</div>
                <div class="d-flex flex-wrap gap-2">
                  <v-checkbox
                    v-for="s in group.items"
                    :key="s.value"
                    v-model="form.scopes"
                    :label="s.label"
                    :value="s.value"
                    density="compact"
                    hide-details
                    class="mr-3"
                  />
                </div>
              </div>
            </div>
          </div>
        </v-card-text>
        <v-card-actions class="justify-end pt-2">
          <v-btn variant="text" rounded="lg" @click="visible = false">Hủy</v-btn>
          <v-btn color="primary" rounded="lg" elevation="0" :loading="loading" @click="submit">
            Tạo Khóa API
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Key Reveal Modal (Single Reveal) -->
    <v-dialog v-model="revealVisible" max-width="560" persistent>
      <v-card elevation="0" class="neo-card pa-4">
        <v-card-title class="text-h6 font-weight-bold text-warning" style="font-family: 'Space Grotesk', sans-serif;">
          <v-icon icon="mdi-shield-key" class="mr-2" /> KHÓA API ĐÃ TẠO THÀNH CÔNG
        </v-card-title>
        <v-card-text>
          <v-alert type="warning" variant="tonal" density="comfortable" class="mb-4">
            <strong>Lưu ý bảo mật:</strong> Khóa API này chỉ hiển thị <strong>duy nhất 1 lần</strong>. Hãy sao chép và lưu trữ an toàn ngay bây giờ!
          </v-alert>

          <v-text-field
            :model-value="generatedKey"
            readonly
            variant="outlined"
            rounded="lg"
            class="font-mono mb-2"
            append-inner-icon="mdi-content-copy"
            @click:append-inner="copyGeneratedKey"
          />
        </v-card-text>
        <v-card-actions class="justify-end">
          <v-btn color="primary" rounded="lg" elevation="0" @click="closeReveal">
            Tôi Đã Lưu Khóa An Toàn
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { api } from '@/api';
import { EXPIRATION_OPTIONS, SCOPE_GROUPS } from './api-key-form-constants';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'created'): void;
  (e: 'snack', text: string, color?: string): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});

const form = ref({
  name: '',
  expirationDays: 90,
  rateLimit: 60,
  scopes: ['contacts:read', 'orders:read'], // Least privilege defaults
});

const errors = ref({ name: '' });
const loading = ref(false);
const revealVisible = ref(false);
const generatedKey = ref('');

const expirationOptions = EXPIRATION_OPTIONS;
const scopeGroups = SCOPE_GROUPS;

function selectAllScopes() {
  const all: string[] = [];
  scopeGroups.forEach(g => g.items.forEach(i => all.push(i.value)));
  form.value.scopes = all;
}

async function submit() {
  errors.value.name = '';
  if (!form.value.name.trim()) {
    errors.value.name = 'Vui lòng nhập tên khóa API';
    return;
  }

  loading.value = true;
  try {
    let expiresAt: string | undefined;
    if (form.value.expirationDays > 0) {
      const d = new Date();
      d.setDate(d.getDate() + form.value.expirationDays);
      expiresAt = d.toISOString();
    }

    const res = await api.post('/settings/api-keys', {
      name: form.value.name.trim(),
      scopes: form.value.scopes,
      rateLimit: form.value.rateLimit,
      expiresAt,
    });

    generatedKey.value = res.data.apiKey || res.data.key || '';
    visible.value = false;
    revealVisible.value = true;
    emit('created');
  } catch (err: any) {
    emit('snack', err.response?.data?.error || 'Tạo khóa API thất bại', 'error');
  } finally {
    loading.value = false;
  }
}

async function copyGeneratedKey() {
  if (!generatedKey.value) return;
  await navigator.clipboard.writeText(generatedKey.value);
  emit('snack', 'Đã sao chép khóa API vào bộ nhớ tạm');
}

function closeReveal() {
  revealVisible.value = false;
  generatedKey.value = '';
}
</script>

<style scoped>
.neo-card { border: 1.5px solid var(--border-color); border-radius: 8px; }
.font-mono { font-family: monospace; }
</style>
