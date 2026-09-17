<template>
  <v-row class="mb-4">
    <!-- Dual-axis Timeline Chart -->
    <v-col cols="12">
      <v-card class="chart-card fill-height" elevation="0">
        <v-card-title class="d-flex align-center py-3 px-4 font-weight-bold neo-subtitle" style="font-size: 0.85rem; border-bottom: 1px solid var(--border-color);">
          <v-icon size="18" color="primary" class="mr-2">mdi-chart-timeline-variant</v-icon>
          XU HƯỚNG TIÊU THỤ THEO NGÀY (CHI PHÍ & TOKENS)
        </v-card-title>
        <v-card-text class="pt-4">
          <Line v-if="hasTimelineData" :data="timelineChartData" :options="timelineOptions" style="height: 260px;" />
          <div v-else class="text-center pa-8 text-grey">Không có dữ liệu tiêu thụ trong khoảng thời gian này</div>
        </v-card-text>
      </v-card>
    </v-col>

    <!-- Donut 1: By Task Type -->
    <v-col cols="12" md="6">
      <v-card class="chart-card fill-height" elevation="0">
        <v-card-title class="d-flex align-center py-3 px-4 font-weight-bold neo-subtitle" style="font-size: 0.85rem; border-bottom: 1px solid var(--border-color);">
          <v-icon size="18" color="primary" class="mr-2">mdi-chart-donut</v-icon>
          PHÂN BỔ CHI PHÍ THEO TÁC VỤ
        </v-card-title>
        <v-card-text class="pt-4">
          <Doughnut v-if="hasTaskData" :data="taskChartData" :options="donutOptions" style="height: 240px;" />
          <div v-else class="text-center pa-8 text-grey">Không có dữ liệu tác vụ</div>
        </v-card-text>
      </v-card>
    </v-col>

    <!-- Donut 2: By Model -->
    <v-col cols="12" md="6">
      <v-card class="chart-card fill-height" elevation="0">
        <v-card-title class="d-flex align-center py-3 px-4 font-weight-bold neo-subtitle" style="font-size: 0.85rem; border-bottom: 1px solid var(--border-color);">
          <v-icon size="18" color="primary" class="mr-2">mdi-robot-outline</v-icon>
          PHÂN BỔ CHI PHÍ THEO MÔ HÌNH AI
        </v-card-title>
        <v-card-text class="pt-4">
          <Doughnut v-if="hasModelData" :data="modelChartData" :options="donutOptions" style="height: 240px;" />
          <div v-else class="text-center pa-8 text-grey">Không có dữ liệu mô hình</div>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTheme } from 'vuetify';
import { Line, Doughnut } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import type { DailyTimelineItem, TaskTypeBreakdown, ModelBreakdown } from '@/api/ai-usage-api';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Title, Tooltip, Legend, Filler);

const props = defineProps<{
  timeline: DailyTimelineItem[];
  byTaskType: TaskTypeBreakdown[];
  byModel: ModelBreakdown[];
}>();

const theme = useTheme();
const isDark = computed(() => theme.current.value.dark);

const taskLabels: Record<string, string> = {
  copilot: 'Chat Copilot',
  executive_report: 'Báo cáo điều hành',
  audit_rule: 'Quy tắc kiểm tra',
  vision_ocr: 'OCR hình ảnh',
  test_connection: 'Kiểm tra kết nối',
};

const palette = ['#8B5CF6', '#38BDF8', '#10B981', '#F59E0B', '#EC4899', '#6366F1', '#14B8A6'];

const hasTimelineData = computed(() => props.timeline && props.timeline.length > 0);
const hasTaskData = computed(() => props.byTaskType && props.byTaskType.length > 0);
const hasModelData = computed(() => props.byModel && props.byModel.length > 0);

const timelineChartData = computed(() => ({
  labels: props.timeline.map((d) => d.date.slice(5)),
  datasets: [
    {
      label: 'Chi phí (VNĐ)',
      data: props.timeline.map((d) => d.costVnd),
      borderColor: '#8B5CF6',
      backgroundColor: 'rgba(139, 92, 246, 0.1)',
      yAxisID: 'y',
      tension: 0.3,
      fill: true,
    },
    {
      label: 'Tổng Tokens',
      data: props.timeline.map((d) => d.totalTokens),
      borderColor: '#0068FF',
      backgroundColor: 'rgba(0, 104, 255, 0.1)',
      yAxisID: 'y1',
      tension: 0.3,
    },
  ],
}));

const timelineOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: {
      position: 'top' as const,
      labels: { color: isDark.value ? '#F4F4F5' : '#18181B', font: { family: 'Plus Jakarta Sans' } },
    },
  },
  scales: {
    y: {
      type: 'linear' as const,
      display: true,
      position: 'left' as const,
      ticks: {
        color: isDark.value ? '#A1A1AA' : '#71717A',
        callback: (val: any) => `${Number(val).toLocaleString('vi-VN')}₫`,
      },
    },
    y1: {
      type: 'linear' as const,
      display: true,
      position: 'right' as const,
      grid: { drawOnChartArea: false },
      ticks: { color: isDark.value ? '#A1A1AA' : '#71717A' },
    },
  },
}));

const taskChartData = computed(() => ({
  labels: props.byTaskType.map((t) => taskLabels[t.taskType] || t.taskType),
  datasets: [{
    data: props.byTaskType.map((t) => t.costVnd),
    backgroundColor: palette.slice(0, props.byTaskType.length),
    borderWidth: 1.5,
    borderColor: isDark.value ? '#1F1F23' : '#FFFFFF',
  }],
}));

const modelChartData = computed(() => ({
  labels: props.byModel.map((m) => m.model),
  datasets: [{
    data: props.byModel.map((m) => m.costVnd),
    backgroundColor: palette.slice(0, props.byModel.length),
    borderWidth: 1.5,
    borderColor: isDark.value ? '#1F1F23' : '#FFFFFF',
  }],
}));

const donutOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'right' as const,
      labels: { color: isDark.value ? '#F4F4F5' : '#18181B', font: { family: 'Plus Jakarta Sans', size: 11 } },
    },
    tooltip: {
      callbacks: {
        label: (item: any) => ` ${item.label}: ${Number(item.raw).toLocaleString('vi-VN')} ₫`,
      },
    },
  },
}));
</script>

<style scoped>
.chart-card {
  background: var(--surface-card);
  border: 1.5px solid var(--border-color);
  border-radius: 12px;
}
</style>
