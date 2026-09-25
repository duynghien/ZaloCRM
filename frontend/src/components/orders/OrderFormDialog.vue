<template>
  <v-dialog :model-value="modelValue" max-width="720" persistent scrollable @update:model-value="emit('update:modelValue', $event)">
    <v-card class="pa-2" style="border: 1.5px solid var(--border-color); border-radius: 12px;">
      <v-card-title class="font-weight-bold neo-subtitle d-flex align-center justify-space-between" style="font-size: 0.95rem;">
        <span>{{ order ? `CẬP NHẬT ĐƠN HÀNG ${order.orderCode}` : 'TẠO ĐƠN HÀNG MỚI' }}</span>
        <v-btn icon size="x-small" variant="text" @click="emit('update:modelValue', false)">
          <v-icon size="16">xmark.svg</v-icon>
        </v-btn>
      </v-card-title>

      <v-card-text style="max-height: 75vh;">
        <!-- Financial Lock Alert -->
        <v-alert
          v-if="isFinancialLocked"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-3 text-caption"
        >
          Đơn hàng này đã xuất hoặc đang xử lý hóa đơn KiotViet (<strong>{{ order?.kiotvietInvoiceStatus }}</strong>).
          Thông tin sản phẩm, giá tiền và phương thức thanh toán đã bị khóa. Vui lòng điều chỉnh trực tiếp trên KiotViet nếu cần.
        </v-alert>

        <!-- Dialog Error Alert -->
        <v-alert
          v-if="dialogError"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-3 text-caption"
        >
          {{ dialogError }}
        </v-alert>

        <!-- Contact ID Input (if creating) -->
        <v-text-field
          v-if="!order"
          v-model="form.contactId"
          label="ID Khách hàng (Contact ID)"
          density="compact"
          variant="outlined"
          rounded="lg"
          class="mb-3"
          hide-details
        />

        <!-- Customer Picker (KiotViet) -->
        <div class="mb-3">
          <KiotvietCustomerPicker
            v-model="kiotvietCustomerId"
            :phone="order?.contact?.phone"
            :name="order?.contact?.fullName"
            :disabled="isFinancialLocked"
          />
        </div>

        <v-divider class="my-3" />

        <!-- Order Items Selector -->
        <div class="mb-3">
          <OrderItemsSelector
            v-model="formItems"
            :disabled="isFinancialLocked"
            @update:total="onItemsTotalUpdated"
          />
        </div>

        <!-- Total Amount (Displays computed total or manual input if amount-only) -->
        <v-row dense class="mb-2">
          <v-col cols="12" sm="6">
            <v-text-field
              v-model.number="form.totalAmount"
              label="Tổng tiền đơn hàng (VND)"
              type="number"
              density="compact"
              variant="outlined"
              rounded="lg"
              :disabled="isFinancialLocked || formItems.length > 0"
              hide-details
            />
            <span v-if="formItems.length > 0" class="text-caption text-grey" style="font-size: 0.7rem;">
              Tự động tính từ danh sách sản phẩm
            </span>
          </v-col>
          <v-col cols="12" sm="6">
            <v-select
              v-model="form.status"
              label="Trạng thái giao hàng"
              :items="ORDER_STATUS_OPTIONS"
              item-title="text"
              item-value="value"
              density="compact"
              variant="outlined"
              rounded="lg"
              hide-details
            />
          </v-col>
        </v-row>

        <v-divider class="my-3" />

        <!-- Payment Fields -->
        <div class="mb-3">
          <OrderPaymentFields
            v-model:paid-amount="form.paidAmount"
            v-model:payment-method="form.paymentMethod"
            v-model:payment-account-id="form.paymentAccountId"
            :total-amount="form.totalAmount"
            :disabled="isFinancialLocked"
          />
        </div>

        <!-- Notes -->
        <v-textarea
          v-model="form.notes"
          label="Ghi chú đơn hàng"
          rows="2"
          density="compact"
          variant="outlined"
          rounded="lg"
          hide-details
        />
      </v-card-text>

      <v-card-actions class="px-4 pb-3">
        <v-spacer />
        <v-btn rounded="lg" variant="text" @click="emit('update:modelValue', false)">Hủy</v-btn>
        <v-btn
          color="primary"
          rounded="lg"
          class="font-weight-bold"
          style="border: 1.5px solid var(--border-color);"
          :loading="saving"
          @click="submit"
        >
          Lưu đơn hàng
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
import type { Order, OrderItem } from '@/composables/use-orders';
import { ORDER_STATUS_OPTIONS } from '@/composables/use-orders';
import OrderItemsSelector from '@/components/orders/OrderItemsSelector.vue';
import OrderPaymentFields from '@/components/orders/OrderPaymentFields.vue';
import KiotvietCustomerPicker from '@/components/orders/KiotvietCustomerPicker.vue';

const props = defineProps<{
  modelValue: boolean;
  order: Order | null;
  saving: boolean;
  onSave: (payload: Partial<Order> & { expectedRevision?: number }, orderId?: string) => Promise<void>;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
}>();

const dialogError = ref<string | null>(null);
const formItems = ref<OrderItem[]>([]);
const kiotvietCustomerId = ref<string | null>(null);

const form = reactive<{
  contactId: string;
  totalAmount: number;
  paidAmount: number | null;
  paymentMethod: string | null;
  paymentAccountId: string | null;
  status: string;
  notes: string;
}>({
  contactId: '',
  totalAmount: 0,
  paidAmount: null,
  paymentMethod: null,
  paymentAccountId: null,
  status: 'new',
  notes: '',
});

const isFinancialLocked = computed(() => {
  return props.order ? props.order.editable === false : false;
});

function initForm() {
  dialogError.value = null;
  if (props.order) {
    formItems.value = props.order.items ? [...props.order.items] : [];
    kiotvietCustomerId.value = props.order.kiotvietCustomerId || null;
    Object.assign(form, {
      contactId: props.order.contactId,
      totalAmount: props.order.totalAmount,
      paidAmount: props.order.paidAmount ?? null,
      paymentMethod: props.order.paymentMethod ?? null,
      paymentAccountId: props.order.paymentAccountId ?? null,
      status: props.order.status,
      notes: props.order.notes || '',
    });
  } else {
    formItems.value = [];
    kiotvietCustomerId.value = null;
    Object.assign(form, {
      contactId: '',
      totalAmount: 0,
      paidAmount: null,
      paymentMethod: null,
      paymentAccountId: null,
      status: 'new',
      notes: '',
    });
  }
}

watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      initForm();
    }
  },
  { immediate: true }
);

function onItemsTotalUpdated(total: number) {
  if (formItems.value.length > 0) {
    form.totalAmount = total;
  }
}

async function submit() {
  dialogError.value = null;
  try {
    const payload: Partial<Order> & { expectedRevision?: number } = {
      contactId: form.contactId,
      totalAmount: form.totalAmount,
      paidAmount: form.paidAmount,
      paymentMethod: form.paymentMethod,
      paymentAccountId: form.paymentAccountId,
      status: form.status,
      notes: form.notes || null,
      kiotvietCustomerId: kiotvietCustomerId.value,
      items: formItems.value,
    };

    if (props.order) {
      payload.expectedRevision = props.order.revision;
    }

    await props.onSave(payload, props.order?.id);
    emit('update:modelValue', false);
  } catch (err: any) {
    dialogError.value = err?.response?.data?.message || err?.message || 'Có lỗi xảy ra khi lưu đơn hàng';
  }
}
</script>
