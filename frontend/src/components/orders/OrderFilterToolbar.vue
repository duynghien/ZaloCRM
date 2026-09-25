<template>
  <v-row class="mb-3">
    <v-col cols="12" sm="6" md="4">
      <v-text-field
        :model-value="search"
        label="Tìm kiếm mã đơn, khách hàng..."
        density="compact"
        variant="outlined"
        rounded="lg"
        prepend-inner-icon="search-alt-1.svg"
        hide-details
        clearable
        @update:model-value="onSearchUpdate"
      />
    </v-col>
    <v-col cols="12" sm="6" md="3">
      <v-select
        :model-value="statusFilter"
        label="Trạng thái"
        :items="statusFilterItems"
        item-title="text"
        item-value="value"
        density="compact"
        variant="outlined"
        rounded="lg"
        hide-details
        clearable
        @update:model-value="onStatusUpdate"
      />
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { ORDER_STATUS_OPTIONS } from '@/composables/use-orders';

defineProps<{
  search: string;
  statusFilter: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:search', val: string): void;
  (e: 'update:statusFilter', val: string | null): void;
  (e: 'filter-change'): void;
}>();

const statusFilterItems = [{ text: 'Tất cả', value: '' }, ...ORDER_STATUS_OPTIONS];

function onSearchUpdate(val: string | null) {
  emit('update:search', val || '');
  emit('filter-change');
}

function onStatusUpdate(val: string | null) {
  emit('update:statusFilter', val);
  emit('filter-change');
}
</script>
