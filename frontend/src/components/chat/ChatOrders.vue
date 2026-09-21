<template>
  <div>
    <v-divider class="my-3" />
    <div class="d-flex align-center mb-2">
      <v-icon size="16" color="success" class="mr-1">basket-shopping-alt.svg</v-icon>
      <span class="text-caption font-weight-bold">Đơn hàng ({{ contactOrders.length }})</span>
      <v-spacer />
      <v-btn size="x-small" variant="text" color="primary" @click="toggleCreate">
        <v-icon size="14">{{ showCreate ? 'xmark.svg' : 'plus-large.svg' }}</v-icon>
      </v-btn>
    </div>

    <!-- Quick create form -->
    <div
      v-if="showCreate"
      class="mb-3 pa-2"
      style="background: var(--surface-variant); border-radius: var(--radius-btn, 8px); border: 1.5px solid var(--border-color);"
    >
      <div class="text-caption font-weight-bold mb-2">TẠO ĐƠN HÀNG MỚI</div>

      <!-- Error Alert -->
      <v-alert
        v-if="createError"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-2 text-caption"
      >
        {{ createError }}
      </v-alert>

      <!-- Items Selector -->
      <div class="mb-2">
        <OrderItemsSelector
          v-model="newOrderItems"
          @update:total="onItemsTotalUpdated"
        />
      </div>

      <!-- Total Amount (if amount-only or manual) -->
      <v-text-field
        v-model.number="newOrder.totalAmount"
        label="Tổng tiền (VND)"
        type="number"
        density="compact"
        variant="outlined"
        rounded="lg"
        :disabled="newOrderItems.length > 0"
        hide-details
        class="mb-2"
      />

      <!-- Payment Fields -->
      <div class="mb-2">
        <OrderPaymentFields
          v-model:paid-amount="newPaidAmount"
          v-model:payment-method="newPaymentMethod"
          :total-amount="newOrder.totalAmount"
        />
      </div>

      <!-- Notes -->
      <v-text-field
        v-model="newOrder.notes"
        label="Ghi chú đơn hàng"
        density="compact"
        variant="outlined"
        rounded="lg"
        hide-details
        class="mb-2"
      />

      <div class="d-flex justify-end" style="gap: 6px;">
        <v-btn size="small" variant="text" @click="showCreate = false">Hủy</v-btn>
        <v-btn
          size="small"
          color="success"
          rounded="lg"
          elevation="0"
          :loading="creating"
          :disabled="newOrder.totalAmount <= 0"
          @click="submitCreate"
        >
          Lưu đơn hàng
        </v-btn>
      </div>
    </div>

    <!-- Order list -->
    <div
      v-for="o in contactOrders"
      :key="o.id"
      class="mb-2 pa-2"
      style="border-radius: var(--radius-btn, 8px); border: 1.5px solid var(--border-color); background: var(--surface-variant);"
    >
      <div class="d-flex align-center justify-space-between mb-1">
        <div>
          <span class="font-mono text-caption font-weight-bold">{{ o.orderCode }}</span>
          <span class="text-caption text-grey ml-1">· {{ formatDate(o.createdAt) }}</span>
        </div>
        <v-chip size="x-small" :color="statusColor(o.status)" variant="tonal" rounded="pill" class="neo-pill">
          {{ statusLabel(o.status) }}
        </v-chip>
      </div>

      <div class="d-flex align-center justify-space-between mb-1">
        <div class="text-body-2 font-weight-bold">{{ formatVND(o.totalAmount) }}</div>
        <div v-if="o.paidAmount !== null && o.paidAmount !== undefined" class="text-caption text-grey">
          Đã thu: {{ formatVND(o.paidAmount) }}
        </div>
      </div>

      <!-- KiotViet Sync Status Row -->
      <div class="mt-1 pt-1 d-flex align-center justify-space-between" style="border-top: 1px dashed var(--border-color);">
        <OrderKiotvietStatus
          :order="o"
          @update:order="onOrderUpdated"
          @open-reconcile="openReconcile(o)"
        />
      </div>
    </div>

    <div v-if="contactOrders.length === 0 && !showCreate" class="text-caption text-grey text-center py-2">
      Chưa có đơn hàng
    </div>

    <!-- Reconcile Dialog -->
    <KiotvietReconcileDialog
      v-model="reconcileDialog"
      :order="reconcileOrder"
      @reconciled="onOrderReconciled"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onUnmounted } from 'vue';
import { api } from '@/api/index';
import { useOrders, type Order, type OrderItem } from '@/composables/use-orders';
import OrderItemsSelector from '@/components/orders/OrderItemsSelector.vue';
import OrderPaymentFields from '@/components/orders/OrderPaymentFields.vue';
import OrderKiotvietStatus from '@/components/orders/OrderKiotvietStatus.vue';
import KiotvietReconcileDialog from '@/components/orders/KiotvietReconcileDialog.vue';

const props = defineProps<{
  contactId: string | null;
  pendingDraft?: { totalAmount?: number; notes?: string } | null;
}>();

const { statusColor, statusLabel, createOrder } = useOrders();

const contactOrders = ref<Order[]>([]);
const showCreate = ref(false);
const creating = ref(false);
const createError = ref<string | null>(null);

const newOrder = reactive({ totalAmount: 0, notes: '' });
const newOrderItems = ref<OrderItem[]>([]);
const newPaidAmount = ref<number | null>(null);
const newPaymentMethod = ref<string | null>(null);

const reconcileDialog = ref(false);
const reconcileOrder = ref<Order | null>(null);

let activeAbortController: AbortController | null = null;

function formatVND(n: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('vi-VN');
}

function toggleCreate() {
  showCreate.value = !showCreate.value;
  if (!showCreate.value) {
    resetDraft();
  }
}

function resetDraft() {
  newOrder.totalAmount = 0;
  newOrder.notes = '';
  newOrderItems.value = [];
  newPaidAmount.value = null;
  newPaymentMethod.value = null;
  createError.value = null;
}

function onItemsTotalUpdated(total: number) {
  if (newOrderItems.value.length > 0) {
    newOrder.totalAmount = total;
  }
}

async function loadOrders() {
  if (!props.contactId) {
    contactOrders.value = [];
    return;
  }

  if (activeAbortController) {
    activeAbortController.abort();
  }
  activeAbortController = new AbortController();

  try {
    const res = await api.get(`/contacts/${props.contactId}/orders`, {
      signal: activeAbortController.signal,
    });
    contactOrders.value = res.data.orders || [];
  } catch (err: any) {
    if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {
      console.error('Failed to load contact orders:', err);
    }
  } finally {
    activeAbortController = null;
  }
}

async function submitCreate() {
  if (!props.contactId || newOrder.totalAmount <= 0) return;
  creating.value = true;
  createError.value = null;

  try {
    await createOrder({
      contactId: props.contactId,
      totalAmount: newOrder.totalAmount,
      paidAmount: newPaidAmount.value,
      paymentMethod: newPaymentMethod.value,
      notes: newOrder.notes || null,
      conversationId: null,
      items: newOrderItems.value.length > 0 ? newOrderItems.value : undefined,
    });

    showCreate.value = false;
    resetDraft();
    await loadOrders();
  } catch (err: any) {
    createError.value = err?.response?.data?.message || err?.message || 'Lỗi khi tạo đơn hàng';
  } finally {
    creating.value = false;
  }
}

function populateDraft(draft: { totalAmount?: number; notes?: string }) {
  if (!draft) return;
  showCreate.value = true;
  if (typeof draft.totalAmount === 'number') newOrder.totalAmount = draft.totalAmount;
  if (draft.notes) newOrder.notes = draft.notes;
}

function onOrderUpdated(updated: Order) {
  const idx = contactOrders.value.findIndex(o => o.id === updated.id);
  if (idx !== -1) {
    contactOrders.value[idx] = updated;
  }
}

function openReconcile(o: Order) {
  reconcileOrder.value = o;
  reconcileDialog.value = true;
}

function onOrderReconciled(updated: Order) {
  onOrderUpdated(updated);
  loadOrders();
}

defineExpose({ populateDraft });

watch(
  () => props.pendingDraft,
  (d) => {
    if (d) populateDraft(d);
  },
  { immediate: true }
);

// Invariant: Contact switch race defense
// When contact changes, cancel in-flight requests, reset drafts and stop polling
watch(
  () => props.contactId,
  (newId) => {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    resetDraft();
    showCreate.value = false;
    if (newId) {
      loadOrders();
    } else {
      contactOrders.value = [];
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
});
</script>

<style scoped>
.font-mono {
  font-family: monospace;
}
</style>
