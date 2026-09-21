<template>
  <v-dialog :model-value="modelValue" max-width="520" persistent @update:model-value="$emit('update:modelValue', $event)">
    <v-card class="pa-2" style="border: 1.5px solid var(--border-color); border-radius: 12px;" elevation="0">
      <v-card-title class="font-weight-bold neo-subtitle d-flex align-center justify-space-between" style="font-size: 0.95rem;">
        <span>ĐỐI SOÁT HÓA ĐƠN KIOTVIET</span>
        <v-btn icon size="x-small" variant="text" @click="close">
          <v-icon size="16">xmark.svg</v-icon>
        </v-btn>
      </v-card-title>

      <v-card-text>
        <div class="text-caption text-grey mb-3">
          Đơn hàng <strong class="text-primary">{{ order?.orderCode }}</strong> đang ở trạng thái cần đối soát hoặc cần liên kết thủ công với KiotViet.
        </div>

        <!-- Action Selection -->
        <v-radio-group v-model="selectedAction" density="compact" class="mb-2">
          <v-radio
            value="link"
            label="1. Liên kết với hóa đơn có sẵn trên KiotViet"
            color="primary"
          />
          <v-radio
            value="confirm-not-created"
            label="2. Xác nhận chưa tạo hóa đơn (Mở khóa đơn để xuất lại)"
            color="warning"
          />
          <v-radio
            v-if="order?.kiotvietInvoiceId"
            value="refresh"
            label="3. Làm mới trạng thái từ KiotViet"
            color="info"
          />
        </v-radio-group>

        <!-- Form for 'link' -->
        <div v-if="selectedAction === 'link'" class="pa-3 mb-2" style="background: var(--surface-variant); border-radius: 8px; border: 1px solid var(--border-color);">
          <div class="text-caption font-weight-bold mb-1">Nhập ID hóa đơn trên KiotViet:</div>
          <v-text-field
            v-model="remoteInvoiceId"
            placeholder="Ví dụ: 12345678"
            density="compact"
            variant="outlined"
            rounded="lg"
            hide-details="auto"
            class="mb-2"
            :error-messages="linkError ? [linkError] : []"
          />
          <div class="text-caption text-grey" style="font-size: 0.72rem;">
            Hệ thống sẽ kiểm tra ID này trên KiotViet và liên kết với đơn hàng hiện tại nếu hợp lệ.
          </div>
        </div>

        <!-- Form for 'confirm-not-created' -->
        <div v-if="selectedAction === 'confirm-not-created'" class="pa-3 mb-2" style="background: var(--surface-variant); border-radius: 8px; border: 1px solid var(--border-color);">
          <div class="text-caption font-weight-bold mb-1">Lý do xác nhận (tối thiểu 5 ký tự):</div>
          <v-textarea
            v-model="confirmReason"
            placeholder="Ví dụ: Đã kiểm tra portal KiotViet lúc 14:00, không thấy hóa đơn nào..."
            rows="2"
            density="compact"
            variant="outlined"
            rounded="lg"
            hide-details="auto"
            class="mb-2"
            :error-messages="confirmError ? [confirmError] : []"
          />
          <div class="text-caption text-grey" style="font-size: 0.72rem;">
            Sau khi xác nhận, trạng thái hóa đơn sẽ chuyển sang thất bại và đơn hàng sẽ được mở khóa tài chính để nhân viên có thể sửa hoặc xuất lại.
          </div>
        </div>

        <!-- Info for 'refresh' -->
        <div v-if="selectedAction === 'refresh'" class="pa-3 mb-2" style="background: var(--surface-variant); border-radius: 8px; border: 1px solid var(--border-color);">
          <div class="text-caption text-grey">
            Hệ thống sẽ gọi KiotViet để lấy thông tin mới nhất của hóa đơn ID <strong>{{ order?.kiotvietInvoiceId }}</strong>.
          </div>
        </div>

        <!-- General Error Display -->
        <v-alert
          v-if="errorMessage"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-2 text-caption"
        >
          {{ errorMessage }}
        </v-alert>
      </v-card-text>

      <v-card-actions class="px-4 pb-3">
        <v-spacer />
        <v-btn rounded="lg" variant="text" @click="close">Hủy</v-btn>
        <v-btn
          color="primary"
          rounded="lg"
          class="font-weight-bold"
          style="border: 1.5px solid var(--border-color);"
          :loading="processing"
          :disabled="isSubmitDisabled"
          @click="submitReconcile"
        >
          Thực hiện
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { Order } from '@/composables/use-orders';
import { useOrders } from '@/composables/use-orders';

const props = defineProps<{
  modelValue: boolean;
  order: Order | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [val: boolean];
  'reconciled': [order: Order];
}>();

const { reconcileKiotviet } = useOrders();

const selectedAction = ref<'link' | 'confirm-not-created' | 'refresh'>('link');
const remoteInvoiceId = ref('');
const confirmReason = ref('');
const processing = ref(false);
const errorMessage = ref<string | null>(null);

watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      selectedAction.value = 'link';
      remoteInvoiceId.value = '';
      confirmReason.value = '';
      errorMessage.value = null;
    }
  }
);

const linkError = computed(() => {
  if (selectedAction.value === 'link' && remoteInvoiceId.value) {
    if (!/^\d+$/.test(remoteInvoiceId.value.trim())) {
      return 'ID hóa đơn phải là dạng số nguyên';
    }
  }
  return null;
});

const confirmError = computed(() => {
  if (selectedAction.value === 'confirm-not-created' && confirmReason.value) {
    if (confirmReason.value.trim().length < 5) {
      return 'Lý do phải có ít nhất 5 ký tự';
    }
  }
  return null;
});

const isSubmitDisabled = computed(() => {
  if (selectedAction.value === 'link') {
    return !remoteInvoiceId.value.trim() || !!linkError.value;
  }
  if (selectedAction.value === 'confirm-not-created') {
    return confirmReason.value.trim().length < 5;
  }
  return false;
});

function close() {
  emit('update:modelValue', false);
}

async function submitReconcile() {
  if (!props.order) return;
  processing.value = true;
  errorMessage.value = null;

  try {
    const payload: any = { action: selectedAction.value };
    if (selectedAction.value === 'link') {
      payload.remoteInvoiceId = remoteInvoiceId.value.trim();
    } else if (selectedAction.value === 'confirm-not-created') {
      payload.reason = confirmReason.value.trim();
    }

    const res = await reconcileKiotviet(props.order.id, payload);
    if (res?.order) {
      emit('reconciled', res.order);
      close();
    }
  } catch (err: any) {
    errorMessage.value = err?.response?.data?.message || err?.message || 'Đối soát thất bại';
  } finally {
    processing.value = false;
  }
}
</script>

<style scoped>
</style>
