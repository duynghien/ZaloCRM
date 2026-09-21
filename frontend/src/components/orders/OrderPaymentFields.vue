<template>
  <div class="order-payment-fields">
    <div class="d-flex align-center justify-space-between mb-2">
      <span class="text-caption font-weight-bold neo-subtitle" style="font-size: 0.8rem;">
        TIỀN THỰC THU & PHƯƠNG THỨC
      </span>
      <div v-if="!disabled" class="d-flex align-center" style="gap: 4px;">
        <v-btn
          size="x-small"
          variant="outlined"
          rounded="lg"
          @click="setPaid(0)"
        >
          Chưa thu
        </v-btn>
        <v-btn
          size="x-small"
          color="primary"
          variant="tonal"
          rounded="lg"
          @click="setPaid(totalAmount)"
        >
          Thu đủ
        </v-btn>
      </div>
    </div>

    <v-row dense>
      <!-- Paid Amount -->
      <v-col cols="12" sm="6">
        <v-text-field
          :model-value="paidAmount ?? ''"
          label="Tiền thực thu (VND)"
          type="number"
          density="compact"
          variant="outlined"
          rounded="lg"
          min="0"
          :max="totalAmount"
          :disabled="disabled"
          :error-messages="paymentError ? [paymentError] : []"
          hide-details="auto"
          @update:model-value="onPaidAmountChange"
        />
      </v-col>

      <!-- Payment Method -->
      <v-col cols="12" sm="6">
        <v-select
          :model-value="paymentMethod"
          label="Phương thức thanh toán"
          :items="PAYMENT_METHODS"
          item-title="text"
          item-value="value"
          density="compact"
          variant="outlined"
          rounded="lg"
          :disabled="disabled || (paidAmount === 0 || paidAmount === null)"
          hide-details
          clearable
          @update:model-value="onPaymentMethodChange"
        />
      </v-col>

      <!-- Payment Account (if accounts available) -->
      <v-col v-if="paymentAccounts && paymentAccounts.length > 0" cols="12">
        <v-select
          :model-value="paymentAccountId"
          label="Tài khoản nhận tiền (KiotViet)"
          :items="paymentAccounts"
          item-title="name"
          item-value="id"
          density="compact"
          variant="outlined"
          rounded="lg"
          :disabled="disabled || !paidAmount"
          hide-details
          clearable
          @update:model-value="onPaymentAccountChange"
        />
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  paidAmount: number | null | undefined;
  paymentMethod: string | null | undefined;
  paymentAccountId?: string | null | undefined;
  totalAmount: number;
  disabled?: boolean;
  paymentAccounts?: Array<{ id: string | number; name: string; accountNumber?: string }>;
}>();

const emit = defineEmits<{
  'update:paidAmount': [val: number | null];
  'update:paymentMethod': [val: string | null];
  'update:paymentAccountId': [val: string | null];
}>();

const PAYMENT_METHODS = [
  { text: 'Tiền mặt (Cash)', value: 'Cash' },
  { text: 'Chuyển khoản (Transfer)', value: 'Transfer' },
  { text: 'Thẻ (Card)', value: 'Card' },
];

const paymentError = computed(() => {
  if (props.paidAmount !== null && props.paidAmount !== undefined) {
    if (props.paidAmount > props.totalAmount) {
      return 'Tiền thực thu không thể lớn hơn tổng tiền đơn hàng';
    }
    if (props.paidAmount < 0) {
      return 'Tiền thực thu không thể âm';
    }
    if (props.paidAmount > 0 && !props.paymentMethod) {
      return 'Vui lòng chọn phương thức thanh toán';
    }
  }
  return null;
});

function onPaidAmountChange(val: string | number) {
  if (val === '' || val === null || val === undefined) {
    emit('update:paidAmount', null);
    return;
  }
  const num = Number(val);
  emit('update:paidAmount', isNaN(num) ? 0 : Math.round(num));
  if (num > 0 && !props.paymentMethod) {
    emit('update:paymentMethod', 'Transfer');
  }
}

function onPaymentMethodChange(val: string | null) {
  emit('update:paymentMethod', val || null);
}

function onPaymentAccountChange(val: string | number | null) {
  emit('update:paymentAccountId', val ? String(val) : null);
}

function setPaid(amount: number) {
  emit('update:paidAmount', amount);
  if (amount > 0 && !props.paymentMethod) {
    emit('update:paymentMethod', 'Transfer');
  }
}
</script>

<style scoped>
.order-payment-fields {
  width: 100%;
}
</style>
