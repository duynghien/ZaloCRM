<template>
  <div style="max-width: 700px;">
    <div class="mb-4">
      <h1 class="neo-page-title text-h4 mb-0">KẾT NỐI <span class="neo-title-accent">API & WEBHOOK</span></h1>
      <p class="text-caption text-medium-emphasis mb-0">Tích hợp dữ liệu bên thứ ba và cấu hình webhook bảo mật</p>
    </div>

    <!-- API Key section -->
    <v-card class="mb-4" elevation="0">
      <v-card-title class="text-body-1 font-weight-bold" style="font-family: 'Space Grotesk', sans-serif;">API Key</v-card-title>
      <v-card-text>
        <v-alert
          v-if="justGenerated"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          Khóa API mới đã được tạo. Hãy sao chép và lưu trữ an toàn ngay bây giờ. Vì lý do bảo mật, khóa sẽ được ẩn sau khi tải lại trang.
        </v-alert>
        <v-text-field
          v-model="apiKey"
          label="API Key"
          readonly
          variant="outlined"
          rounded="lg"
          :type="showApiKey ? 'text' : 'password'"
          :prepend-inner-icon="showApiKey ? 'mdi-eye-off' : 'mdi-eye'"
          append-inner-icon="mdi-content-copy"
          @click:prepend-inner="showApiKey = !showApiKey"
          @click:append-inner="copyKey"
        />
        <v-btn
          color="primary"
          variant="outlined"
          rounded="lg"
          elevation="0"
          prepend-icon="mdi-refresh"
          :loading="generatingKey"
          @click="generateKey"
        >
          Tạo key mới
        </v-btn>
      </v-card-text>
    </v-card>

    <!-- Webhook section -->
    <v-card class="mb-4" elevation="0">
      <v-card-title class="text-body-1 font-weight-bold" style="font-family: 'Space Grotesk', sans-serif;">Webhook</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="webhookUrl"
          label="Webhook URL"
          placeholder="https://your-server.com/webhook"
          variant="outlined"
          rounded="lg"
          class="mb-2"
        />
        <v-text-field
          v-model="webhookSecret"
          label="Secret (HMAC)"
          type="password"
          variant="outlined"
          rounded="lg"
          class="mb-3"
        />
        <div class="d-flex gap-2">
          <v-btn color="primary" rounded="lg" elevation="0" :loading="saving" @click="saveWebhook">Lưu</v-btn>
          <v-btn variant="outlined" rounded="lg" elevation="0" :loading="testing" @click="testWebhook">Test Webhook</v-btn>
        </div>
      </v-card-text>
    </v-card>

    <!-- API Docs -->
    <v-card elevation="0">
      <v-card-title class="text-body-1 font-weight-bold" style="font-family: 'Space Grotesk', sans-serif;">API Documentation</v-card-title>
      <v-card-text>
        <pre style="font-family: monospace; font-size: 12px; overflow-x: auto; white-space: pre-wrap; background: var(--surface-variant); padding: 12px; border: 1.5px solid var(--border-color); border-radius: 8px;">Header: X-API-Key: your-key

GET  /api/public/contacts
POST /api/public/contacts
GET  /api/public/conversations
POST /api/public/messages/send
GET  /api/public/appointments
POST /api/public/appointments

Webhook events:
- message.received
- message.sent
- contact.created
- zalo.connected
- zalo.disconnected</pre>
      </v-card-text>
    </v-card>

    <v-snackbar v-model="snack.show" :color="snack.color" :timeout="3000">
      {{ snack.text }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api';

const apiKey = ref('');
const showApiKey = ref(false);
const generatingKey = ref(false);
const justGenerated = ref(false);
const webhookUrl = ref('');
const webhookSecret = ref('');
const saving = ref(false);
const testing = ref(false);

const snack = ref({ show: false, text: '', color: 'success' });

function showSnack(text: string, color = 'success') {
  snack.value = { show: true, text, color };
}

async function loadApiKey() {
  justGenerated.value = false;
  try {
    const res = await api.get('/settings/api-key');
    apiKey.value = res.data.apiKey ?? res.data.key ?? '';
  } catch {
    apiKey.value = '';
  }
}

async function loadWebhook() {
  try {
    const res = await api.get('/settings/webhook');
    webhookUrl.value = res.data.webhookUrl ?? res.data.url ?? '';
    webhookSecret.value = res.data.webhookSecret ?? res.data.secret ?? '';
  } catch {
    webhookUrl.value = '';
    webhookSecret.value = '';
  }
}

async function generateKey() {
  generatingKey.value = true;
  try {
    const res = await api.post('/settings/api-key/generate');
    apiKey.value = res.data.apiKey ?? res.data.key ?? '';
    justGenerated.value = true;
    showSnack('API key mới đã được tạo');
  } catch {
    showSnack('Tạo key thất bại', 'error');
  } finally {
    generatingKey.value = false;
  }
}

async function copyKey() {
  if (!apiKey.value) return;
  await navigator.clipboard.writeText(apiKey.value);
  showSnack('Đã sao chép API key');
}

async function saveWebhook() {
  saving.value = true;
  try {
    await api.put('/settings/webhook', {
      webhookUrl: webhookUrl.value,
      webhookSecret: webhookSecret.value,
    });
    showSnack('Đã lưu cấu hình webhook');
  } catch {
    showSnack('Lưu thất bại', 'error');
  } finally {
    saving.value = false;
  }
}

async function testWebhook() {
  testing.value = true;
  try {
    await api.post('/settings/webhook/test');
    showSnack('Gửi test webhook thành công');
  } catch {
    showSnack('Test webhook thất bại', 'error');
  } finally {
    testing.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadApiKey(), loadWebhook()]);
});
</script>
