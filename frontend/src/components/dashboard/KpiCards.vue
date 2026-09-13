<template>
  <v-row>
    <v-col v-for="card in cards" :key="card.title" cols="12" sm="6" md="4" lg="2">
      <v-card class="kpi-card pa-4 fill-height d-flex flex-column justify-space-between" elevation="0">
        <div class="d-flex align-start justify-space-between mb-2">
          <span class="neo-subtitle text-truncate pr-1" style="color: var(--text-muted); font-size: 0.72rem;">
            {{ card.title }}
          </span>
          <div :class="['neo-icon-box flex-shrink-0', card.pastelClass]" style="width: 34px; height: 34px;">
            <v-icon size="18">{{ card.icon }}</v-icon>
          </div>
        </div>
        <div>
          <div class="kpi-value font-weight-black my-1" style="font-family: 'Space Grotesk', sans-serif;">
            {{ card.value }}
          </div>
          <div class="text-caption text-muted text-truncate" style="font-size: 0.7rem;">
            {{ card.subtext }}
          </div>
        </div>
      </v-card>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface KpiData {
  messagesToday: number;
  messagesUnreplied: number;
  messagesUnread: number;
  appointmentsToday: number;
  newContactsThisWeek: number;
  totalContacts: number;
}

const props = defineProps<{
  kpi: KpiData | null;
}>();

const cards = computed(() => [
  {
    title: 'Tin nhắn hôm nay',
    value: props.kpi?.messagesToday ?? '—',
    icon: 'mdi-message-text-outline',
    pastelClass: 'pastel-blue',
    subtext: 'Hội thoại trong ngày',
  },
  {
    title: 'Chưa trả lời',
    value: props.kpi?.messagesUnreplied ?? '—',
    icon: 'mdi-message-alert-outline',
    pastelClass: 'pastel-yellow',
    subtext: 'Cần phản hồi ngay',
  },
  {
    title: 'Chưa đọc',
    value: props.kpi?.messagesUnread ?? '—',
    icon: 'mdi-email-mark-as-unread',
    pastelClass: 'pastel-pink',
    subtext: 'Tin nhắn chưa xem',
  },
  {
    title: 'Lịch hẹn hôm nay',
    value: props.kpi?.appointmentsToday ?? '—',
    icon: 'mdi-calendar-check-outline',
    pastelClass: 'pastel-green',
    subtext: 'Đã lên lịch hôm nay',
  },
  {
    title: 'KH mới tuần này',
    value: props.kpi?.newContactsThisWeek ?? '—',
    icon: 'mdi-account-plus-outline',
    pastelClass: 'pastel-blue',
    subtext: 'Gia tăng cơ sở dữ liệu',
  },
  {
    title: 'Tổng khách hàng',
    value: props.kpi?.totalContacts ?? '—',
    icon: 'mdi-account-group-outline',
    pastelClass: 'pastel-yellow',
    subtext: 'Khách hàng hệ thống',
  },
]);
</script>

<style scoped>
.kpi-card {
  background: var(--surface-card);
  border: 1.5px solid var(--border-color);
  border-radius: 12px;
}

.kpi-value {
  font-size: 2.25rem;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.pastel-blue {
  background: var(--pastel-blue-bg) !important;
  color: var(--pastel-blue-fg) !important;
}

.pastel-yellow {
  background: var(--pastel-yellow-bg) !important;
  color: var(--pastel-yellow-fg) !important;
}

.pastel-pink {
  background: var(--pastel-pink-bg) !important;
  color: var(--pastel-pink-fg) !important;
}

.pastel-green {
  background: var(--pastel-green-bg) !important;
  color: var(--pastel-green-fg) !important;
}
</style>
