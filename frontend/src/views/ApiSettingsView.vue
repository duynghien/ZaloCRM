<template>
  <div style="max-width: 700px;">
    <h1 class="text-h5 mb-4 font-weight-black" style="font-family: 'Space Grotesk', sans-serif;">
      <v-icon class="mr-2" color="primary">mdi-api</v-icon>
      API & Webhook
    </h1>

    <!-- API Key section -->
    <v-card class="mb-4" rounded="sm" elevation="0">
      <v-card-title class="text-body-1 font-weight-bold" style="font-family: 'Space Grotesk', sans-serif;">API Key</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="apiKey"
          label="API Key"
          readonly
          variant="outlined"
          :type="showApiKey ? 'text' : 'password'"
          :prepend-inner-icon="showApiKey ? 'mdi-eye-off' : 'mdi-eye'"
          append-inner-icon="mdi-content-copy"
          @click:prepend-inner="showApiKey = !showApiKey"
          @click:append-inner="copyKey"
        />
        <v-btn
          color="primary"
          variant="outlined"
          rounded="sm"
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
    <v-card class="mb-4" rounded="sm" elevation="0">
      <v-card-title class="text-body-1 font-weight-bold" style="font-family: 'Space Grotesk', sans-serif;">Webhook</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="webhookUrl"
          label="Webhook URL"
          placeholder="https://your-server.com/webhook"
          variant="outlined"
          class="mb-2"
        />
        <v-text-field
          v-model="webhookSecret"
          label="Secret (HMAC)"
          type="password"
          variant="outlined"
          class="mb-3"
        />
        <div class="d-flex gap-2">
          <v-btn color="primary" rounded="sm" elevation="0" :loading="saving" @click="saveWebhook">Lưu</v-btn>
          <v-btn variant="outlined" rounded="sm" elevation="0" :loading="testing" @click="testWebhook">Test Webhook</v-btn>
        </div>
      </v-card-text>
    </v-card>

    <!-- API Docs -->
    <v-card rounded="sm" elevation="0">
      <v-card-title class="text-body-1 font-weight-bold" style="font-family: 'Space Grotesk', sans-serif;">API Documentation</v-card-title>
      <v-card-text>
        <pre style="font-family: monospace; font-size: 12px; overflow-x: auto; white-space: pre-wrap; background: var(--surface-variant); padding: 12px; border: 1.5px solid var(--border-color); border-radius: 4px;">Header: X-API-Key: your-key

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
const webhookUrl = ref('');
const webhookSecret = ref('');
const saving = ref(false);
const testing = ref(false);

const snack = ref({ show: false, text: '', color: 'success' });

function showSnack(text: string, color = 'success') {
  snack.value = { show: true, text, color };
}

async function loadApiKey() {
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
