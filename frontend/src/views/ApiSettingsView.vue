<template>
  <div class="api-settings-view">
    <div class="mb-4">
      <h1 class="neo-page-title text-h4 mb-0">CỔNG TÍCH HỢP <span class="neo-title-accent">API & WEBHOOK</span></h1>
      <p class="text-caption text-medium-emphasis mb-0">Hệ thống Multi-Key API Gateway, Webhook Đa Đích & Quản Trị DLQ theo chuẩn Enterprise</p>
    </div>

    <!-- 4 Navigation Tabs -->
    <v-tabs v-model="tab" color="primary" class="mb-4" density="comfortable">
      <v-tab value="keys" prepend-icon="mdi-key-variant">Khóa API (API Keys)</v-tab>
      <v-tab value="webhooks" prepend-icon="mdi-webhook">Webhooks (Điểm Nhận Tin)</v-tab>
      <v-tab value="logs" prepend-icon="mdi-history">Nhật Ký & DLQ (Delivery Monitor)</v-tab>
      <v-tab value="docs" prepend-icon="mdi-book-open-page-variant">Tài Liệu Tích Hợp (Docs)</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <!-- Tab 1: API Keys -->
      <v-window-item value="keys">
        <ApiKeyTable
          :keys="keys"
          :loading="loadingKeys"
          @create="showCreateKey = true"
          @refresh="loadKeys"
          @snack="showSnack"
        />
      </v-window-item>

      <!-- Tab 2: Webhooks -->
      <v-window-item value="webhooks">
        <WebhookSubscriptionList
          :subscriptions="subscriptions"
          :loading="loadingSubs"
          @create="showCreateWebhook = true"
          @refresh="loadSubs"
          @snack="showSnack"
        />
      </v-window-item>

      <!-- Tab 3: Delivery Logs & DLQ -->
      <v-window-item value="logs">
        <WebhookLogViewer @snack="showSnack" />
      </v-window-item>

      <!-- Tab 4: Interactive Docs -->
      <v-window-item value="docs">
        <InteractiveApiDocs />
      </v-window-item>
    </v-window>

    <!-- Dialogs -->
    <ApiKeyCreateDialog
      v-model="showCreateKey"
      @created="loadKeys"
      @snack="showSnack"
    />

    <WebhookSubscriptionDialog
      v-model="showCreateWebhook"
      @created="loadSubs"
      @snack="showSnack"
    />

    <v-snackbar v-model="snack.show" :color="snack.color" :timeout="3500">
      {{ snack.text }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api';
import ApiKeyTable from '@/components/api-settings/ApiKeyTable.vue';
import ApiKeyCreateDialog from '@/components/api-settings/ApiKeyCreateDialog.vue';
import WebhookSubscriptionList from '@/components/api-settings/WebhookSubscriptionList.vue';
import WebhookSubscriptionDialog from '@/components/api-settings/WebhookSubscriptionDialog.vue';
import WebhookLogViewer from '@/components/api-settings/WebhookLogViewer.vue';
import InteractiveApiDocs from '@/components/api-settings/InteractiveApiDocs.vue';

const tab = ref('keys');
const keys = ref<any[]>([]);
const subscriptions = ref<any[]>([]);
const loadingKeys = ref(false);
const loadingSubs = ref(false);

const showCreateKey = ref(false);
const showCreateWebhook = ref(false);
const snack = ref({ show: false, text: '', color: 'success' });

function showSnack(text: string, color = 'success') {
  snack.value = { show: true, text, color };
}

async function loadKeys() {
  loadingKeys.value = true;
  try {
    const res = await api.get('/settings/api-keys');
    keys.value = res.data.keys || [];
  } catch {
    showSnack('Tải danh sách API key thất bại', 'error');
  } finally {
    loadingKeys.value = false;
  }
}

async function loadSubs() {
  loadingSubs.value = true;
  try {
    const res = await api.get('/settings/webhooks');
    subscriptions.value = res.data.subscriptions || [];
  } catch {
    showSnack('Tải danh sách webhook thất bại', 'error');
  } finally {
    loadingSubs.value = false;
  }
}

onMounted(() => {
  loadKeys();
  loadSubs();
});
</script>
