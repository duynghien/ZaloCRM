<template>
  <!-- Fullscreen Mode: When app starts with unavailable server / 502 on protected route -->
  <div
    v-if="fullscreen"
    class="network-error-fullscreen d-flex align-center justify-center fill-height pa-4"
  >
    <v-card class="network-error-card pa-8 text-center" elevation="0" max-width="480">
      <div class="mb-4">
        <v-icon size="56" color="warning">mdi-cloud-alert</v-icon>
      </div>

      <h2 class="neo-title text-h6 font-weight-bold mb-2">
        KHÔNG THỂ KẾT NỐI MÁY CHỦ
      </h2>

      <p class="text-body-2 text-medium-emphasis mb-6">
        {{ authStore.errorMessage || 'Không thể kết nối đến máy chủ hoặc hệ thống đang nâng cấp (502). Vui lòng kiểm tra lại đường truyền và thử lại.' }}
      </p>

      <v-btn
        color="primary"
        size="large"
        rounded="lg"
        block
        class="font-weight-bold retry-btn"
        :loading="retrying"
        @click="handleRetry"
      >
        <v-icon start size="20">mdi-refresh</v-icon>
        Thử kết nối lại
      </v-btn>
    </v-card>
  </div>

  <!-- Fixed-Top Mode: When user is already in session and connection drops -->
  <div
    v-else-if="fixedTop"
    class="network-error-fixed-top px-4 py-2 d-flex align-center justify-space-between"
  >
    <div class="d-flex align-center" style="gap: 10px;">
      <v-icon size="20" color="warning">mdi-alert-outline</v-icon>
      <span class="text-body-2 font-weight-medium">
        {{ authStore.errorMessage || 'Mất kết nối với máy chủ. Vui lòng kiểm tra lại đường truyền.' }}
      </span>
    </div>

    <v-btn
      size="small"
      variant="flat"
      color="warning"
      rounded="lg"
      class="font-weight-bold retry-btn-sm"
      :loading="retrying"
      @click="handleRetry"
    >
      <v-icon start size="16">mdi-refresh</v-icon>
      Thử lại
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

defineProps<{
  fullscreen?: boolean;
  fixedTop?: boolean;
}>();

const router = useRouter();
const authStore = useAuthStore();
const retrying = ref(false);

async function handleRetry() {
  retrying.value = true;
  try {
    await authStore.retryBootstrap(router);
  } finally {
    retrying.value = false;
  }
}
</script>

<style scoped>
.network-error-fullscreen {
  min-height: 100vh;
  width: 100%;
  background-color: var(--bg-main, #f8fafc);
}

.network-error-card {
  border: 1.5px solid var(--border-color, #e2e8f0) !important;
  border-radius: 16px !important;
  background: rgb(var(--v-theme-surface)) !important;
  box-shadow: none !important;
}

.neo-title {
  font-family: 'Space Grotesk', sans-serif;
  letter-spacing: -0.01em;
}

.retry-btn {
  border: 1.5px solid var(--border-color, #0f172a) !important;
  font-family: 'Space Grotesk', sans-serif;
}

.network-error-fixed-top {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  background-color: #fffbeb;
  color: #92400e;
  border-bottom: 1.5px solid var(--border-color, #f59e0b);
}

.retry-btn-sm {
  border: 1.5px solid #d97706 !important;
  font-family: 'Space Grotesk', sans-serif;
}
</style>
