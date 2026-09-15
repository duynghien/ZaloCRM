<template>
  <div>
    <!-- Toolbar CQA Style -->
    <div class="d-flex flex-wrap align-center justify-space-between mb-4" style="gap: 12px;">
      <div>
        <h1 class="neo-page-title mb-1" style="font-size: 1.75rem;">
          LỊCH HẸN <span class="neo-title-accent">KHÁCH HÀNG</span>
        </h1>
        <p class="text-caption neo-subtitle" style="color: var(--text-muted);">
          THEO DÕI VÀ QUẢN LÝ TIẾN TRÌNH LỊCH HẸN, TÁI KHÁM.
        </p>
      </div>
      <v-btn color="primary" rounded="lg" prepend-icon="plus-large.svg" class="font-weight-bold text-white px-4" style="border: 1.5px solid var(--border-color); font-family: 'Space Grotesk', sans-serif; height: 38px;" @click="showCreateDialog = true">
        TẠO LỊCH HẸN
      </v-btn>
    </div>

    <!-- Tabs -->
    <v-tabs v-model="activeTab" class="mb-4">
      <v-tab value="today">Hôm nay</v-tab>
      <v-tab value="upcoming">Sắp tới</v-tab>
      <v-tab value="all">Tất cả</v-tab>
    </v-tabs>

    <!-- "Tất cả" tab: status filter -->
    <div v-if="activeTab === 'all'" class="mb-3">
      <v-select
        v-model="filters.status"
        :items="APPOINTMENT_STATUS_OPTIONS"
        item-title="text"
        item-value="value"
        label="Trạng thái"
        rounded="lg"
        clearable
        style="max-width: 220px"
        hide-details
        @update:model-value="fetchAppointments()"
      />
    </div>

    <!-- Appointment table -->
    <v-data-table
      :headers="headers"
      :items="activeList"
      :loading="loading"
      item-value="id"
      hover
      class="chart-card"
    >
      <!-- Date -->
      <template #item.appointmentDate="{ item }">
        {{ formatDate(item.appointmentDate) }}
      </template>

      <!-- Contact name -->
      <template #item.contact="{ item }">
        <span class="font-weight-medium">{{ item.contact?.fullName ?? '—' }}</span>
        <div class="text-caption text-grey">{{ item.contact?.phone ?? '' }}</div>
      </template>

      <!-- Type -->
      <template #item.type="{ item }">
        {{ typeLabel(item.type) }}
      </template>

      <!-- Status chip -->
      <template #item.status="{ item }">
        <v-chip :color="statusChipColor(item.status)" size="small" variant="flat" rounded="pill" class="font-weight-bold neo-pill" style="border: 1.5px solid var(--border-color); font-size: 0.7rem;">
          {{ statusLabel(item.status) }}
        </v-chip>
      </template>

      <!-- Notes -->
      <template #item.notes="{ item }">
        <span class="text-body-2">{{ item.notes ?? '—' }}</span>
      </template>

      <!-- Actions -->
      <template #item.actions="{ item }">
        <div class="d-flex align-center justify-end" style="gap: 4px;">
          <!-- Quick status update menu -->
          <v-menu location="bottom end">
            <template #activator="{ props: menuProps }">
              <v-btn
                v-bind="menuProps"
                size="small"
                variant="outlined"
                rounded="lg"
                class="channel-action-btn"
                title="Đổi trạng thái"
              >
                <v-icon size="16">mdi-swap-horizontal</v-icon>
              </v-btn>
            </template>
            <v-list density="compact" style="border: 1.5px solid var(--border-color); border-radius: 8px;">
              <v-list-item
                v-for="opt in APPOINTMENT_STATUS_OPTIONS"
                :key="opt.value"
                :disabled="item.status === opt.value"
                @click="onStatusChange(item.id, opt.value)"
              >
                <v-list-item-title class="text-caption">{{ opt.text }}</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>

          <!-- Delete button -->
          <v-btn
            size="small"
            variant="outlined"
            rounded="lg"
            color="error"
            class="channel-action-btn"
            title="Xoá"
            @click.stop="onDelete(item.id)"
          >
            <v-icon size="16">trash-xmark-alt.svg</v-icon>
          </v-btn>
        </div>
      </template>
    </v-data-table>

    <!-- Create appointment dialog -->
    <v-dialog v-model="showCreateDialog" max-width="520" persistent>
      <v-card class="pa-2" style="border: 1.5px solid var(--border-color); border-radius: 12px;">
        <v-card-title class="d-flex align-center font-weight-bold neo-subtitle" style="font-size: 0.9rem;">
          TẠO LỊCH HẸN
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" size="small" @click="showCreateDialog = false" />
        </v-card-title>
        <v-divider />
        <v-card-text>
          <v-row dense>
            <v-col cols="12">
              <v-text-field
                v-model="createForm.contactId"
                label="ID khách hàng"
                hint="Nhập ID khách hàng"
                persistent-hint
                rounded="lg"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="createForm.appointmentDate" label="Ngày hẹn" type="date" rounded="lg" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="createForm.appointmentTime" label="Giờ hẹn" type="time" rounded="lg" />
            </v-col>
            <v-col cols="12">
              <v-select
                v-model="createForm.type"
                :items="APPOINTMENT_TYPE_OPTIONS"
                item-title="text"
                item-value="value"
                label="Loại"
                rounded="lg"
              />
            </v-col>
            <v-col cols="12">
              <v-textarea v-model="createForm.notes" label="Ghi chú" rows="2" auto-grow rounded="lg" />
            </v-col>
          </v-row>
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn rounded="lg" @click="showCreateDialog = false">Huỷ</v-btn>
          <v-btn color="primary" rounded="lg" class="font-weight-bold" style="border: 1.5px solid var(--border-color);" :loading="saving" @click="onCreateSave">Lưu</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import {
  useAppointments,
  APPOINTMENT_STATUS_OPTIONS,
  APPOINTMENT_TYPE_OPTIONS,
  statusChipColor,
  statusLabel,
} from '@/composables/use-appointments';
import type { Appointment } from '@/composables/use-appointments';

const {
  appointments, todayAppointments, upcomingAppointments,
  loading, saving, filters,
  fetchAppointments, fetchToday, fetchUpcoming,
  createAppointment, deleteAppointment, updateAppointment,
} = useAppointments();

const activeTab = ref<'today' | 'upcoming' | 'all'>('today');
const showCreateDialog = ref(false);

interface CreateForm {
  contactId: string;
  appointmentDate: string;
  appointmentTime: string;
  type: string;
  notes: string;
}

const createForm = ref<CreateForm>({
  contactId: '',
  appointmentDate: '',
  appointmentTime: '',
  type: 'follow_up',
  notes: '',
});

const headers = [
  { title: 'Ngày', key: 'appointmentDate', sortable: true },
  { title: 'Giờ', key: 'appointmentTime', sortable: true },
  { title: 'Khách hàng', key: 'contact', sortable: false },
  { title: 'Loại', key: 'type', sortable: false },
  { title: 'Trạng thái', key: 'status', sortable: false },
  { title: 'Ghi chú', key: 'notes', sortable: false },
  { title: '', key: 'actions', sortable: false, width: '120px' },
];

const activeList = computed<Appointment[]>(() => {
  switch (activeTab.value) {
    case 'today': return todayAppointments.value;
    case 'upcoming': return upcomingAppointments.value;
    default: return appointments.value;
  }
});

function formatDate(date: string) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('vi-VN');
}

function typeLabel(type: string) {
  return APPOINTMENT_TYPE_OPTIONS.find(o => o.value === type)?.text ?? type;
}

async function onStatusChange(id: string, status: string) {
  await updateAppointment(id, { status } as any);
  refreshActive();
}

async function onDelete(id: string) {
  await deleteAppointment(id);
  refreshActive();
}

async function onCreateSave() {
  const result = await createAppointment({
    contactId: createForm.value.contactId,
    appointmentDate: createForm.value.appointmentDate,
    appointmentTime: createForm.value.appointmentTime,
    type: createForm.value.type,
    notes: createForm.value.notes || null,
  } as Partial<Appointment>);
  if (result) {
    showCreateDialog.value = false;
    createForm.value = { contactId: '', appointmentDate: '', appointmentTime: '', type: 'follow_up', notes: '' };
    refreshActive();
  }
}

function refreshActive() {
  switch (activeTab.value) {
    case 'today': fetchToday(); break;
    case 'upcoming': fetchUpcoming(); break;
    default: fetchAppointments(); break;
  }
}

watch(activeTab, () => refreshActive());

onMounted(() => {
  fetchToday();
  fetchUpcoming();
});
</script>

<style scoped>
.chart-card {
  background: var(--surface-card);
  border: 1.5px solid var(--border-color);
  border-radius: 12px;
}

.channel-action-btn {
  width: 32px !important;
  height: 32px !important;
  border: 1.5px solid var(--border-color) !important;
}
</style>
