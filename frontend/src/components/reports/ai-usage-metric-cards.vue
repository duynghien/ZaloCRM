<template>
  <v-row class="mb-4">
    <!-- Card 1: Tổng Chi Phí -->
    <v-col cols="12" sm="4">
      <v-card class="metric-card pa-4 fill-height d-flex flex-column justify-space-between" elevation="0">
        <div class="d-flex align-start justify-space-between mb-2">
          <span class="neo-subtitle text-truncate pr-1" style="color: var(--text-muted); font-size: 0.75rem;">
            TỔNG CHI PHÍ AI
          </span>
          <div class="neo-icon-box pastel-purple flex-shrink-0" style="width: 34px; height: 34px;">
            <v-icon size="18">mdi-currency-usd</v-icon>
          </div>
        </div>
        <div>
          <div class="metric-value font-weight-black my-1" style="font-family: 'Space Grotesk', sans-serif;">
            {{ formatVND(summary?.totalCostVnd ?? 0) }}
          </div>
          <div class="text-caption text-muted" style="font-size: 0.72rem;">
            ≈ ${{ (summary?.totalCostUsd ?? 0).toFixed(4) }} USD
          </div>
        </div>
      </v-card>
    </v-col>

    <!-- Card 2: Tổng Tokens -->
    <v-col cols="12" sm="4">
      <v-card class="metric-card pa-4 fill-height d-flex flex-column justify-space-between" elevation="0">
        <div class="d-flex align-start justify-space-between mb-2">
          <span class="neo-subtitle text-truncate pr-1" style="color: var(--text-muted); font-size: 0.75rem;">
            TỔNG TOKENS TIÊU THỤ
          </span>
          <div class="neo-icon-box pastel-blue flex-shrink-0" style="width: 34px; height: 34px;">
            <v-icon size="18">mdi-memory</v-icon>
          </div>
        </div>
        <div>
          <div class="metric-value font-weight-black my-1" style="font-family: 'Space Grotesk', sans-serif;">
            {{ formatTokens(summary?.totalTokens ?? 0) }}
          </div>
          <div class="text-caption text-muted text-truncate" style="font-size: 0.72rem;">
            In: {{ formatTokens(summary?.inputTokens ?? 0) }} • Out: {{ formatTokens(summary?.outputTokens ?? 0) }} • Cache: {{ formatTokens(summary?.cachedTokens ?? 0) }}
          </div>
        </div>
      </v-card>
    </v-col>

    <!-- Card 3: Số Lượt Gọi -->
    <v-col cols="12" sm="4">
      <v-card class="metric-card pa-4 fill-height d-flex flex-column justify-space-between" elevation="0">
        <div class="d-flex align-start justify-space-between mb-2">
          <span class="neo-subtitle text-truncate pr-1" style="color: var(--text-muted); font-size: 0.75rem;">
            SỐ LƯỢT YÊU CẦU
          </span>
          <div class="neo-icon-box pastel-green flex-shrink-0" style="width: 34px; height: 34px;">
            <v-icon size="18">mdi-bullseye-arrow</v-icon>
          </div>
        </div>
        <div>
          <div class="metric-value font-weight-black my-1" style="font-family: 'Space Grotesk', sans-serif;">
            {{ (summary?.requestCount ?? 0).toLocaleString('vi-VN') }}
          </div>
          <div class="text-caption text-muted" style="font-size: 0.72rem;">
            Lượt phân tích & suy luận AI
          </div>
        </div>
      </v-card>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
defineProps<{
  summary?: {
    totalCostVnd: number;
    totalCostUsd: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    requestCount: number;
  };
}>();

function formatVND(n: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
}

function formatTokens(count: number): string {
  if (!count || count <= 0) return '0';
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return count.toLocaleString('vi-VN');
}
</script>

<style scoped>
.metric-card {
  background: var(--surface-card);
  border: 1.5px solid var(--border-color);
  border-radius: 12px;
}

.metric-value {
  font-size: 1.8rem;
  line-height: 1.15;
  letter-spacing: -0.02em;
}

.pastel-purple {
  background: var(--pastel-purple-bg) !important;
  color: var(--pastel-purple-fg) !important;
}

.pastel-blue {
  background: var(--pastel-blue-bg) !important;
  color: var(--pastel-blue-fg) !important;
}

.pastel-green {
  background: var(--pastel-green-bg) !important;
  color: var(--pastel-green-fg) !important;
}
</style>
