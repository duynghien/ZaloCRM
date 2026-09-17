<template>
  <div v-if="suggestion || showEmptyBar" class="chat-copilot-bar px-3 py-1 mb-1">
    <div class="d-flex align-center justify-space-between mb-1">
      <div class="d-flex align-center flex-wrap" style="gap: 6px;">
        <span class="copilot-brand font-weight-bold d-flex align-center">
          <span class="mr-1">✨</span> Copilot
        </span>

        <!-- Buying Intent & Sentiment Pill -->
        <span
          v-if="suggestion"
          class="neo-pill px-2 py-0 font-weight-medium text-caption d-inline-flex align-center"
          :style="intentStyle"
          :title="suggestion.insights.customerSummary || 'Tâm lý khách hàng'"
        >
          <span class="status-dot mr-1" :style="{ backgroundColor: intentDotColor }" />
          <span>{{ intentLabel }} ({{ Math.round(suggestion.insights.intentConfidence * 100) }}%)</span>
        </span>
      </div>

      <div class="d-flex align-center" style="gap: 4px;">
        <v-btn
          size="x-small"
          variant="tonal"
          color="primary"
          rounded="lg"
          class="neo-btn"
          :loading="loadingManual"
          @click="$emit('request-manual')"
        >
          ✨ Gợi ý
        </v-btn>
        <v-btn
          size="x-small"
          variant="text"
          :icon="isCollapsed ? 'mdi-chevron-down' : 'mdi-chevron-up'"
          @click="isCollapsed = !isCollapsed"
        />
      </div>
    </div>

    <!-- Smart Replies Chips -->
    <div
      v-if="!isCollapsed && suggestion && suggestion.smartReplies.length > 0"
      class="smart-replies-row d-flex align-center flex-nowrap overflow-x-auto pb-1"
      style="gap: 8px;"
    >
      <button
        v-for="(reply, idx) in suggestion.smartReplies"
        :key="reply.id || idx"
        type="button"
        class="smart-reply-chip text-truncate text-caption d-flex align-center"
        :title="reply.content"
        @click="$emit('apply-reply', reply.content)"
      >
        <span class="chip-shortcut font-mono mr-1">Alt+{{ idx + 1 }}</span>
        <span class="text-truncate">{{ reply.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { CopilotAnalysisResult } from '@/composables/use-chat-copilot';

const props = defineProps<{
  suggestion: CopilotAnalysisResult | null;
  conversationId: string | null;
  loadingManual?: boolean;
  showEmptyBar?: boolean;
}>();

const emit = defineEmits<{
  'apply-reply': [content: string];
  'request-manual': [];
}>();

const isCollapsed = ref(false);

const intentLabel = computed(() => {
  if (!props.suggestion) return '';
  switch (props.suggestion.insights.buyingIntent) {
    case 'ready_to_buy': return 'Sẵn sàng mua';
    case 'considering': return 'Đang cân nhắc';
    case 'exploring': return 'Đang tìm hiểu';
    default: return 'Chưa có ý định';
  }
});

const intentDotColor = computed(() => {
  if (!props.suggestion) return '#6B7280';
  switch (props.suggestion.insights.buyingIntent) {
    case 'ready_to_buy': return '#10B981';
    case 'considering': return '#F59E0B';
    case 'exploring': return '#0284C7';
    default: return '#9CA3AF';
  }
});

const intentStyle = computed(() => {
  if (!props.suggestion) return {};
  switch (props.suggestion.insights.buyingIntent) {
    case 'ready_to_buy':
      return { backgroundColor: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0' };
    case 'considering':
      return { backgroundColor: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' };
    case 'exploring':
      return { backgroundColor: '#F0F9FF', color: '#075985', border: '1px solid #BAE6FD' };
    default:
      return { backgroundColor: '#F3F4F6', color: '#374151', border: '1px solid #E5E7EB' };
  }
});

function handleKeyDown(e: KeyboardEvent) {
  if (!e.altKey || !props.suggestion || props.suggestion.smartReplies.length === 0) return;
  const num = parseInt(e.key, 10);
  if (num >= 1 && num <= props.suggestion.smartReplies.length) {
    e.preventDefault();
    const target = props.suggestion.smartReplies[num - 1];
    if (target) emit('apply-reply', target.content);
  }
}

onMounted(() => window.addEventListener('keydown', handleKeyDown));
onUnmounted(() => window.removeEventListener('keydown', handleKeyDown));
</script>

<style scoped>
.chat-copilot-bar {
  background: var(--surface-card, #ffffff);
  border: 1.5px solid var(--border-color, #111111);
  border-radius: 8px;
  box-shadow: none !important;
}

.copilot-brand {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.8rem;
  letter-spacing: -0.02em;
}

.smart-reply-chip {
  background: var(--surface-variant, #f8f9fa);
  border: 1.5px solid var(--border-color, #111111);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  white-space: nowrap;
  max-width: 220px;
  transition: transform 0.05s ease, background-color 0.1s ease;
}

.smart-reply-chip:hover {
  background: #f1f5f9;
}

.smart-reply-chip:active {
  transform: translate(1px, 1px);
}

.chip-shortcut {
  font-size: 0.68rem;
  opacity: 0.7;
  padding: 0 4px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
}
</style>
