<template>
  <div v-if="visible && draft && draft.hasActionableData" class="chat-ai-draft-card pa-3 mb-2">
    <div class="d-flex align-center justify-space-between mb-2">
      <div class="d-flex align-center" style="gap: 6px;">
        <span class="draft-badge px-2 py-0 font-weight-bold text-caption d-inline-flex align-center gap-1">
          <v-icon size="14">mdi-creation</v-icon>
          <span>AI DRAFT</span>
        </span>
        <span class="text-caption font-weight-medium text-grey-darken-3">
          Phát hiện dữ liệu giao dịch tự động
        </span>
      </div>
      <v-btn size="x-small" variant="text" icon="mdi-close" title="Ẩn đề xuất" @click="visible = false" />
    </div>

    <!-- Summary Details -->
    <div class="draft-content text-caption mb-2">
      <!-- Order items -->
      <div v-if="orderItemsSummary" class="d-flex align-center mb-1">
        <v-icon size="14" class="mr-1 text-primary">mdi-package-variant</v-icon>
        <span class="font-weight-medium mr-1">Sản phẩm:</span>
        <span class="text-truncate">{{ orderItemsSummary }}</span>
        <span v-if="draft.orderDraft?.estimatedTotal" class="ml-1 font-weight-bold text-success">
          ({{ formatCurrency(draft.orderDraft.estimatedTotal) }})
        </span>
      </div>

      <!-- Address -->
      <div v-if="draft.orderDraft?.shippingAddress || draft.extractedContact?.address" class="d-flex align-center mb-1">
        <v-icon size="14" class="mr-1 text-info">mdi-map-marker-outline</v-icon>
        <span class="font-weight-medium mr-1">Địa chỉ:</span>
        <span class="text-truncate">{{ draft.orderDraft?.shippingAddress || draft.extractedContact?.address }}</span>
      </div>

      <!-- Phone -->
      <div v-if="draft.extractedContact?.phone" class="d-flex align-center mb-1">
        <v-icon size="14" class="mr-1 text-secondary">mdi-phone-outline</v-icon>
        <span class="font-weight-medium mr-1">SĐT:</span>
        <span>{{ draft.extractedContact.phone }}</span>
      </div>

      <!-- Appointment -->
      <div v-if="draft.appointmentDraft?.appointmentDate" class="d-flex align-center mb-1">
        <v-icon size="14" class="mr-1 text-warning">mdi-calendar-clock</v-icon>
        <span class="font-weight-medium mr-1">Lịch hẹn:</span>
        <span>{{ draft.appointmentDraft.appointmentDate }} {{ draft.appointmentDraft.appointmentTime || '' }}</span>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="d-flex align-center flex-wrap" style="gap: 6px;">
      <v-btn
        v-if="draft.orderDraft"
        size="small"
        color="primary"
        rounded="lg"
        class="neo-btn font-weight-bold"
        prepend-icon="mdi-plus"
        @click="handleOpenOrder"
      >
        Tạo Đơn Hàng (1-Click)
      </v-btn>

      <v-btn
        v-if="draft.appointmentDraft?.appointmentDate"
        size="small"
        color="warning"
        rounded="lg"
        class="neo-btn font-weight-bold"
        prepend-icon="mdi-plus"
        @click="handleOpenAppointment"
      >
        Đặt Lịch Hẹn
      </v-btn>

      <v-btn
        v-if="canEnrichContact"
        size="small"
        variant="outlined"
        rounded="lg"
        class="neo-btn"
        prepend-icon="mdi-plus"
        :loading="enriching"
        @click="handleEnrichContact"
      >
        Cập Nhật Hồ Sơ Contact
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { CopilotQuickDraft } from '@/composables/use-chat-copilot';

const props = defineProps<{
  draft: CopilotQuickDraft | null | undefined;
  contactId?: string | null;
  existingPhone?: string | null;
}>();

const emit = defineEmits<{
  'open-order-draft': [draftData: any];
  'open-appointment-draft': [draftData: any];
  'enrich-contact': [data: { phone?: string; address?: string }];
}>();

const visible = ref(true);
const enriching = ref(false);

watch(() => props.draft, () => {
  visible.value = true;
});

const orderItemsSummary = computed(() => {
  const items = props.draft?.orderDraft?.suggestedItems;
  if (!Array.isArray(items) || items.length === 0) return '';
  return items.map(i => `${i.quantity}x ${i.name}`).join(', ');
});

const canEnrichContact = computed(() => {
  if (!props.draft?.extractedContact) return false;
  const newPhone = props.draft.extractedContact.phone;
  const newAddress = props.draft.extractedContact.address || props.draft.orderDraft?.shippingAddress;
  return Boolean((newPhone && newPhone !== props.existingPhone) || newAddress);
});

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

function handleOpenOrder() {
  if (!props.draft?.orderDraft) return;
  const addr = props.draft.orderDraft.shippingAddress || props.draft.extractedContact?.address || '';
  const notesParts = [
    addr ? `ĐC: ${addr}` : '',
    orderItemsSummary.value ? `SP: ${orderItemsSummary.value}` : '',
    props.draft.orderDraft.notes || '',
  ].filter(Boolean);

  emit('open-order-draft', {
    totalAmount: props.draft.orderDraft.estimatedTotal || 0,
    notes: notesParts.join(' | '),
  });
}

function handleOpenAppointment() {
  if (!props.draft?.appointmentDraft) return;
  emit('open-appointment-draft', {
    date: props.draft.appointmentDraft.appointmentDate,
    time: props.draft.appointmentDraft.appointmentTime || '',
    notes: props.draft.appointmentDraft.notes || '',
  });
}

function handleEnrichContact() {
  if (!props.draft?.extractedContact) return;
  emit('enrich-contact', {
    phone: props.draft.extractedContact.phone,
    address: props.draft.extractedContact.address || props.draft.orderDraft?.shippingAddress,
  });
}
</script>

<style scoped>
.chat-ai-draft-card {
  background: var(--accent-warm, #FFF8E1);
  border: 1.5px solid var(--border-color, #111111);
  border-radius: 10px;
  box-shadow: none !important;
}

.draft-badge {
  background: #FEF08A;
  color: #854D0E;
  border: 1px solid #FACC15;
  border-radius: 9999px;
  font-size: 0.65rem;
  letter-spacing: 0.05em;
}
</style>
