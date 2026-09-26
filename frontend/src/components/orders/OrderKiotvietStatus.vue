<template>
  <div class="order-kiotviet-status d-flex align-center flex-wrap" style="gap: 6px;">
    <!-- Status Chip -->
    <v-chip
      size="small"
      :color="statusColor"
      variant="flat"
      rounded="pill"
      class="font-weight-bold neo-pill"
      style="border: 1.5px solid var(--border-color); font-size: 0.72rem;"
    >
      <v-progress-circular
        v-if="status === 'pending'"
        indeterminate
        size="12"
        width="2"
        class="mr-1"
        color="currentColor"
      />
      {{ statusLabel }}
    </v-chip>

    <!-- Synced Invoice Code with Copy -->
    <div v-if="status === 'synced' && invoiceCode" class="d-flex align-center" style="gap: 2px;">
      <span class="font-mono text-caption font-weight-bold" style="color: var(--primary);">
        {{ invoiceCode }}
      </span>
      <v-btn
        icon
        size="x-small"
        variant="text"
        :title="copied ? 'Đã sao chép!' : 'Sao chép mã HĐ'"
        @click="copyInvoiceCode"
      >
        <v-icon size="14">{{ copied ? 'check.svg' : 'copy.svg' }}</v-icon>
      </v-btn>
    </div>

    <!-- Error Message Tooltip/Chip -->
    <v-tooltip v-if="status === 'failed' && syncError" location="top">
      <template #activator="{ props }">
        <v-icon v-bind="props" size="16" color="error" class="cursor-pointer">
          info-circle.svg
        </v-icon>
      </template>
      <span>{{ syncError }}</span>
    </v-tooltip>

    <!-- Action: Xuất hóa đơn / Thử lại -->
    <v-btn
      v-if="canSyncButton"
      size="x-small"
      color="primary"
      variant="outlined"
      rounded="lg"
      class="font-weight-bold"
      :loading="syncing"
      :disabled="syncDisabled"
      @click="onSyncClick"
    >
      {{ status === 'failed' ? 'Thử lại KiotViet' : 'Xuất KiotViet' }}
    </v-btn>

    <!-- Warning if missing items -->
    <span v-if="missingItemsReason" class="text-caption text-grey ml-1">
      ({{ missingItemsReason }})
    </span>

    <!-- Action: Đối soát (Admin only when uncertain) -->
    <v-btn
      v-if="status === 'uncertain' && isAdmin"
      size="x-small"
      color="error"
      variant="flat"
      rounded="lg"
      class="font-weight-bold"
      @click="$emit('open-reconcile')"
    >
      Đối soát
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import type { Order } from '@/composables/use-orders';
import { useOrders } from '@/composables/use-orders';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{
  order: Order;
}>();

const emit = defineEmits<{
  'update:order': [order: Order];
  'open-reconcile': [];
}>();

const authStore = useAuthStore();
const isAdmin = computed(() => authStore.isAdmin);

const { getOrder, syncKiotviet, kiotvietStatusColor, kiotvietStatusLabel } = useOrders();

const syncing = ref(false);
const copied = ref(false);
let pollTimer: any = null;

const status = computed(() => props.order.kiotvietInvoiceStatus || 'none');
const invoiceCode = computed(() => props.order.kiotvietInvoiceCode);
const syncError = computed(() => props.order.kiotvietSyncError);

const statusColor = computed(() => kiotvietStatusColor(status.value));
const statusLabel = computed(() => kiotvietStatusLabel(status.value));

const hasItems = computed(() => (props.order.items?.length ?? 0) > 0);
const hasGenericItems = computed(() => {
  return props.order.items?.some((item: any) => !item.kiotvietProductId) ?? false;
});

const missingItemsReason = computed(() => {
  if (!hasItems.value && (status.value === 'none' || status.value === 'failed')) {
    return 'Cần bổ sung sản phẩm KiotViet';
  }
  if (hasGenericItems.value && (status.value === 'none' || status.value === 'failed')) {
    return 'Đơn hàng chứa sản phẩm ngoài (không đồng bộ KiotViet)';
  }
  return null;
});

const canSyncButton = computed(() => {
  return !hasGenericItems.value && (status.value === 'none' || status.value === 'failed');
});

const syncDisabled = computed(() => {
  return !hasItems.value || hasGenericItems.value || props.order.canSync === false;
});

function copyInvoiceCode() {
  if (!invoiceCode.value) return;
  navigator.clipboard.writeText(invoiceCode.value);
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 2000);
}

async function onSyncClick() {
  if (syncDisabled.value || syncing.value) return;
  syncing.value = true;
  try {
    const res = await syncKiotviet(props.order.id, props.order.kiotvietCustomerId || undefined);
    if (res.job) {
      // Transition local status to pending
      emit('update:order', {
        ...props.order,
        kiotvietInvoiceStatus: 'pending',
      });
      startPolling();
    }
  } catch (err) {
    console.error('Failed to sync to KiotViet:', err);
  } finally {
    syncing.value = false;
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const freshOrder = await getOrder(props.order.id);
      if (freshOrder) {
        emit('update:order', freshOrder);
        // Stop polling if reached terminal state
        if (['synced', 'failed', 'uncertain'].includes(freshOrder.kiotvietInvoiceStatus || '')) {
          stopPolling();
        }
      }
    } catch {
      stopPolling();
    }
  }, 2000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

watch(
  () => props.order.kiotvietInvoiceStatus,
  (newStatus) => {
    if (newStatus === 'pending') {
      if (!pollTimer) startPolling();
    } else {
      stopPolling();
    }
  },
  { immediate: true }
);

onMounted(() => {
  if (status.value === 'pending') {
    startPolling();
  }
});

onUnmounted(() => {
  stopPolling();
});
</script>

<style scoped>
.order-kiotviet-status {
  display: inline-flex;
}

.font-mono {
  font-family: monospace;
}

.cursor-pointer {
  cursor: pointer;
}
</style>
