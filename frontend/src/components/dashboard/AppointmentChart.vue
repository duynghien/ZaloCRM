<template>
  <v-card class="chart-card fill-height" elevation="0">
    <v-card-title class="d-flex align-center py-3 px-4 font-weight-bold neo-subtitle" style="font-size: 0.85rem; border-bottom: 1px solid var(--border-color);">
      <v-icon size="18" color="primary" class="mr-2">mdi-calendar-clock</v-icon>
      TRẠNG THÁI LỊCH HẸN
    </v-card-title>
    <v-card-text class="pt-4">
      <Pie v-if="chartData" :data="chartData" :options="chartOptions" style="height: 250px;" />
      <div v-else class="text-center pa-8 text-grey">Không có dữ liệu</div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTheme } from 'vuetify';
import { Pie } from 'vue-chartjs';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

const theme = useTheme();
const isDark = computed(() => theme.current.value.dark);

const props = defineProps<{
  data: { status: string; _count: { _all: number } | number }[];
}>();

const statusColors: Record<string, string> = {
  'scheduled': '#0068FF',
  'completed': '#10B981',
  'cancelled': '#71717A',
  'no_show': '#EF4444',
};

const statusLabels: Record<string, string> = {
  'scheduled': 'Đã lên lịch',
  'completed': 'Hoàn thành',
  'cancelled': 'Đã hủy',
  'no_show': 'Vắng mặt',
};

function getCount(item: { _count: { _all: number } | number }): number {
  return typeof item._count === 'number' ? item._count : item._count._all;
}

const chartData = computed(() => {
  if (!props.data?.length) return null;
  return {
    labels: props.data.map(d => statusLabels[d.status] || d.status),
    datasets: [{
      data: props.data.map(d => getCount(d)),
      backgroundColor: props.data.map(d => statusColors[d.status] || '#A1A1AA'),
      borderWidth: 1.5,
      borderColor: isDark.value ? '#1F1F23' : '#FFFFFF',
    }],
  };
});

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'right' as const,
      labels: {
        boxWidth: 12,
        color: isDark.value ? '#F4F4F5' : '#18181B',
        font: { family: 'Plus Jakarta Sans' },
      },
    },
    tooltip: {
      backgroundColor: isDark.value ? '#1F1F23' : '#FFFFFF',
      titleColor: isDark.value ? '#F4F4F5' : '#18181B',
      bodyColor: isDark.value ? '#F4F4F5' : '#18181B',
      borderColor: isDark.value ? '#3F3F46' : '#18181B',
      borderWidth: 1.5,
      cornerRadius: 8,
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
