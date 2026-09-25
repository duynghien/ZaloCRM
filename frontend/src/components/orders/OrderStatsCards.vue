<template>
  <v-row class="mb-4">
    <v-col cols="6" sm="3">
      <v-card class="order-stat-card pa-4 fill-height d-flex flex-column justify-space-between" elevation="0">
        <div class="d-flex align-start justify-space-between mb-2">
          <span class="neo-subtitle text-truncate pr-1" style="color: var(--text-muted); font-size: 0.72rem;">TỔNG ĐƠN</span>
          <div class="neo-icon-box pastel-blue flex-shrink-0" style="width: 34px; height: 34px;"><v-icon size="18">basket-shopping-alt.svg</v-icon></div>
        </div>
        <div>
          <div class="kpi-value font-weight-black my-1" style="font-family: 'Space Grotesk', sans-serif;">{{ stats?.totalOrders ?? '—' }}</div>
          <div class="text-caption text-muted text-truncate" style="font-size: 0.7rem;">Toàn bộ đơn hàng</div>
        </div>
      </v-card>
    </v-col>
    <v-col cols="6" sm="3">
      <v-card class="order-stat-card pa-4 fill-height d-flex flex-column justify-space-between" elevation="0">
        <div class="d-flex align-start justify-space-between mb-2">
          <span class="neo-subtitle text-truncate pr-1" style="color: var(--text-muted); font-size: 0.72rem;">HOÀN THÀNH</span>
          <div class="neo-icon-box pastel-green flex-shrink-0" style="width: 34px; height: 34px;"><v-icon size="18">check.svg</v-icon></div>
        </div>
        <div>
          <div class="kpi-value font-weight-black my-1" style="font-family: 'Space Grotesk', sans-serif;">{{ stats?.completedOrders ?? '—' }}</div>
          <div class="text-caption text-muted text-truncate" style="font-size: 0.7rem;">Đơn hoàn tất</div>
        </div>
      </v-card>
    </v-col>
    <v-col cols="6" sm="3">
      <v-card class="order-stat-card pa-4 fill-height d-flex flex-column justify-space-between" elevation="0">
        <div class="d-flex align-start justify-space-between mb-2">
          <span class="neo-subtitle text-truncate pr-1" style="color: var(--text-muted); font-size: 0.72rem;">TỔNG DOANH THU</span>
          <div class="neo-icon-box pastel-blue flex-shrink-0" style="width: 34px; height: 34px;"><v-icon size="18">dong.svg</v-icon></div>
        </div>
        <div>
          <div class="kpi-value font-weight-black my-1" style="font-family: 'Space Grotesk', sans-serif; font-size: 1.6rem;">{{ formatVND(stats?.totalRevenue ?? 0) }}</div>
          <div class="text-caption text-muted text-truncate" style="font-size: 0.7rem;">Doanh thu lũy kế</div>
        </div>
      </v-card>
    </v-col>
    <v-col cols="6" sm="3">
      <v-card class="order-stat-card pa-4 fill-height d-flex flex-column justify-space-between" elevation="0">
        <div class="d-flex align-start justify-space-between mb-2">
          <span class="neo-subtitle text-truncate pr-1" style="color: var(--text-muted); font-size: 0.72rem;">HÔM NAY</span>
          <div class="neo-icon-box pastel-yellow flex-shrink-0" style="width: 34px; height: 34px;"><v-icon size="18">calendar-day.svg</v-icon></div>
        </div>
        <div>
          <div class="kpi-value font-weight-black my-1" style="font-family: 'Space Grotesk', sans-serif; font-size: 1.6rem;">{{ formatVND(stats?.todayRevenue ?? 0) }}</div>
          <div class="text-caption text-muted text-truncate" style="font-size: 0.7rem;">Doanh thu trong ngày</div>
        </div>
      </v-card>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import type { OrderStats } from '@/composables/use-orders';

defineProps<{
  stats: OrderStats | null;
}>();

function formatVND(n: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
}
</script>

<style scoped>
.order-stat-card {
  background: var(--surface-card);
  border: 1.5px solid var(--border-color);
  border-radius: 12px;
}

.kpi-value {
  font-size: 2.25rem;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.pastel-blue {
  background: var(--pastel-blue-bg) !important;
  color: var(--pastel-blue-fg) !important;
}

.pastel-green {
  background: var(--pastel-green-bg) !important;
  color: var(--pastel-green-fg) !important;
}

.pastel-yellow {
  background: var(--pastel-yellow-bg) !important;
  color: var(--pastel-yellow-fg) !important;
}
</style>
