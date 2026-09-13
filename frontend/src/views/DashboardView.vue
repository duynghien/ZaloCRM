<template>
  <div>
    <!-- Page Title & Subtitle CQA Style -->
    <div class="mb-4">
      <h1 class="neo-page-title mb-1" style="font-size: 1.75rem;">
        KHÔNG GIAN LÀM VIỆC <span class="neo-title-accent">TỔNG QUAN</span>
      </h1>
      <p class="text-caption neo-subtitle" style="color: var(--text-muted);">
        THEO DÕI HOẠT ĐỘNG TIN NHẮN, KHÁCH HÀNG VÀ TIẾN ĐỘ VẬN HÀNH ZALO.
      </p>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <!-- Date filter segmented pills -->
    <DashboardDateFilter class="mb-4" @filter="onDateFilter" />

    <!-- Message & Contact KPI Cards -->
    <KpiCards :kpi="kpi" class="mb-4" />

    <!-- Order KPI Cards with CQA Styling -->
    <v-row class="mb-4">
      <v-col cols="12" sm="6" md="3">
        <v-card class="order-kpi-card pa-4 fill-height d-flex flex-column justify-space-between" elevation="0">
          <div class="d-flex align-start justify-space-between mb-2">
            <span class="neo-subtitle text-truncate pr-1" style="color: var(--text-muted); font-size: 0.72rem;">
              ĐƠN HÀNG MỚI
            </span>
            <div class="neo-icon-box pastel-blue flex-shrink-0" style="width: 34px; height: 34px;">
              <v-icon size="18">mdi-cart-outline</v-icon>
            </div>
          </div>
          <div>
            <div class="kpi-value font-weight-black my-1" style="font-family: 'Space Grotesk', sans-serif;">
              {{ orderStats?.totalOrders ?? '—' }}
            </div>
            <div class="text-caption text-muted text-truncate" style="font-size: 0.7rem;">
              Đơn hàng phát sinh
            </div>
          </div>
        </v-card>
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <v-card class="order-kpi-card pa-4 fill-height d-flex flex-column justify-space-between" elevation="0">
          <div class="d-flex align-start justify-space-between mb-2">
            <span class="neo-subtitle text-truncate pr-1" style="color: var(--text-muted); font-size: 0.72rem;">
              DOANH THU HÔM NAY
            </span>
            <div class="neo-icon-box pastel-green flex-shrink-0" style="width: 34px; height: 34px;">
              <v-icon size="18">mdi-cash-multiple</v-icon>
            </div>
          </div>
          <div>
            <div class="kpi-value font-weight-black my-1" style="font-family: 'Space Grotesk', sans-serif; font-size: 1.8rem;">
              {{ formatVND(orderStats?.todayRevenue ?? 0) }}
            </div>
            <div class="text-caption text-muted text-truncate" style="font-size: 0.7rem;">
              Doanh số ghi nhận
            </div>
          </div>
        </v-card>
      </v-col>
    </v-row>

    <!-- Charts Row 1 -->
    <v-row class="mb-4">
      <v-col cols="12" md="8">
        <MessageVolumeChart :data="messageVolume" />
      </v-col>
      <v-col cols="12" md="4">
        <PipelineChart :data="pipeline" />
      </v-col>
    </v-row>

    <!-- Charts Row 2 -->
    <v-row>
      <v-col cols="12" md="6">
        <SourceChart :data="sources" />
      </v-col>
      <v-col cols="12" md="6">
        <AppointmentChart :data="appointments" />
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import KpiCards from '@/components/dashboard/KpiCards.vue';
import DashboardDateFilter from '@/components/dashboard/DashboardDateFilter.vue';
import MessageVolumeChart from '@/components/dashboard/MessageVolumeChart.vue';
import PipelineChart from '@/components/dashboard/PipelineChart.vue';
import SourceChart from '@/components/dashboard/SourceChart.vue';
import AppointmentChart from '@/components/dashboard/AppointmentChart.vue';
import { useDashboard } from '@/composables/use-dashboard';

const {
  kpi, messageVolume, pipeline, sources, appointments,
  orderStats, loading, fetchAll,
} = useDashboard();

function formatVND(n: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
}

function onDateFilter(range: { from: string; to: string; preset: string }) {
  fetchAll({ from: range.from, to: range.to });
}

onMounted(() => fetchAll());
</script>

<style scoped>
.order-kpi-card {
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
</style>
