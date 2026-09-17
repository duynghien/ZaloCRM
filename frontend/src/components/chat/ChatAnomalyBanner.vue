<template>
  <div v-if="visible && (anomaly || isEscalationPending)" class="chat-anomaly-banner pa-3 mb-2">
    <div class="d-flex align-center justify-space-between mb-1">
      <div class="d-flex align-center" style="gap: 6px;">
        <v-icon color="error" size="18">mdi-alert-octagon</v-icon>
        <span class="font-weight-bold text-caption text-error font-mono">
          ⚠️ CẢNH BÁO RỦI RO KHIẾU NẠI
        </span>
        <span
          class="neo-pill px-2 py-0 text-caption font-weight-bold"
          :style="{ backgroundColor: '#FEE2E2', color: '#991B1B', border: '1px solid #F87171' }"
        >
          {{ severityLabel }}
        </span>
      </div>
      <v-btn size="x-small" variant="text" icon="mdi-close" @click="visible = false" />
    </div>

    <!-- Reason description -->
    <div class="text-caption font-weight-medium mb-2 text-grey-darken-3">
      {{ reasonText }}
    </div>

    <!-- Actions -->
    <div class="d-flex align-center flex-wrap" style="gap: 6px;">
      <v-btn
        size="small"
        color="error"
        variant="tonal"
        rounded="lg"
        class="neo-btn"
        @click="applySoothingReply"
      >
        🕊️ Gợi ý xoa dịu
      </v-btn>

      <v-btn
        size="small"
        variant="outlined"
        rounded="lg"
        class="neo-btn"
        :loading="resolving"
        @click="handleResolve"
      >
        ✓ Đánh dấu đã xử lý
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

const props = defineProps<{
  anomaly?: {
    severity?: string;
    reason?: string;
  } | null;
  conversationMetadata?: Record<string, any> | null;
}>();

const emit = defineEmits<{
  'apply-reply': [content: string];
  'resolve': [];
}>();

const visible = ref(true);
const resolving = ref(false);

watch([() => props.anomaly, () => props.conversationMetadata], () => {
  visible.value = true;
});

const isEscalationPending = computed(() => {
  return props.conversationMetadata?.escalationStatus === 'pending';
});

const severityLabel = computed(() => {
  const sev = props.anomaly?.severity || 'critical';
  switch (sev) {
    case 'critical': return 'Khẩn cấp';
    case 'high': return 'Nghiêm trọng';
    case 'medium': return 'Trung bình';
    default: return 'Cần lưu ý';
  }
});

const reasonText = computed(() => {
  return (
    props.anomaly?.reason ||
    props.conversationMetadata?.escalationReason ||
    'Khách hàng có biểu hiện bức xúc gay gắt hoặc khiếu nại chất lượng dịch vụ.'
  );
});

function applySoothingReply() {
  const sample =
    'Dạ em rất hiểu và vô cùng xin lỗi về sự bất tiện anh/chị đang gặp phải ạ! Em đã báo ngay cho Trưởng bộ phận để ưu tiên xử lý dứt điểm cho mình trong hôm nay. Anh/chị yên tâm nhé ạ!';
  emit('apply-reply', sample);
}

function handleResolve() {
  resolving.value = true;
  emit('resolve');
  setTimeout(() => {
    resolving.value = false;
    visible.value = false;
  }, 400);
}
</script>

<style scoped>
.chat-anomaly-banner {
  background: var(--accent-danger, #FFEBEE);
  border: 1.5px solid #D32F2F;
  border-radius: 10px;
  box-shadow: none !important;
}
</style>
