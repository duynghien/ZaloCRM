<template>
  <v-card>
    <v-card-title class="text-body-1 font-weight-bold" style="font-family: 'Space Grotesk', sans-serif;">Nguồn khách hàng</v-card-title>
    <v-card-text>
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
  data: { source: string; _count: { _all: number } | number }[];
}>();

const sourceColors: Record<string, string> = {
  'FB': '#1877F2',
  'TT': '#E11D48',
  'GT': '#F59E0B',
  'CN': '#10B981',
};

function getCount(item: { _count: { _all: number } | number }): number {
  return typeof item._count === 'number' ? item._count : item._count._all;
}

const chartData = computed(() => {
  if (!props.data?.length) return null;
  return {
    labels: props.data.map(d => d.source),
    datasets: [{
      data: props.data.map(d => getCount(d)),
      backgroundColor: props.data.map(d => sourceColors[d.source] || '#A1A1AA'),
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
      cornerRadius: 4,
    },
  },
}));
</script>
