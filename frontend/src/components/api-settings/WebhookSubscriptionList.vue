<template>
  <div class="webhook-subscription-list">
    <div class="d-flex justify-space-between align-center mb-4">
      <div>
        <h3 class="text-subtitle-1 font-weight-bold" style="font-family: 'Space Grotesk', sans-serif;">
          ĐIỂM NHẬN TIN (WEBHOOK SUBSCRIPTIONS)
        </h3>
        <p class="text-caption text-medium-emphasis mb-0">Hệ thống phân phối sự kiện tức thì tới các hệ thống bên thứ ba</p>
      </div>
      <v-btn color="primary" rounded="lg" elevation="0" prepend-icon="mdi-plus" @click="$emit('create')">
        Thêm Điểm Nhận Tin
      </v-btn>
    </div>

    <div v-if="loading" class="text-center py-8">
      <v-progress-circular indeterminate size="28" />
    </div>

    <div v-else-if="subscriptions.length === 0" class="text-center py-8 text-medium-emphasis">
      Chưa có webhook subscription nào. Bấm "Thêm Điểm Nhận Tin" để cấu hình.
    </div>

    <div v-else class="d-flex flex-column gap-3">
      <v-card
        v-for="sub in subscriptions"
        :key="sub.id"
        elevation="0"
        class="neo-card pa-4"
        :class="{ 'circuit-broken': sub.pauseReason === 'circuit_breaker' }"
      >
        <!-- Circuit Breaker Alert Banner -->
        <v-alert
          v-if="sub.pauseReason === 'circuit_breaker'"
          type="error"
          variant="tonal"
          density="comfortable"
          class="mb-3"
        >
          <div class="d-flex justify-space-between align-center">
            <div>
              <strong>Ngắt mạch an toàn (Circuit Breaker kích hoạt):</strong> Đã thất bại liên tiếp {{ sub.consecutiveFails }} lần.
              Hiện đang có {{ sub.pausedEventCount || 0 }} sự kiện tạm dừng chờ phát.
            </div>
            <v-btn color="error" size="small" variant="flat" elevation="0" :loading="sub._resetting" @click="resetCircuitBreaker(sub)">
              Kích Hoạt Lại
            </v-btn>
          </div>
        </v-alert>

        <div class="d-flex justify-space-between align-start">
          <div>
            <div class="d-flex align-center gap-2 mb-1">
              <span class="text-subtitle-2 font-weight-bold">{{ sub.name }}</span>
              <v-chip size="x-small" :color="sub.isActive ? 'success' : 'warning'" variant="flat" class="font-weight-bold">
                {{ sub.isActive ? 'ĐANG CHẠY' : sub.pauseReason === 'circuit_breaker' ? 'NGẮT MẠCH' : 'TẠM TẮT' }}
              </v-chip>
              <v-chip v-if="sub.sendV1Signature" size="x-small" variant="outlined" color="primary">V1 + V2 HMAC</v-chip>
              <v-chip v-else size="x-small" variant="outlined" color="secondary">Chỉ V2 HMAC</v-chip>
            </div>
            <div class="text-caption font-mono text-primary mb-2">
              <v-icon icon="mdi-link-variant" size="x-small" class="mr-1" />{{ sub.targetUrl }}
            </div>
            <div class="d-flex flex-wrap gap-1 align-center">
              <span class="text-caption text-medium-emphasis mr-1">Sự kiện:</span>
              <v-chip v-for="ev in (sub.events || [])" :key="ev" size="x-small" variant="tonal" class="font-mono">
                {{ ev }}
              </v-chip>
            </div>
          </div>

          <div class="d-flex align-center gap-1">
            <v-btn
              variant="outlined"
              size="small"
              rounded="lg"
              prepend-icon="mdi-send"
              :loading="sub._testing"
              @click="testEndpoint(sub)"
            >
              Test
            </v-btn>
            <v-btn
              :icon="sub.isActive ? 'mdi-pause' : 'mdi-play'"
              size="small"
              variant="text"
              :title="sub.isActive ? 'Tạm tắt' : 'Bật lại'"
              @click="toggleActive(sub)"
            />
            <v-btn icon="mdi-delete-outline" size="small" variant="text" color="error" title="Xóa" @click="deleteSub(sub)" />
          </div>
        </div>
      </v-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api } from '@/api';

const props = defineProps<{
  subscriptions: any[];
  loading: boolean;
}>();

const emit = defineEmits<{
  (e: 'create'): void;
  (e: 'refresh'): void;
  (e: 'snack', text: string, color?: string): void;
}>();

async function resetCircuitBreaker(sub: any) {
  sub._resetting = true;
  try {
    await api.put(`/settings/webhooks/${sub.id}`, { isActive: true });
    emit('snack', 'Đã khởi động lại mạch Webhook, hàng đợi sự kiện tiếp tục gửi');
    emit('refresh');
  } catch {
    emit('snack', 'Khởi động lại thất bại', 'error');
  } finally {
    sub._resetting = false;
  }
}

async function toggleActive(sub: any) {
  try {
    await api.put(`/settings/webhooks/${sub.id}`, { isActive: !sub.isActive });
    emit('snack', sub.isActive ? 'Đã tạm dừng nhận tin' : 'Đã bật nhận tin');
    emit('refresh');
  } catch {
    emit('snack', 'Thao tác thất bại', 'error');
  }
}

async function testEndpoint(sub: any) {
  sub._testing = true;
  try {
    const res = await api.post(`/settings/webhooks/${sub.id}/test`);
    if (res.data.success) {
      emit('snack', `Gửi thử thành công! Status: ${res.data.statusCode} (${res.data.latencyMs}ms)`);
    } else {
      emit('snack', `Endpoint phản hồi lỗi: ${res.data.statusCode || res.data.error}`, 'error');
    }
  } catch (err: any) {
    emit('snack', `Test thất bại: ${err.response?.data?.error || err.message}`, 'error');
  } finally {
    sub._testing = false;
  }
}

async function deleteSub(sub: any) {
  if (!confirm(`Bạn có chắc chắn muốn xóa điểm nhận tin "${sub.name}"?`)) return;
  try {
    await api.delete(`/settings/webhooks/${sub.id}`);
    emit('snack', 'Đã xóa điểm nhận tin');
    emit('refresh');
  } catch {
    emit('snack', 'Xóa thất bại', 'error');
  }
}
</script>

<style scoped>
.neo-card {
  border: 1.5px solid var(--border-color);
  border-radius: 8px;
}
.circuit-broken {
  border-color: #ef4444;
}
.gap-1 { gap: 4px; }
.gap-2 { gap: 8px; }
.gap-3 { gap: 12px; }
.font-mono { font-family: monospace; }
</style>
