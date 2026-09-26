<template>
  <v-dialog v-model="visible" max-width="600" persistent>
    <v-card elevation="0" class="neo-card pa-4">
      <v-card-title class="text-h6 font-weight-bold" style="font-family: 'Space Grotesk', sans-serif;">
        THÊM ĐIỂM NHẬN TIN WEBHOOK
      </v-card-title>
      <v-card-text class="pt-2">
        <v-text-field
          v-model="form.name"
          label="Tên điểm nhận tin"
          placeholder="Ví dụ: Backend n8n, KiotViet Webhook, Hệ thống Kế toán"
          variant="outlined"
          rounded="lg"
          class="mb-3"
          :error-messages="errors.name"
        />

        <v-text-field
          v-model="form.targetUrl"
          label="URL nhận tin (Bắt buộc HTTPS công khai)"
          placeholder="https://api.yourdomain.com/webhooks/zalo"
          variant="outlined"
          rounded="lg"
          class="mb-3"
          :error-messages="errors.targetUrl"
        />

        <div class="mb-3">
          <div class="d-flex justify-space-between align-center mb-1">
            <label class="text-caption font-weight-bold">HMAC SIGNING SECRET</label>
            <span class="text-caption text-primary cursor-pointer" @click="generateRandomSecret">Tự sinh secret ngẫu nhiên</span>
          </div>
          <v-text-field
            v-model="form.secret"
            placeholder="Để trống hệ thống sẽ tự sinh ngẫu nhiên 32 ký tự"
            variant="outlined"
            rounded="lg"
            density="comfortable"
            class="font-mono"
          />
        </div>

        <div class="mb-3">
          <label class="text-caption font-weight-bold d-block mb-1">ĐĂNG KÝ SỰ KIỆN</label>
          <div class="pa-3 rounded-lg" style="border: 1px solid var(--border-color); background: var(--surface-variant);">
            <v-checkbox
              v-model="allEventsSelected"
              label="Tất cả sự kiện (*)"
              density="compact"
              color="primary"
              class="font-weight-bold mb-1"
              hide-details
              @update:model-value="toggleAllEvents"
            />
            <v-divider class="my-2" />
            <div v-for="cat in eventCategories" :key="cat.name" class="mb-2">
              <div class="text-caption font-weight-bold text-medium-emphasis">{{ cat.name }}</div>
              <div class="d-flex flex-wrap gap-2">
                <v-checkbox
                  v-for="ev in cat.events"
                  :key="ev.value"
                  v-model="form.events"
                  :label="ev.label"
                  :value="ev.value"
                  :disabled="allEventsSelected"
                  density="compact"
                  hide-details
                  class="mr-3"
                />
              </div>
            </div>
          </div>
        </div>

        <v-checkbox
          v-model="form.sendV1Signature"
          label="Gửi kèm header chữ ký V1 legacy (X-Webhook-Signature)"
          density="compact"
          color="primary"
          hide-details
        />
      </v-card-text>
      <v-card-actions class="justify-end pt-2">
        <v-btn variant="text" rounded="lg" @click="visible = false">Hủy</v-btn>
        <v-btn color="primary" rounded="lg" elevation="0" :loading="loading" @click="submit">
          Lưu Cấu Hình
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { api } from '@/api';

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
  targetUrl: '',
  secret: '',
  events: ['*'],
  sendV1Signature: true,
});

const allEventsSelected = ref(true);
const errors = ref({ name: '', targetUrl: '' });
const loading = ref(false);

const eventCategories = [
  {
    name: 'Khách hàng',
    events: [
      { label: 'contact.created', value: 'contact.created' },
      { label: 'contact.updated', value: 'contact.updated' },
      { label: 'contact.deleted', value: 'contact.deleted' },
    ],
  },
  {
    name: 'Đơn hàng',
    events: [
      { label: 'order.created', value: 'order.created' },
      { label: 'order.updated', value: 'order.updated' },
      { label: 'order.deleted', value: 'order.deleted' },
    ],
  },
  {
    name: 'Tin nhắn & Lịch hẹn',
    events: [
      { label: 'message.received', value: 'message.received' },
      { label: 'message.sent', value: 'message.sent' },
      { label: 'appointment.created', value: 'appointment.created' },
      { label: 'appointment.updated', value: 'appointment.updated' },
      { label: 'appointment.cancelled', value: 'appointment.cancelled' },
    ],
  },
];

function toggleAllEvents(selected: boolean | null) {
  if (selected) {
    form.value.events = ['*'];
  } else {
    form.value.events = ['order.created', 'contact.created'];
  }
}

function generateRandomSecret() {
  const chars = '0123456789abcdef';
  let str = '';
  for (let i = 0; i < 32; i++) str += chars[Math.floor(Math.random() * chars.length)];
  form.value.secret = str;
}

async function submit() {
  errors.value = { name: '', targetUrl: '' };
  if (!form.value.name.trim()) errors.value.name = 'Vui lòng nhập tên điểm nhận tin';
  if (!form.value.targetUrl.trim()) errors.value.targetUrl = 'Vui lòng nhập URL nhận tin';
  else if (!form.value.targetUrl.startsWith('https://')) errors.value.targetUrl = 'URL phải sử dụng giao thức HTTPS bảo mật';

  if (errors.value.name || errors.value.targetUrl) return;

  loading.value = true;
  try {
    await api.post('/settings/webhooks', {
      name: form.value.name.trim(),
      targetUrl: form.value.targetUrl.trim(),
      secret: form.value.secret.trim() || undefined,
      events: allEventsSelected.value ? ['*'] : form.value.events,
      sendV1Signature: form.value.sendV1Signature,
    });
    emit('snack', 'Đã lưu điểm nhận tin Webhook');
    visible.value = false;
    emit('created');
  } catch (err: any) {
    emit('snack', err.response?.data?.error || 'Lưu Webhook thất bại', 'error');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.neo-card {
  border: 1.5px solid var(--border-color);
  border-radius: 8px;
}
.font-mono { font-family: monospace; }
</style>
