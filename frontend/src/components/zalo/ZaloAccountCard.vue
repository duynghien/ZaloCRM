<template>
  <v-card class="channel-card fill-height d-flex flex-column justify-space-between" elevation="0">
    <div>
      <!-- Top header: Channel Logo + Display Name + Channel Type Pill -->
      <div class="d-flex align-start justify-space-between mb-3">
        <div class="d-flex align-center">
          <div
            class="channel-logo neo-icon-box mr-3 flex-shrink-0"
            style="width: 44px; height: 44px; background: #0068FF; color: #FFFFFF;"
          >
            <v-icon size="24" color="#FFFFFF">mdi-message-processing</v-icon>
          </div>
          <div>
            <div class="text-subtitle-1 font-weight-bold" style="line-height: 1.2; font-family: 'Space Grotesk', sans-serif;">
              {{ account.displayName || 'Zalo Cá Nhân' }}
            </div>
            <div class="text-caption text-muted font-mono" style="font-size: 0.75rem;">
              {{ account.phone || account.zaloUid || 'UID: ' + account.id.slice(0, 8) }}
            </div>
          </div>
        </div>

        <span class="neo-pill channel-type-pill px-2 py-0">
          ZALO CÁ NHÂN
        </span>
      </div>

      <v-divider class="my-3" style="opacity: 0.15;" />

      <!-- Status row -->
      <div class="d-flex align-center justify-space-between mb-3">
        <div class="d-flex align-center">
          <span class="text-caption text-muted font-weight-bold mr-2 neo-subtitle" style="font-size: 0.68rem;">TRẠNG THÁI:</span>
          <span
            v-if="isConnected"
            class="neo-pill status-pill-connected px-2 py-0"
          >
            ● HOẠT ĐỘNG
          </span>
          <span
            v-else
            class="neo-pill status-pill-disconnected px-2 py-0"
          >
            ● NGẮT KẾT NỐI
          </span>
        </div>

        <div v-if="account.createdAt" class="text-caption text-muted" style="font-size: 0.72rem;">
          {{ formatDate(account.createdAt) }}
        </div>
      </div>
    </div>

    <!-- Actions Footer -->
    <div class="d-flex align-center flex-wrap pt-2" style="gap: 6px; border-top: 1px solid var(--border-color);">
      <!-- Primary Sync Button -->
      <v-btn
        color="primary"
        size="small"
        rounded="lg"
        class="font-weight-bold text-white px-3"
        style="border: 1.5px solid var(--border-color); font-family: 'Space Grotesk', sans-serif;"
        :loading="syncing"
        title="Đồng bộ danh bạ Zalo"
        @click="$emit('sync', account.id)"
      >
        <v-icon start size="16">mdi-sync</v-icon>
        ĐỒNG BỘ NGAY
      </v-btn>

      <!-- QR Login Button when disconnected -->
      <v-btn
        v-if="!isConnected"
        color="primary"
        variant="outlined"
        size="small"
        rounded="lg"
        class="font-weight-bold px-3"
        style="border: 1.5px solid var(--border-color); font-family: 'Space Grotesk', sans-serif;"
        title="Đăng nhập QR"
        @click="$emit('login', account.id)"
      >
        <v-icon start size="16">mdi-qrcode</v-icon>
        ĐĂNG NHẬP QR
      </v-btn>

      <!-- Reconnect button if disconnected with session -->
      <v-btn
        v-if="!isConnected && account.sessionData"
        variant="outlined"
        size="small"
        icon
        rounded="lg"
        class="channel-action-btn"
        title="Kết nối lại"
        @click="$emit('reconnect', account.id)"
      >
        <v-icon size="16">mdi-refresh</v-icon>
      </v-btn>

      <v-spacer />

      <!-- ACL Access Control Button (Admin only) -->
      <v-btn
        v-if="isAdmin"
        variant="outlined"
        size="small"
        icon
        rounded="lg"
        class="channel-action-btn"
        title="Phân quyền truy cập"
        @click="$emit('access', account)"
      >
        <v-icon size="16">mdi-shield-account</v-icon>
      </v-btn>

      <!-- Delete Button (Admin only) -->
      <v-btn
        v-if="isAdmin"
        color="error"
        variant="outlined"
        size="small"
        icon
        rounded="lg"
        class="channel-action-btn"
        title="Xóa"
        @click="$emit('delete', account)"
      >
        <v-icon size="16">mdi-delete</v-icon>
      </v-btn>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ZaloAccount } from '@/composables/use-zalo-accounts';

const props = defineProps<{
  account: ZaloAccount;
  syncing?: boolean;
  isAdmin?: boolean;
}>();

defineEmits<{
  (e: 'sync', accountId: string): void;
  (e: 'login', accountId: string): void;
  (e: 'reconnect', accountId: string): void;
  (e: 'access', account: ZaloAccount): void;
  (e: 'delete', account: ZaloAccount): void;
}>();

const isConnected = computed(() => {
  return props.account.liveStatus === 'connected' || props.account.status === 'active';
});

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    });
  } catch {
    return dateStr;
  }
}
</script>

<style scoped>
.channel-card {
  background: var(--surface-card);
  border: 1.5px solid var(--border-color);
  border-radius: 12px;
  padding: 16px;
}

.channel-logo {
  border: 1.5px solid var(--border-color);
  border-radius: 8px;
}

.channel-type-pill {
  background: var(--secondary-brand);
  color: var(--primary-brand);
  border: 1px solid var(--border-color) !important;
  font-size: 0.65rem !important;
}

.status-pill-connected {
  background: var(--pastel-green-bg);
  color: var(--pastel-green-fg);
  border: 1.5px solid var(--border-color) !important;
  font-size: 0.7rem !important;
}

.status-pill-disconnected {
  background: var(--pastel-pink-bg);
  color: var(--pastel-pink-fg);
  border: 1.5px solid var(--border-color) !important;
  font-size: 0.7rem !important;
}

.channel-action-btn {
  width: 32px !important;
  height: 32px !important;
  border: 1.5px solid var(--border-color) !important;
}

.font-mono {
  font-family: monospace;
}
</style>
