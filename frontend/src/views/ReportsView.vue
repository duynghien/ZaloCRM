<template>
  <div>
    <div class="d-flex align-center mb-4 flex-wrap gap-2">
      <div>
        <h1 class="neo-page-title text-h4 mb-0">BÁO CÁO <span class="neo-title-accent">HỆ THỐNG</span></h1>
        <p class="text-caption text-medium-emphasis mb-0">Thống kê lưu lượng tin nhắn, khách hàng và lịch hẹn</p>
      </div>
      <v-spacer />
      <v-text-field
        v-model="dateFrom"
        label="Từ ngày"
        type="date"
        density="compact"
        variant="outlined"
        rounded="lg"
        style="max-width: 180px;"
        class="mr-2"
        hide-details
      />
      <v-text-field
        v-model="dateTo"
        label="Đến ngày"
        type="date"
        density="compact"
        variant="outlined"
        rounded="lg"
        style="max-width: 180px;"
        class="mr-2"
        hide-details
      />
      <v-btn color="primary" rounded="lg" elevation="0" prepend-icon="mdi-refresh" :loading="loading" @click="fetchReport">Xem</v-btn>
      <v-btn color="success" rounded="lg" elevation="0" prepend-icon="mdi-file-excel" class="ml-2" :loading="exporting" @click="exportExcel">Xuất Excel</v-btn>
    </div>

    <v-tabs v-model="tab" class="mb-4">
      <v-tab value="messages">Tin nhắn</v-tab>
      <v-tab value="contacts">Khách hàng</v-tab>
      <v-tab value="appointments">Lịch hẹn</v-tab>
      <v-tab v-if="canViewAiCost" value="ai-usage">Chi phí AI</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="messages">
        <v-card elevation="0">
          <v-data-table
            :headers="msgHeaders"
            :items="msgData"
            :loading="loading"
            no-data-text="Không có dữ liệu"
          />
        </v-card>
      </v-window-item>
      <v-window-item value="contacts">
        <v-card elevation="0">
          <v-data-table
            :headers="contactHeaders"
            :items="contactData"
            :loading="loading"
            no-data-text="Không có dữ liệu"
          />
        </v-card>
      </v-window-item>
      <v-window-item value="appointments">
        <v-card elevation="0">
          <v-data-table
            :headers="aptHeaders"
            :items="aptData"
            :loading="loading"
            no-data-text="Không có dữ liệu"
          />
        </v-card>
      </v-window-item>
      <v-window-item v-if="canViewAiCost" value="ai-usage">
        <AiUsageReportTab ref="aiTabRef" :from="dateFrom" :to="dateTo" />
      </v-window-item>
    </v-window>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import AiUsageReportTab from '@/components/reports/AiUsageReportTab.vue';
import { transformContactReport, transformAppointmentReport } from './reports-data-transformers';

const route = useRoute();
const authStore = useAuthStore();
const canViewAiCost = computed(() => authStore.isAdmin);
const aiTabRef = ref<InstanceType<typeof AiUsageReportTab> | null>(null);

// Date defaults: last 30 days
const today = new Date();
const prior = new Date(today);
prior.setDate(prior.getDate() - 30);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

const dateFrom = ref(fmt(prior));
const dateTo = ref(fmt(today));
const tab = ref((route.query.tab as string) || 'messages');
const loading = ref(false);
const exporting = ref(false);

watch(() => route.query.tab, (newTab) => {
  if (typeof newTab === 'string' && newTab) {
    tab.value = newTab;
  }
});

const msgData = ref<{ date: string; sent: number; received: number }[]>([]);
const contactData = ref<{ label: string; count: number }[]>([]);
const aptData = ref<{ label: string; count: number }[]>([]);

const msgHeaders = [
  { title: 'Ngày', key: 'date' },
  { title: 'Đã gửi', key: 'sent' },
  { title: 'Đã nhận', key: 'received' },
];

const contactHeaders = [
  { title: 'Phân loại', key: 'label' },
  { title: 'Số lượng', key: 'count' },
];

const aptHeaders = [
  { title: 'Phân loại', key: 'label' },
  { title: 'Số lượng', key: 'count' },
];

async function fetchReport() {
  if (tab.value === 'ai-usage') {
    aiTabRef.value?.refresh();
    return;
  }
  loading.value = true;
  try {
    const params = { from: dateFrom.value, to: dateTo.value };
    if (tab.value === 'messages') {
      const res = await api.get('/reports/messages', { params });
      msgData.value = res.data.data || res.data;
    } else if (tab.value === 'contacts') {
      const res = await api.get('/reports/contacts', { params });
      contactData.value = transformContactReport(res.data);
    } else if (tab.value === 'appointments') {
      const res = await api.get('/reports/appointments', { params });
      aptData.value = transformAppointmentReport(res.data);
    }
  } catch (err) {
    console.error('Report fetch error:', err);
  } finally {
    loading.value = false;
  }
}

async function exportExcel() {
  exporting.value = true;
  try {
    const res = await api.get('/reports/export', {
      params: { type: tab.value, from: dateFrom.value, to: dateTo.value },
      responseType: 'blob',
    });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    const prefix = tab.value === 'ai-usage' ? 'ai-usage-report' : `report-${tab.value}`;
    a.download = `${prefix}-${dateFrom.value}-to-${dateTo.value}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Export error:', err);
  } finally {
    exporting.value = false;
  }
}

// Auto-fetch when tab changes
watch(tab, () => fetchReport());

// Initial load
fetchReport();
</script>
