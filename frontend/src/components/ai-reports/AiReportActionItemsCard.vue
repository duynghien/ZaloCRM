<template>
  <div v-if="reportActionItems.length > 0" class="ai-report-action-items">
    <v-card
      class="pa-4 mb-4 chart-card"
      elevation="0"
      style="border: 2px solid var(--border-color); background: var(--bg-surface);"
    >
      <div class="d-flex align-center justify-space-between flex-wrap gap-2 mb-3">
        <div class="d-flex align-center gap-2">
          <v-icon color="primary" size="24">mdi-checkbox-marked-circle-outline</v-icon>
          <span class="text-subtitle-1 font-weight-bold">
            Nhiệm vụ & Hành động tiếp theo (Action Items)
          </span>
          <v-chip size="small" color="primary" variant="tonal" class="font-weight-bold">
            {{ completedTaskCount }}/{{ reportActionItems.length }} ({{ taskProgressPercent }}%)
          </v-chip>
        </div>

        <v-btn
          color="primary"
          prepend-icon="mdi-bullhorn-outline"
          size="small"
          class="font-weight-bold"
          style="border: 1.5px solid var(--border-color);"
          @click="openBroadcastTaskDialog"
        >
          Gửi nhiệm vụ vào nhóm Zalo
        </v-btn>
      </div>

      <!-- Progress Bar -->
      <v-progress-linear
        :model-value="taskProgressPercent"
        color="primary"
        height="8"
        rounded
        class="mb-4"
      />

      <!-- Tasks List -->
      <div class="d-flex flex-column gap-2">
        <div
          v-for="task in reportActionItems"
          :key="task.id"
          class="d-flex align-center justify-space-between pa-3 rounded-lg flex-wrap gap-2"
          :style="{
            border: '1px solid var(--border-color)',
            background: task.done ? 'rgba(var(--v-theme-surface-variant), 0.3)' : 'var(--v-theme-surface)',
            opacity: task.done ? 0.75 : 1,
          }"
        >
          <div class="d-flex align-center gap-3 flex-grow-1" style="min-width: 260px;">
            <v-checkbox-btn
              :model-value="task.done"
              density="compact"
              color="primary"
              @update:model-value="handleToggleTask(task)"
            />
            <div>
              <div
                class="font-weight-medium text-body-2"
                :style="{ textDecoration: task.done ? 'line-through' : 'none' }"
              >
                {{ task.task }}
              </div>
              <div class="d-flex align-center gap-3 text-caption text-medium-emphasis mt-1 flex-wrap">
                <span class="d-inline-flex align-center">
                  <v-icon size="14" class="mr-1">mdi-account-outline</v-icon>
                  <strong>Phụ trách:</strong>&nbsp;{{ task.assignee || 'Chưa phân công' }}
                </span>
                <span class="d-inline-flex align-center">
                  <v-icon size="14" class="mr-1">mdi-clock-outline</v-icon>
                  <strong>Thời hạn:</strong>&nbsp;{{ task.deadline || 'Trong ca' }}
                </span>
                <span v-if="task.completedAt" class="text-success font-weight-medium d-inline-flex align-center">
                  <v-icon size="14" color="success" class="mr-1">mdi-check-circle-outline</v-icon>
                  Hoàn thành lúc {{ formatDateTime(task.completedAt) }}
                </span>
              </div>
            </div>
          </div>

          <div class="d-flex align-center gap-2">
            <v-chip
              v-if="task.category === 'compliance_missing_evidence'"
              size="x-small"
              color="warning"
              variant="tonal"
              class="font-weight-bold"
              prepend-icon="mdi-file-alert-outline"
            >
              Cần bổ sung chứng từ
            </v-chip>
            <v-chip
              v-else-if="task.category === 'anomaly_fraud'"
              size="x-small"
              color="error"
              variant="tonal"
              class="font-weight-bold"
              prepend-icon="mdi-alert-octagon-outline"
            >
              Bất thường
            </v-chip>
            <v-chip
              size="x-small"
              :color="task.priority === 'high' ? 'error' : task.priority === 'low' ? 'success' : 'warning'"
              :prepend-icon="task.priority === 'high' ? 'mdi-alert-circle' : task.priority === 'low' ? 'mdi-arrow-down-circle' : 'mdi-alert'"
              variant="flat"
              class="font-weight-bold"
            >
              {{ task.priority === 'high' ? 'Cao' : task.priority === 'low' ? 'Thấp' : 'Trung bình' }}
            </v-chip>
            <v-chip v-if="task.groupName" size="x-small" variant="outlined">
              {{ task.groupName }}
            </v-chip>
          </div>
        </div>
      </div>
    </v-card>

    <!-- Dialog: Broadcast Tasks to Zalo -->
    <v-dialog v-model="broadcastTaskDialog" max-width="600">
      <v-card class="pa-5 chart-card" elevation="0">
        <div class="d-flex align-center justify-space-between mb-4">
          <h3 class="text-h6 font-weight-bold d-flex align-center">
            <v-icon class="mr-2" size="20">mdi-bullhorn-outline</v-icon>
            Phát sóng nhiệm vụ vào nhóm Zalo
          </h3>
          <v-btn icon="mdi-close" variant="text" size="small" @click="broadcastTaskDialog = false" />
        </div>

        <v-select
          v-model="broadcastForm.senderAccountId"
          :items="senderOptions"
          item-title="label"
          item-value="id"
          label="Tài khoản Zalo gửi tin"
          placeholder="Chọn tài khoản Zalo"
          density="compact"
          variant="outlined"
          rounded="lg"
          class="mb-3"
        />

        <v-select
          v-model="broadcastForm.targetThreadId"
          :items="reportSourceGroups"
          item-title="groupName"
          item-value="groupThreadId"
          label="Nhóm Zalo nhận việc"
          placeholder="Chọn nhóm Zalo nguồn"
          density="compact"
          variant="outlined"
          rounded="lg"
          class="mb-3"
        />

        <v-textarea
          v-model="broadcastForm.customHeaderNote"
          label="Ghi chú thêm cho ca tiếp theo (tùy chọn)"
          placeholder="Nhập lưu ý đặc biệt hoặc thông điệp nhắc nhở ca làm việc..."
          rows="2"
          density="compact"
          variant="outlined"
          rounded="lg"
          class="mb-3"
        />

        <div class="text-caption text-medium-emphasis mb-2 font-weight-medium">
          Chọn nhiệm vụ cần phát sóng (mặc định: các việc chưa hoàn thành):
        </div>
        <div class="pa-2 rounded-lg mb-4" style="border: 1px solid var(--border-color); max-height: 180px; overflow-y: auto;">
          <div v-for="t in reportActionItems" :key="t.id" class="d-flex align-center gap-2 py-1">
            <v-checkbox-btn
              v-model="broadcastForm.selectedTaskIds"
              :value="t.id"
              density="compact"
              color="primary"
            />
            <span class="text-body-2 text-truncate" :style="{ textDecoration: t.done ? 'line-through' : 'none' }">
              {{ t.task }} ({{ t.assignee || 'Chưa phân công' }})
            </span>
          </div>
        </div>

        <div class="d-flex justify-end gap-2">
          <v-btn variant="text" rounded="lg" @click="broadcastTaskDialog = false">Hủy</v-btn>
          <v-btn
            color="primary"
            rounded="lg"
            class="font-weight-bold"
            style="border: 1.5px solid var(--border-color);"
            :loading="isBroadcastingTasks"
            :disabled="!broadcastForm.senderAccountId || !broadcastForm.targetThreadId || broadcastForm.selectedTaskIds.length === 0"
            @click="handleBroadcastTasks"
          >
            Gửi vào nhóm ngay
          </v-btn>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  aiReportApi,
  type GeneratedReportItem,
  type ReportActionItem,
  type GroupItem,
} from '@/api/ai-report-api';

const props = defineProps<{
  report: GeneratedReportItem;
  groups: GroupItem[];
  senderOptions: Array<{ id: string; label: string; connected: boolean }>;
}>();

const emit = defineEmits<{
  (e: 'tasks-updated', tasks: ReportActionItem[]): void;
  (e: 'notify', msg: { text: string; color: string }): void;
}>();

const reportActionItems = computed<ReportActionItem[]>(() => {
  return props.report.structuredData?.actionItems || [];
});

const completedTaskCount = computed(() => {
  return reportActionItems.value.filter((t) => t.done).length;
});

const taskProgressPercent = computed(() => {
  if (reportActionItems.value.length === 0) return 0;
  return Math.round((completedTaskCount.value / reportActionItems.value.length) * 100);
});

async function handleToggleTask(task: ReportActionItem) {
  const newDone = !task.done;
  task.done = newDone;
  try {
    const res = await aiReportApi.updateReportTask(props.report.id, task.id, newDone);
    if (res.success) {
      emit('tasks-updated', res.actionItems);
    }
  } catch (err: any) {
    task.done = !newDone;
    emit('notify', {
      text: err?.response?.data?.error || 'Không thể cập nhật trạng thái nhiệm vụ',
      color: 'error',
    });
  }
}

// Broadcast Tasks Dialog state
const broadcastTaskDialog = ref(false);
const isBroadcastingTasks = ref(false);
const broadcastForm = ref({
  senderAccountId: '',
  targetThreadId: '',
  selectedTaskIds: [] as string[],
  customHeaderNote: '',
});

const reportSourceGroups = computed(() => {
  const targets = props.report.sourceTargets || [];
  if (targets.length > 0) {
    return targets.map((t) => {
      const match = props.groups.find((g) => g.threadId === t.groupThreadId);
      return {
        groupThreadId: t.groupThreadId,
        groupName: match?.groupName || `Nhóm ${t.groupThreadId}`,
      };
    });
  }
  return (props.report.groupThreadIds || []).map((id) => {
    const match = props.groups.find((g) => g.threadId === id);
    return {
      groupThreadId: id,
      groupName: match?.groupName || `Nhóm ${id}`,
    };
  });
});

function openBroadcastTaskDialog() {
  const pendingTaskIds = reportActionItems.value.filter((t) => !t.done).map((t) => t.id);
  broadcastForm.value = {
    senderAccountId: props.senderOptions[0]?.id || '',
    targetThreadId: reportSourceGroups.value[0]?.groupThreadId || '',
    selectedTaskIds: pendingTaskIds.length > 0 ? pendingTaskIds : reportActionItems.value.map((t) => t.id),
    customHeaderNote: '',
  };
  broadcastTaskDialog.value = true;
}

async function handleBroadcastTasks() {
  if (!broadcastForm.value.senderAccountId || !broadcastForm.value.targetThreadId) return;
  isBroadcastingTasks.value = true;
  const idempotencyKey = `bcast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  try {
    const res = await aiReportApi.broadcastReportTasks(
      props.report.id,
      {
        senderAccountId: broadcastForm.value.senderAccountId,
        targetThreadId: broadcastForm.value.targetThreadId,
        selectedTaskIds: broadcastForm.value.selectedTaskIds,
        customHeaderNote: broadcastForm.value.customHeaderNote || undefined,
      },
      idempotencyKey,
    );
    if (res.success) {
      emit('notify', {
        text: `Đã gửi thành công ${res.taskCount} nhiệm vụ vào nhóm Zalo!`,
        color: 'success',
      });
      broadcastTaskDialog.value = false;
    }
  } catch (err: any) {
    emit('notify', {
      text: err?.response?.data?.error || 'Lỗi khi phát sóng nhiệm vụ vào nhóm Zalo',
      color: 'error',
    });
  } finally {
    isBroadcastingTasks.value = false;
  }
}

function formatDateTime(str: string) {
  if (!str) return '';
  return new Date(str).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>
