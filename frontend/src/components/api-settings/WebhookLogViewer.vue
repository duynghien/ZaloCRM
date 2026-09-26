<template>
  <div class="webhook-log-viewer">
    <div class="d-flex justify-space-between align-center mb-3">
      <div>
        <h3 class="text-subtitle-1 font-weight-bold" style="font-family: 'Space Grotesk', sans-serif;">
          NHẬT KÝ PHÂN PHỐI & DEAD-LETTER QUEUE
        </h3>
        <p class="text-caption text-medium-emphasis mb-0">Theo dõi tiến trình phát webhook thời gian thực và quản trị hàng đợi lỗi</p>
      </div>
      <v-btn variant="outlined" rounded="lg" size="small" prepend-icon="mdi-refresh" :loading="loading" @click="fetchLogs">
        Làm mới
      </v-btn>
    </div>

    <!-- Filter chips -->
    <div class="d-flex gap-2 mb-3">
      <v-chip
        v-for="st in statusOptions"
        :key="st.value"
        :color="activeStatus === st.value ? 'primary' : undefined"
        :variant="activeStatus === st.value ? 'flat' : 'outlined'"
        size="small"
        class="cursor-pointer"
        @click="filterStatus(st.value)"
      >
        {{ st.title }}
      </v-chip>
    </div>

    <v-card elevation="0" class="neo-card">
      <v-table density="comfortable" class="neo-table">
        <thead>
          <tr>
            <th>THỜI GIAN</th>
            <th>SỰ KIỆN</th>
            <th>ĐIỂM ĐÍCH</th>
            <th>MÃ PHẢN HỒI</th>
            <th>LẦN THỬ</th>
            <th>TRẠNG THÁI</th>
            <th class="text-right">THAO TÁC</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="7" class="text-center py-6 text-medium-emphasis">
              <v-progress-circular indeterminate size="24" class="mr-2" /> Đang tải nhật ký...
            </td>
          </tr>
          <tr v-else-if="logs.length === 0">
            <td colspan="7" class="text-center py-6 text-medium-emphasis">
              Không có bản ghi nhật ký nào phù hợp.
            </td>
          </tr>
          <tr v-for="item in logs" :key="item.id">
            <td class="text-caption font-mono">
              {{ new Date(item.createdAt).toLocaleTimeString('vi-VN') }}
            </td>
            <td>
              <v-chip size="x-small" variant="tonal" class="font-mono">{{ item.eventType }}</v-chip>
            </td>
            <td class="text-caption font-mono text-truncate" style="max-width: 220px;" :title="item.destinationUrl">
              {{ item.destinationUrl }}
            </td>
            <td>
              <v-chip
                v-if="item.responseStatus"
                size="x-small"
                :color="item.responseStatus >= 200 && item.responseStatus < 300 ? 'success' : 'error'"
                variant="flat"
                class="font-weight-bold"
              >
                {{ item.responseStatus }}
              </v-chip>
              <span v-else class="text-caption text-medium-emphasis">-</span>
            </td>
            <td>{{ item.attemptCount }}/10</td>
            <td>
              <v-chip size="x-small" :color="statusColor(item.status)" variant="flat" class="font-weight-bold">
                {{ statusLabel(item.status) }}
              </v-chip>
            </td>
            <td class="text-right">
              <v-btn icon="mdi-code-json" size="small" variant="text" title="Xem Payload" @click="viewDetail(item)" />
              <v-btn
                v-if="item.status === 'failed'"
                icon="mdi-restart"
                size="small"
                variant="text"
                color="primary"
                title="Thử lại (DLQ Retry)"
                :loading="item._retrying"
                @click="retryItem(item)"
              />
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <!-- Detail Drawer/Modal -->
    <v-dialog v-model="detailDialog" max-width="600">
      <v-card elevation="0" class="neo-card pa-4">
        <v-card-title class="text-subtitle-1 font-weight-bold" style="font-family: 'Space Grotesk', sans-serif;">
          CHI TIẾT SỰ KIỆN WEBHOOK
        </v-card-title>
        <v-card-text>
          <div v-if="selectedItem?.lastError" class="mb-3">
            <div class="text-caption font-weight-bold text-error mb-1">LỖI LẦN CUỐI:</div>
            <pre class="neo-code text-error pa-2">{{ selectedItem.lastError }}</pre>
          </div>
          <div class="text-caption font-weight-bold mb-1">PAYLOAD DỮ LIỆU:</div>
          <pre class="neo-code pa-2" style="max-height: 300px; overflow-y: auto;">{{ JSON.stringify(selectedItem?.payload, null, 2) }}</pre>
        </v-card-text>
        <v-card-actions class="justify-end">
          <v-btn variant="text" rounded="lg" @click="detailDialog = false">Đóng</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api';

const emit = defineEmits<{ (e: 'snack', text: string, color?: string): void }>();

const logs = ref<any[]>([]);
const loading = ref(false);
const activeStatus = ref('');
const detailDialog = ref(false);
const selectedItem = ref<any>(null);

const statusOptions = [
  { title: 'Tất cả', value: '' },
  { title: 'Thành công', value: 'delivered' },
  { title: 'Thất bại (DLQ)', value: 'failed' },
  { title: 'Tạm dừng', value: 'paused' },
  { title: 'Đang chờ', value: 'pending' },
];

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  delivered: { color: 'success', label: 'Thành công' },
  failed: { color: 'error', label: 'Lỗi' },
  paused: { color: 'warning', label: 'Tạm dừng' },
  dispatching: { color: 'primary', label: 'Đang gửi' },
};

const statusColor = (s: string) => STATUS_MAP[s]?.color || 'default';
const statusLabel = (s: string) => STATUS_MAP[s]?.label || 'Chờ gửi';

function filterStatus(val: string) {
  activeStatus.value = val;
  fetchLogs();
}

async function fetchLogs() {
  loading.value = true;
  try {
    const params: any = { limit: 50 };
    if (activeStatus.value) params.status = activeStatus.value;
    const res = await api.get('/settings/webhooks/logs', { params });
    logs.value = res.data.logs || [];
  } catch {
    emit('snack', 'Tải nhật ký webhook thất bại', 'error');
  } finally {
    loading.value = false;
  }
}

function viewDetail(item: any) {
  selectedItem.value = item;
  detailDialog.value = true;
}

async function retryItem(item: any) {
  item._retrying = true;
  try {
    await api.post(`/settings/webhooks/logs/${item.id}/retry`);
    emit('snack', 'Đã chuyển bản ghi vào hàng đợi phát lại');
    await fetchLogs();
  } catch {
    emit('snack', 'Thử lại thất bại', 'error');
  } finally {
    item._retrying = false;
  }
}

onMounted(() => fetchLogs());
</script>

<style scoped>
.neo-card { border: 1.5px solid var(--border-color); border-radius: 8px; }
.neo-code { font-family: monospace; font-size: 11px; background: var(--surface-variant); border: 1px solid var(--border-color); border-radius: 6px; white-space: pre-wrap; }
.gap-2 { gap: 8px; }
.font-mono { font-family: monospace; }
</style>
