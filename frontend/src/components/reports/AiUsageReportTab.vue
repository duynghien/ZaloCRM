<template>
  <div>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <!-- 3 Summary Metric Cards -->
    <AiUsageMetricCards :summary="reportData?.summary" />

    <!-- Charts: Timeline & Breakdown Donuts -->
    <AiUsageCharts
      :timeline="reportData?.dailyTimeline || []"
      :by-task-type="reportData?.byTaskType || []"
      :by-model="reportData?.byModel || []"
    />

    <!-- Detailed DataTable -->
    <v-card class="table-card pa-4" elevation="0">
      <div class="d-flex align-center justify-space-between mb-3">
        <div class="d-flex align-center">
          <v-icon size="18" color="primary" class="mr-2">mdi-table</v-icon>
          <span class="font-weight-bold neo-subtitle" style="font-size: 0.85rem;">
            CHI TIẾT TIÊU THỤ THEO NGÀY & TÁC VỤ
          </span>
        </div>
        <v-text-field
          v-model="search"
          placeholder="Tìm kiếm tác vụ, model..."
          density="compact"
          variant="outlined"
          rounded="lg"
          hide-details
          style="max-width: 260px;"
          prepend-inner-icon="mdi-magnify"
        />
      </div>

      <v-data-table
        :headers="headers"
        :items="reportData?.tableData || []"
        :search="search"
        :loading="loading"
        no-data-text="Không có dữ liệu AI trong khoảng thời gian này"
        density="comfortable"
      >
        <template #item.taskType="{ item }">
          <v-chip size="small" variant="tonal" color="primary">
            {{ formatTaskType(item.taskType) }}
          </v-chip>
        </template>

        <template #item.model="{ item }">
          <span class="text-caption font-weight-medium">{{ item.model }}</span>
          <span class="text-caption text-muted ml-1">({{ item.provider }})</span>
        </template>

        <template #item.totalTokens="{ item }">
          <span>{{ item.totalTokens.toLocaleString('vi-VN') }}</span>
        </template>

        <template #item.costUsd="{ item }">
          <span class="text-caption font-mono">${{ item.costUsd.toFixed(4) }}</span>
        </template>

        <template #item.costVnd="{ item }">
          <span class="font-weight-bold" style="font-family: 'Space Grotesk', sans-serif;">
            {{ formatVND(item.costVnd) }}
          </span>
        </template>
      </v-data-table>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import AiUsageMetricCards from './ai-usage-metric-cards.vue';
import AiUsageCharts from './ai-usage-charts.vue';
import { getAiUsageReport, type AiUsageReportResponse } from '@/api/ai-usage-api';

const props = defineProps<{
  from?: string;
  to?: string;
}>();

const loading = ref(false);
const search = ref('');
const reportData = ref<AiUsageReportResponse | null>(null);

const taskTypeMap: Record<string, string> = {
  copilot: 'Chat Copilot',
  executive_report: 'Báo cáo điều hành',
  audit_rule: 'Quy tắc kiểm tra',
  vision_ocr: 'OCR hình ảnh',
  test_connection: 'Kiểm tra kết nối',
};

function formatTaskType(t: string): string {
  return taskTypeMap[t] || t;
}

function formatVND(n: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
}

const headers = [
  { title: 'Ngày', key: 'date', sortable: true },
  { title: 'Tác vụ', key: 'taskType', sortable: true },
  { title: 'Model / Nhà cung cấp', key: 'model', sortable: true },
  { title: 'Số lượt gọi', key: 'requestCount', align: 'end' as const, sortable: true },
  { title: 'Tổng Tokens', key: 'totalTokens', align: 'end' as const, sortable: true },
  { title: 'Chi phí (USD)', key: 'costUsd', align: 'end' as const, sortable: true },
  { title: 'Chi phí (VNĐ)', key: 'costVnd', align: 'end' as const, sortable: true },
];

async function loadData() {
  loading.value = true;
  try {
    const res = await getAiUsageReport({ from: props.from, to: props.to });
    reportData.value = res;
  } catch (err) {
    console.error('Failed to load AI usage report:', err);
    reportData.value = null;
  } finally {
    loading.value = false;
  }
}

function refresh() {
  return loadData();
}

defineExpose({ refresh });

watch([() => props.from, () => props.to], () => {
  loadData();
});

onMounted(() => {
  loadData();
});
</script>

<style scoped>
.table-card {
  background: var(--surface-card);
  border: 1.5px solid var(--border-color);
  border-radius: 12px;
}
</style>
