<template>
  <v-card
    class="kpi-card ai-cost-kpi-card pa-4 fill-height d-flex flex-column justify-space-between"
    elevation="0"
    @click="navigateToAiReports"
  >
    <div class="d-flex align-start justify-space-between mb-2">
      <span class="neo-subtitle text-truncate pr-1" style="color: var(--text-muted); font-size: 0.72rem;">
        CHI PHÍ AI
      </span>
      <div class="neo-icon-box pastel-purple flex-shrink-0" style="width: 34px; height: 34px;">
        <v-icon size="18">mdi-sparkles</v-icon>
      </div>
    </div>

    <div>
      <div class="kpi-value font-weight-black my-1" style="font-family: 'Space Grotesk', sans-serif; font-size: 1.8rem;">
        <template v-if="loading && !kpiData">
          <span class="text-caption text-muted">Đang tải...</span>
        </template>
        <template v-else>
          {{ formatVND(kpiData?.totalCostVnd ?? 0) }}
        </template>
      </div>

      <div class="text-caption text-muted text-truncate" style="font-size: 0.7rem;">
        {{ formatTokens(kpiData?.totalTokens ?? 0) }} • {{ kpiData?.requestCount ?? 0 }} yêu cầu
      </div>

      <div v-if="budgetAlert" class="mt-2">
        <div :class="['budget-badge', budgetAlert.type]">
          {{ budgetAlert.text }}
        </div>
      </div>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { getAiKpi, type AiKpiData } from '@/api/ai-usage-api';

const props = defineProps<{
  from?: string;
  to?: string;
}>();

const router = useRouter();
const kpiData = ref<AiKpiData | null>(null);
const loading = ref(false);
let activeRequestId = 0;

function formatVND(n: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
}

function formatTokens(count: number): string {
  if (!count || count <= 0) return '0 token';
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M tokens`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K tokens`;
  }
  return `${count} tokens`;
}

const budgetAlert = computed(() => {
  if (!kpiData.value?.budgetStatus || kpiData.value.budgetStatus.status === 'ok') return null;
  const { status, usagePercentage } = kpiData.value.budgetStatus;
  if (status === 'exceeded') {
    return { type: 'badge-exceeded', text: `🚨 Vượt ngân sách (${usagePercentage}%)` };
  }
  if (status === 'warning') {
    return { type: 'badge-warning', text: `⚠️ Cảnh báo ngân sách (${usagePercentage}%)` };
  }
  return null;
});

function navigateToAiReports() {
  router.push({ path: '/reports', query: { tab: 'ai-usage' } });
}

async function loadData() {
  const reqId = ++activeRequestId;
  loading.value = true;
  try {
    const data = await getAiKpi({ from: props.from, to: props.to });
    if (reqId === activeRequestId) {
      kpiData.value = data;
    }
  } catch {
    if (reqId === activeRequestId) {
      kpiData.value = null;
    }
  } finally {
    if (reqId === activeRequestId) {
      loading.value = false;
    }
  }
}

watch([() => props.from, () => props.to], () => {
  loadData();
});

onMounted(() => {
  loadData();
});
</script>

<style scoped>
.kpi-card {
  background: var(--surface-card);
  border: 1.5px solid var(--border-color);
  border-radius: 12px;
}

.ai-cost-kpi-card {
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.ai-cost-kpi-card:hover {
  transform: translateY(-2px);
  border-color: var(--primary-brand);
}

.kpi-value {
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.pastel-purple {
  background: var(--pastel-purple-bg) !important;
  color: var(--pastel-purple-fg) !important;
}

.budget-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 700;
}

.badge-warning {
  background: #FEF3C7;
  color: #92400E;
  border: 1px solid #FCD34D;
}

.badge-exceeded {
  background: #FEE2E2;
  color: #B91C1C;
  border: 1px solid #FCA5A5;
}
</style>
