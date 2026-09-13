<template>
  <v-card>
    <v-card-title class="text-body-1 font-weight-bold" style="font-family: 'Space Grotesk', sans-serif;">Pipeline khách hàng</v-card-title>
    <v-card-text>
      <Doughnut v-if="chartData" :data="chartData" :options="chartOptions" style="height: 250px;" />
      <div v-else class="text-center pa-8 text-grey">Không có dữ liệu</div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTheme } from 'vuetify';
import { Doughnut } from 'vue-chartjs';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

const theme = useTheme();
const isDark = computed(() => theme.current.value.dark);

const props = defineProps<{
  data: { status: string | null; _count: { _all: number } | number }[];
}>();

const statusColors: Record<string, string> = {
  new: '#38BDF8',
  contacted: '#0068FF',
  interested: '#F59E0B',
  converted: '#10B981',
  lost: '#EF4444',
};

const statusLabels: Record<string, string> = {
  new: 'Mới',
  contacted: 'Đã liên hệ',
  interested: 'Quan tâm',
  converted: 'Chuyển đổi',
  lost: 'Mất',
};

function getCount(item: { _count: { _all: number } | number }): number {
  return typeof item._count === 'number' ? item._count : item._count._all;
}

const chartData = computed(() => {
  if (!props.data?.length) return null;
  const filtered = props.data.filter(d => d.status);
  if (!filtered.length) return null;
  return {
    labels: filtered.map(d => statusLabels[d.status || ''] || d.status),
    datasets: [{
      data: filtered.map(d => getCount(d)),
      backgroundColor: filtered.map(d => statusColors[d.status || ''] || '#A1A1AA'),
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
