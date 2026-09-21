<template>
  <v-card class="pa-4" style="border: 1.5px solid var(--border-color); border-radius: 12px;" elevation="0">
    <div class="d-flex align-center justify-space-between mb-3">
      <div>
        <h2 class="neo-subtitle font-weight-bold mb-1" style="font-size: 1.1rem;">
          ĐỒNG BỘ <span class="neo-title-accent">DANH MỤC SẢN PHẨM</span>
        </h2>
        <p class="text-caption text-grey mb-0">
          Tải và cập nhật sản phẩm từ KiotViet về cơ sở dữ liệu CRM cục bộ để tìm kiếm và tạo đơn nhanh chóng.
        </p>
      </div>
      <v-chip
        size="small"
        :color="status?.catalogReady ? 'success' : 'warning'"
        variant="flat"
        rounded="pill"
        class="neo-pill"
      >
        {{ status?.catalogReady ? 'Danh mục sẵn sàng' : 'Chưa đồng bộ' }}
      </v-chip>
    </div>

    <!-- Sync In Progress Alert / Progress bar -->
    <div v-if="status?.syncInProgress" class="mb-3">
      <div class="d-flex align-center justify-space-between mb-1">
        <span class="text-caption font-weight-bold text-primary">
          Đang đồng bộ sản phẩm từ KiotViet...
        </span>
        <v-progress-circular indeterminate size="16" width="2" color="primary" />
      </div>
      <v-progress-linear indeterminate color="primary" rounded="lg" />
    </div>

    <!-- Feedback Alerts -->
    <v-alert
      v-if="status?.lastError"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-3 text-caption"
    >
      Lỗi lần đồng bộ trước: {{ status.lastError }}
    </v-alert>

    <v-alert
      v-if="actionMessage"
      type="info"
      variant="tonal"
      density="compact"
      closable
      class="mb-3 text-caption"
      @click:close="actionMessage = null"
    >
      {{ actionMessage }}
    </v-alert>

    <!-- Catalog Stats Row -->
    <v-row dense class="mb-3">
      <v-col cols="6" sm="3">
        <div class="pa-3 stat-box">
          <div class="text-caption text-grey">Tổng sản phẩm</div>
          <div class="font-weight-black text-h6 font-mono">{{ status?.totalProducts ?? 0 }}</div>
        </div>
      </v-col>
      <v-col cols="6" sm="3">
        <div class="pa-3 stat-box">
          <div class="text-caption text-grey">Đang bán (Active)</div>
          <div class="font-weight-black text-h6 font-mono text-success">{{ status?.activeProducts ?? 0 }}</div>
        </div>
      </v-col>
      <v-col cols="6" sm="3">
        <div class="pa-3 stat-box">
          <div class="text-caption text-grey">Lần đồng bộ gần nhất</div>
          <div class="text-caption font-weight-bold">{{ formatDate(status?.lastSyncAt) }}</div>
        </div>
      </v-col>
      <v-col cols="6" sm="3">
        <div class="pa-3 stat-box">
          <div class="text-caption text-grey">Đồng bộ thành công</div>
          <div class="text-caption font-weight-bold text-primary">{{ formatDate(status?.lastSuccessfulAt) }}</div>
        </div>
      </v-col>
    </v-row>

    <!-- Sync Actions -->
    <div class="d-flex flex-wrap align-center justify-end" style="gap: 8px;">
      <v-btn
        variant="outlined"
        rounded="lg"
        class="font-weight-bold"
        :loading="triggering"
        :disabled="status?.syncInProgress"
        @click="triggerSync(false)"
      >
        Đồng bộ cập nhật (Incremental)
      </v-btn>
      <v-btn
        color="primary"
        rounded="lg"
        class="font-weight-bold"
        style="border: 1.5px solid var(--border-color);"
        :loading="triggering"
        :disabled="status?.syncInProgress"
        @click="triggerSync(true)"
      >
        Đồng bộ toàn bộ (Full Sync)
      </v-btn>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useKiotviet, type KiotvietCatalogStatusDto } from '@/composables/use-kiotviet';

const { getCatalogStatus, triggerCatalogSync } = useKiotviet();

const status = ref<KiotvietCatalogStatusDto | null>(null);
const triggering = ref(false);
const actionMessage = ref<string | null>(null);
let pollTimer: any = null;

function formatDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('vi-VN');
}

async function loadStatus() {
  try {
    const s = await getCatalogStatus();
    status.value = s;
    if (s.syncInProgress) {
      startPolling();
    } else {
      stopPolling();
    }
  } catch (err) {
    console.error('Failed to load catalog status:', err);
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      const s = await getCatalogStatus();
      status.value = s;
      if (!s.syncInProgress) {
        stopPolling();
      }
    } catch {
      stopPolling();
    }
  }, 2000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function triggerSync(full: boolean) {
  triggering.value = true;
  actionMessage.value = null;

  try {
    const res = await triggerCatalogSync(full);
    actionMessage.value = res.message || 'Đã xếp hàng công việc đồng bộ danh mục KiotViet.';
    await loadStatus();
  } catch (err: any) {
    actionMessage.value = err?.response?.data?.message || err?.message || 'Có lỗi xảy ra khi bắt đầu đồng bộ';
  } finally {
    triggering.value = false;
  }
}

onMounted(() => {
  loadStatus();
});

onUnmounted(() => {
  stopPolling();
});
</script>

<style scoped>
.stat-box {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--surface-variant);
}

.font-mono {
  font-family: monospace;
}
</style>
