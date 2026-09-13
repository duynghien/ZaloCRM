<template>
  <v-card class="chart-card" elevation="0">
    <v-card-title class="d-flex align-center py-3 px-4 font-weight-bold neo-subtitle" style="font-size: 0.85rem; border-bottom: 1px solid var(--border-color);">
      <v-icon class="mr-2" color="primary" size="18">mdi-account-group</v-icon>
      HIỆU SUẤT NHÂN VIÊN
    </v-card-title>
    <v-table density="compact">
      <thead>
        <tr>
          <th>Nhân viên</th>
          <th class="text-right">Số đơn</th>
          <th class="text-right">Doanh thu</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="staffStats.length === 0">
          <td colspan="3" class="text-center text-grey py-4">Không có dữ liệu</td>
        </tr>
        <tr v-for="s in staffStats" :key="s.userId">
          <td>{{ s.fullName || s.userId }}</td>
          <td class="text-right">{{ s.orderCount }}</td>
          <td class="text-right">{{ formatVND(s.totalRevenue) }}</td>
        </tr>
      </tbody>
    </v-table>
  </v-card>
</template>

<script setup lang="ts">
defineProps<{ staffStats: any[] }>();

function formatVND(n: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
}
</script>

<style scoped>
.chart-card {
  background: var(--surface-card);
  border: 1.5px solid var(--border-color);
  border-radius: 12px;
}
</style>
