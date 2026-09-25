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
    <OrderStatsCards :stats="stats" />

    <!-- Global Alert for errors like 409 locked delete -->
    <v-alert
      v-if="orderError"
      type="error"
      variant="tonal"
      density="compact"
      closable
      class="mb-3 text-caption"
      @click:close="orderError = null"
    >
      {{ orderError }}
    </v-alert>

    <!-- Filters -->
    <OrderFilterToolbar
      v-model:search="search"
      v-model:status-filter="statusFilter"
      @filter-change="onSearch"
    />

    <!-- Orders table -->
    <OrdersTable
      :orders="orders"
      :loading="loading"
      :status-color="statusColor"
      :status-label="statusLabel"
      @edit="openEdit"
      @delete="confirmDelete"
      @update:order="onOrderUpdated"
      @open-reconcile="openReconcile"
    />

    <!-- Staff performance -->
    <OrderStaffTable :staff-stats="staffStats" />

    <!-- Create / Edit dialog -->
    <OrderFormDialog
      v-model="dialog"
      :order="editingOrder"
      :saving="saving"
      :on-save="saveOrder"
    />

    <!-- Reconcile Dialog -->
    <KiotvietReconcileDialog
      v-model="reconcileDialog"
      :order="reconcileOrder"
      @reconciled="onOrderReconciled"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useOrders } from '@/composables/use-orders';
import type { Order } from '@/composables/use-orders';
import OrderStatsCards from '@/components/orders/OrderStatsCards.vue';
import OrderFilterToolbar from '@/components/orders/OrderFilterToolbar.vue';
import OrdersTable from '@/components/orders/OrdersTable.vue';
import OrderStaffTable from '@/components/orders/OrderStaffTable.vue';
import OrderFormDialog from '@/components/orders/OrderFormDialog.vue';
import KiotvietReconcileDialog from '@/components/orders/KiotvietReconcileDialog.vue';

const {
  orders, loading, saving, orderError, stats, staffStats,
  fetchOrders, createOrder, updateOrder, deleteOrder,
  fetchStats, fetchStaffStats, statusColor, statusLabel,
} = useOrders();

const search = ref('');
const statusFilter = ref<string | null>(null);
const dialog = ref(false);
const editingOrder = ref<Order | null>(null);

const reconcileDialog = ref(false);
const reconcileOrder = ref<Order | null>(null);

function buildParams() {
  const p: Record<string, string> = {};
  if (search.value) p['search'] = search.value;
  if (statusFilter.value) p['status'] = statusFilter.value;
  return p;
}

function onSearch() {
  fetchOrders(buildParams());
}

function openCreate() {
  editingOrder.value = null;
  dialog.value = true;
}

function openEdit(o: Order) {
  editingOrder.value = o;
  dialog.value = true;
}

async function saveOrder(payload: Partial<Order> & { expectedRevision?: number }, orderId?: string) {
  if (orderId) {
    await updateOrder(orderId, payload);
  } else {
    await createOrder(payload);
  }
  fetchOrders(buildParams());
  fetchStats();
}

async function confirmDelete(id: string) {
  if (!confirm('Xoá đơn hàng này?')) return;
  const ok = await deleteOrder(id);
  if (ok) {
    fetchOrders(buildParams());
    fetchStats();
  }
}

function onOrderUpdated(updated: Order) {
  const idx = orders.value.findIndex(o => o.id === updated.id);
  if (idx !== -1) {
    orders.value[idx] = updated;
  }
}

function openReconcile(o: Order) {
  reconcileOrder.value = o;
  reconcileDialog.value = true;
}

function onOrderReconciled(updated: Order) {
  onOrderUpdated(updated);
  fetchOrders(buildParams());
}

onMounted(() => {
  fetchOrders();
  fetchStats();
  fetchStaffStats();
});
</script>
