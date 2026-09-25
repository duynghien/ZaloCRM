<template>
  <v-card class="mb-6 chart-card" elevation="0">
    <v-progress-linear v-if="loading" indeterminate color="primary" />
    <v-table density="compact">
      <thead>
        <tr>
          <th>Mã đơn</th>
          <th>Khách hàng</th>
          <th>Tổng tiền</th>
          <th>Trạng thái</th>
          <th>Hóa đơn KiotViet</th>
          <th>Nhân viên</th>
          <th>Ngày tạo</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!loading && orders.length === 0">
          <td colspan="8" class="text-center text-grey py-6">Không có đơn hàng</td>
        </tr>
        <tr v-for="o in orders" :key="o.id">
          <td class="text-caption font-weight-bold font-mono">{{ o.orderCode }}</td>
          <td>{{ o.contact?.fullName || '—' }}</td>
          <td class="font-weight-bold">
            <div>{{ formatVND(o.totalAmount) }}</div>
            <div v-if="o.paidAmount !== null && o.paidAmount !== undefined" class="text-caption text-grey" style="font-size: 0.7rem;">
              Đã thu: {{ formatVND(o.paidAmount) }}
            </div>
          </td>
          <td>
            <v-chip size="small" :color="statusColor(o.status)" variant="flat" rounded="pill" class="font-weight-bold neo-pill" style="border: 1.5px solid var(--border-color); font-size: 0.7rem;">
              {{ statusLabel(o.status) }}
            </v-chip>
          </td>
          <td>
            <OrderKiotvietStatus
              :order="o"
              @update:order="emit('update:order', $event)"
              @open-reconcile="emit('open-reconcile', o)"
            />
          </td>
          <td>{{ o.createdBy?.fullName || '—' }}</td>
          <td class="text-caption">{{ formatDate(o.createdAt) }}</td>
          <td>
            <v-btn icon size="x-small" variant="text" @click="emit('edit', o)">
              <v-icon size="16">pen.svg</v-icon>
            </v-btn>
            <v-btn
              icon
              size="x-small"
              variant="text"
              color="error"
              :disabled="o.editable === false"
              @click="emit('delete', o.id)"
            >
              <v-icon size="16">trash-xmark-alt.svg</v-icon>
            </v-btn>
          </td>
        </tr>
      </tbody>
    </v-table>
  </v-card>
</template>

<script setup lang="ts">
import type { Order } from '@/composables/use-orders';
import OrderKiotvietStatus from '@/components/orders/OrderKiotvietStatus.vue';

defineProps<{
  orders: Order[];
  loading: boolean;
  statusColor: (status: string) => string;
  statusLabel: (status: string) => string;
}>();

const emit = defineEmits<{
  (e: 'edit', order: Order): void;
  (e: 'delete', orderId: string): void;
  (e: 'update:order', order: Order): void;
  (e: 'open-reconcile', order: Order): void;
}>();

function formatVND(n: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('vi-VN');
}
</script>

<style scoped>
.chart-card {
  background: var(--surface-card);
  border: 1.5px solid var(--border-color);
  border-radius: 12px;
}

.font-mono {
  font-family: monospace;
}
</style>
