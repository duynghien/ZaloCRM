<template>
  <div>
    <!-- Page Header CQA Style -->
    <div class="d-flex flex-wrap align-center justify-space-between mb-4" style="gap: 12px;">
      <div>
        <h1 class="neo-page-title mb-1" style="font-size: 1.75rem;">
          QUẢN LÝ <span class="neo-title-accent">ĐƠN HÀNG</span>
        </h1>
        <p class="text-caption neo-subtitle" style="color: var(--text-muted);">
          THEO DÕI VÀ XỬ LÝ ĐƠN HÀNG, DOANH SỐ NHÂN VIÊN.
        </p>
      </div>
      <v-btn color="primary" rounded="lg" prepend-icon="plus-large.svg" class="font-weight-bold text-white px-4" style="border: 1.5px solid var(--border-color); font-family: 'Space Grotesk', sans-serif; height: 38px;" @click="openCreate">
        TẠO ĐƠN HÀNG
      </v-btn>
    </div>

    <!-- Stats cards -->
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

    <!-- Filters -->
    <v-row class="mb-3">
      <v-col cols="12" sm="6" md="4">
        <v-text-field v-model="search" label="Tìm kiếm mã đơn, khách hàng..." density="compact"
          variant="outlined" rounded="lg" prepend-inner-icon="search-alt-1.svg" hide-details clearable @update:model-value="onSearch" />
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <v-select v-model="statusFilter" label="Trạng thái" :items="statusFilterItems"
          item-title="text" item-value="value" density="compact" variant="outlined" rounded="lg"
          hide-details clearable @update:model-value="onSearch" />
      </v-col>
    </v-row>

    <!-- Orders table -->
    <v-card class="mb-6 chart-card" elevation="0">
      <v-progress-linear v-if="loading" indeterminate color="primary" />
      <v-table density="compact">
        <thead>
          <tr>
            <th>Mã đơn</th>
            <th>Khách hàng</th>
            <th>Tổng tiền</th>
            <th>Trạng thái</th>
            <th>Nhân viên</th>
            <th>Ngày tạo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!loading && orders.length === 0">
            <td colspan="7" class="text-center text-grey py-6">Không có đơn hàng</td>
          </tr>
          <tr v-for="o in orders" :key="o.id">
            <td class="text-caption font-weight-bold font-mono">{{ o.orderCode }}</td>
            <td>{{ o.contact?.fullName || '—' }}</td>
            <td class="font-weight-bold">{{ formatVND(o.totalAmount) }}</td>
            <td>
              <v-chip size="small" :color="statusColor(o.status)" variant="flat" rounded="pill" class="font-weight-bold neo-pill" style="border: 1.5px solid var(--border-color); font-size: 0.7rem;">
                {{ statusLabel(o.status) }}
              </v-chip>
            </td>
            <td>{{ o.createdBy?.fullName || '—' }}</td>
            <td class="text-caption">{{ formatDate(o.createdAt) }}</td>
            <td>
              <v-btn icon size="x-small" variant="text" @click="openEdit(o)">
                <v-icon size="16">pen.svg</v-icon>
              </v-btn>
              <v-btn icon size="x-small" variant="text" color="error" @click="confirmDelete(o.id)">
                <v-icon size="16">trash-xmark-alt.svg</v-icon>
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <!-- Staff performance -->
    <OrderStaffTable :staff-stats="staffStats" />

    <!-- Create / Edit dialog -->
    <v-dialog v-model="dialog" max-width="480">
      <v-card class="pa-2" style="border: 1.5px solid var(--border-color); border-radius: 12px;">
        <v-card-title class="font-weight-bold neo-subtitle" style="font-size: 0.9rem;">{{ editingId ? 'CẬP NHẬT ĐƠN HÀNG' : 'TẠO ĐƠN HÀNG' }}</v-card-title>
        <v-card-text>
          <v-text-field v-if="!editingId" v-model="form.contactId" label="ID Khách hàng" density="compact"
            variant="outlined" rounded="lg" class="mb-3" hide-details />
          <v-text-field v-model.number="form.totalAmount" label="Tổng tiền (VND)" type="number"
            density="compact" variant="outlined" rounded="lg" class="mb-3" hide-details />
          <v-select v-model="form.status" label="Trạng thái" :items="ORDER_STATUS_OPTIONS"
            item-title="text" item-value="value" density="compact" variant="outlined" rounded="lg" class="mb-3" hide-details />
          <v-textarea v-model="form.notes" label="Ghi chú" rows="2" density="compact"
            variant="outlined" rounded="lg" hide-details />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn rounded="lg" @click="dialog = false">Huỷ</v-btn>
          <v-btn color="primary" rounded="lg" class="font-weight-bold" style="border: 1.5px solid var(--border-color);" :loading="saving" @click="submit">Lưu</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useOrders, ORDER_STATUS_OPTIONS } from '@/composables/use-orders';
import type { Order } from '@/composables/use-orders';
import OrderStaffTable from '@/components/orders/OrderStaffTable.vue';

const {
  orders, loading, saving, stats, staffStats,
  fetchOrders, createOrder, updateOrder, deleteOrder,
  fetchStats, fetchStaffStats, statusColor, statusLabel,
} = useOrders();

const search = ref('');
const statusFilter = ref<string | null>(null);
const dialog = ref(false);
const editingId = ref<string | null>(null);

const statusFilterItems = [{ text: 'Tất cả', value: '' }, ...ORDER_STATUS_OPTIONS];

const form = reactive({ contactId: '', totalAmount: 0, status: 'new', notes: '' });

function formatVND(n: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('vi-VN');
}

function buildParams() {
  const p: Record<string, string> = {};
  if (search.value) p['search'] = search.value;
  if (statusFilter.value) p['status'] = statusFilter.value;
  return p;
}

function onSearch() { fetchOrders(buildParams()); }

function openCreate() {
  editingId.value = null;
  Object.assign(form, { contactId: '', totalAmount: 0, status: 'new', notes: '' });
  dialog.value = true;
}

function openEdit(o: Order) {
  editingId.value = o.id;
  Object.assign(form, { contactId: o.contactId, totalAmount: o.totalAmount, status: o.status, notes: o.notes || '' });
  dialog.value = true;
}

async function submit() {
  if (editingId.value) {
    await updateOrder(editingId.value, { totalAmount: form.totalAmount, status: form.status, notes: form.notes || null });
  } else {
    await createOrder({ contactId: form.contactId, totalAmount: form.totalAmount, status: form.status, notes: form.notes || null });
  }
  dialog.value = false;
  fetchOrders(buildParams());
  fetchStats();
}

async function confirmDelete(id: string) {
  if (!confirm('Xoá đơn hàng này?')) return;
  await deleteOrder(id);
  fetchOrders(buildParams());
  fetchStats();
}

onMounted(() => {
  fetchOrders();
  fetchStats();
  fetchStaffStats();
});
</script>

<style scoped>
.order-stat-card {
  background: var(--surface-card);
  border: 1.5px solid var(--border-color);
  border-radius: 12px;
}

.chart-card {
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

.font-mono {
  font-family: monospace;
}
</style>
