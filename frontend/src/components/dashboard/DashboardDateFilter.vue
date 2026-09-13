<template>
  <div class="dashboard-date-filter">
    <div class="d-flex flex-wrap align-center justify-space-between" style="gap: 12px;">
      <!-- Preset Segmented Buttons -->
      <div class="d-flex flex-wrap align-center" style="gap: 6px;">
        <v-btn
          v-for="p in presets"
          :key="p.id"
          size="small"
          :class="['filter-pill-btn', { 'active-pill': selectedPreset === p.id }]"
          rounded="lg"
          elevation="0"
          @click="selectPreset(p.id)"
        >
          {{ p.label }}
        </v-btn>
      </div>

      <!-- Custom Date Pickers -->
      <div class="d-flex align-center flex-wrap" style="gap: 8px;">
        <div class="d-flex align-center date-input-wrap">
          <span class="text-caption font-weight-bold mr-2 text-muted" style="font-size: 0.72rem;">TỪ:</span>
          <input
            v-model="fromDate"
            type="date"
            class="custom-date-input"
            @change="onManualDateChange"
          />
        </div>
        <div class="d-flex align-center date-input-wrap">
          <span class="text-caption font-weight-bold mr-2 text-muted" style="font-size: 0.72rem;">ĐẾN:</span>
          <input
            v-model="toDate"
            type="date"
            class="custom-date-input"
            @change="onManualDateChange"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
  (e: 'filter', val: { from: string; to: string; preset: string }): void;
}>();

const presets = [
  { id: 'today', label: 'Hôm nay' },
  { id: 'yesterday', label: 'Hôm qua' },
  { id: '7days', label: '7 ngày' },
  { id: '30days', label: '30 ngày' },
  { id: 'thisMonth', label: 'Tháng này' },
  { id: 'all', label: 'Tất cả' },
];

const selectedPreset = ref('30days');

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const now = new Date();
const toDate = ref(formatDate(now));
const fromDate = ref(formatDate(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)));

function selectPreset(presetId: string) {
  selectedPreset.value = presetId;
  const current = new Date();

  if (presetId === 'today') {
    fromDate.value = formatDate(current);
    toDate.value = formatDate(current);
  } else if (presetId === 'yesterday') {
    const y = new Date(current.getTime() - 24 * 60 * 60 * 1000);
    fromDate.value = formatDate(y);
    toDate.value = formatDate(y);
  } else if (presetId === '7days') {
    const d7 = new Date(current.getTime() - 7 * 24 * 60 * 60 * 1000);
    fromDate.value = formatDate(d7);
    toDate.value = formatDate(current);
  } else if (presetId === '30days') {
    const d30 = new Date(current.getTime() - 30 * 24 * 60 * 60 * 1000);
    fromDate.value = formatDate(d30);
    toDate.value = formatDate(current);
  } else if (presetId === 'thisMonth') {
    const startOfMonth = new Date(current.getFullYear(), current.getMonth(), 1);
    fromDate.value = formatDate(startOfMonth);
    toDate.value = formatDate(current);
  } else if (presetId === 'all') {
    const dAll = new Date(current.getTime() - 90 * 24 * 60 * 60 * 1000);
    fromDate.value = formatDate(dAll);
    toDate.value = formatDate(current);
  }

  emit('filter', {
    from: fromDate.value,
    to: toDate.value,
    preset: selectedPreset.value,
  });
}

function onManualDateChange() {
  selectedPreset.value = 'custom';
  emit('filter', {
    from: fromDate.value,
    to: toDate.value,
    preset: 'custom',
  });
}
</script>

<style scoped>
.dashboard-date-filter {
  background: var(--surface-card);
  border: 1.5px solid var(--border-color);
  border-radius: 12px;
  padding: 10px 14px;
}

.filter-pill-btn {
  border: 1.5px solid var(--border-color) !important;
  background: var(--surface-card) !important;
  color: var(--text-main) !important;
  font-family: 'Space Grotesk', sans-serif !important;
  font-weight: 700 !important;
  font-size: 0.75rem !important;
  text-transform: none !important;
  height: 32px !important;
  transition: background 0.15s ease, color 0.15s ease;
}

.active-pill {
  background: #0068FF !important;
  color: #FFFFFF !important;
}

.date-input-wrap {
  background: var(--bg-main);
  border: 1.5px solid var(--border-color);
  border-radius: 8px;
  padding: 3px 8px;
}

.custom-date-input {
  border: none;
  background: transparent;
  color: var(--text-main);
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 0.78rem;
  outline: none;
}
</style>
