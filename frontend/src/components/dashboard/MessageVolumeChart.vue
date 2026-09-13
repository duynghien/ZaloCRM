<template>
  <v-card>
    <v-card-title class="text-body-1 font-weight-bold" style="font-family: 'Space Grotesk', sans-serif;">Tin nhắn theo ngày</v-card-title>
    <v-card-text>
      <Bar v-if="chartData" :data="chartData" :options="chartOptions" style="height: 250px;" />
      <div v-else class="text-center pa-8 text-grey">Không có dữ liệu</div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTheme } from 'vuetify';
import { Bar } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const theme = useTheme();
const isDark = computed(() => theme.current.value.dark);

const props = defineProps<{
  data: { date: string; sent: number; received: number }[];
}>();

const chartData = computed(() => {
  if (!props.data?.length) return null;
  return {
    labels: props.data.map(d => d.date.slice(5)), // MM-DD
    datasets: [
      { label: 'Đã gửi', data: props.data.map(d => d.sent), backgroundColor: '#0068FF' },
      { label: 'Đã nhận', data: props.data.map(d => d.received), backgroundColor: '#10B981' },
    ],
  };
});

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top' as const,
      labels: {
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
  scales: {
    x: {
      grid: { color: isDark.value ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)' },
      ticks: { color: isDark.value ? '#A1A1AA' : '#71717A' },
    },
    y: {
      grid: { color: isDark.value ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)' },
      ticks: { color: isDark.value ? '#A1A1AA' : '#71717A' },
    },
  },
}));
</script>
