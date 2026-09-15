<template>
  <v-card class="pa-5 mb-4 chart-card neo-card" elevation="0">
    <div class="d-flex align-center justify-space-between flex-wrap gap-3 mb-4">
      <div>
        <h2 class="text-subtitle-1 font-weight-bold d-flex align-center">
          <v-icon color="primary" class="mr-2">mdi-target</v-icon>
          Quy Tắc Đánh Giá & Thẩm Định Nhóm Định Kỳ (AI Audit Rules)
        </h2>
        <p class="text-caption text-medium-emphasis mb-0">
          Tự động quét tin nhắn và ảnh trong nhóm Zalo theo lịch hẹn, thẩm định đối chiếu nhân sự và điều phối báo cáo đa kênh.
        </p>
      </div>
      <v-btn color="primary" prepend-icon="mdi-plus" class="font-weight-bold neo-btn" @click="openCreateDialog">
        Tạo Quy Tắc Mới
      </v-btn>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="d-flex justify-center py-8">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <!-- Empty state -->
    <div v-else-if="rules.length === 0" class="text-center py-8 border rounded border-dashed">
      <v-icon size="48" color="medium-emphasis" class="mb-2">mdi-clipboard-text-clock-outline</v-icon>
      <div class="font-weight-bold mb-1">Chưa có quy tắc giám sát nào</div>
      <div class="text-caption text-medium-emphasis mb-4">
        Hãy tạo quy tắc đầu tiên để hệ thống tự động kiểm tra và nhắc nhở nhân sự trong nhóm Zalo của bạn.
      </div>
      <v-btn color="primary" size="small" prepend-icon="mdi-plus" @click="openCreateDialog">
        Tạo Quy Tắc Ngay
      </v-btn>
    </div>

    <!-- Rules Table -->
    <v-table v-else class="neo-table" density="comfortable">
      <thead>
        <tr>
          <th>Tên Quy Tắc</th>
          <th>Nhóm Nguồn</th>
          <th>Đích Nhận Báo Cáo</th>
          <th>Lịch Chạy</th>
          <th>Lần Chạy Cuối</th>
          <th class="text-center">Bật/Tắt</th>
          <th class="text-right">Thao Tác</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="rule in rules" :key="rule.id">
          <td class="font-weight-bold">
            <div class="d-flex align-center gap-2">
              <span>{{ rule.name }}</span>
            </div>
            <div class="text-caption text-medium-emphasis">
              Mẫu: {{ formatTemplateType(rule.templateType) }}
            </div>
          </td>
          <td>
            <div class="font-weight-medium">{{ rule.groupName || rule.groupThreadId }}</div>
            <div class="text-caption text-medium-emphasis">
              {{ rule.personnelType === 'all_group_members' ? 'Toàn bộ thành viên' : `${rule.personnelList?.length || 0} nhân sự` }}
            </div>
          </td>
          <td>
            <div class="font-weight-medium">
              {{ formatDestination(rule) }}
            </div>
            <v-chip v-if="rule.sendOperationalReminder" size="x-small" color="warning" variant="flat" class="mt-1 font-weight-bold">
              🔔 Nhắc nhóm nguồn
            </v-chip>
          </td>
          <td>
            <div class="font-weight-bold text-primary">{{ rule.runTime }}</div>
            <div class="text-caption text-medium-emphasis">
              {{ formatDays(rule.daysOfWeek) }}
            </div>
          </td>
          <td>
            <div v-if="!rule.lastRunAt" class="text-caption text-medium-emphasis">Chưa chạy</div>
            <div v-else>
              <div class="d-flex align-center gap-1">
                <v-chip
                  size="x-small"
                  :color="rule.lastRunStatus === 'success' ? 'success' : rule.lastRunStatus === 'dispatch_failed' ? 'warning' : 'error'"
                  variant="flat"
                  class="font-weight-bold"
                >
                  {{ rule.lastRunStatus === 'success' ? 'Thành công' : rule.lastRunStatus === 'dispatch_failed' ? 'Lỗi gửi tin' : 'Thất bại' }}
                </v-chip>
                <v-btn
                  v-if="rule.lastRunReportId"
                  icon="mdi-history"
                  size="x-small"
                  variant="text"
                  title="Xem báo cáo trong Lịch Sử"
                  @click="$emit('navigate-archive')"
                />
              </div>
              <div class="text-caption text-medium-emphasis mt-1">
                {{ formatDateTime(rule.lastRunAt) }}
              </div>
              <div v-if="rule.lastError" class="text-caption text-error text-truncate" style="max-width: 140px;" :title="rule.lastError">
                {{ rule.lastError }}
              </div>
            </div>
          </td>
          <td class="text-center">
            <v-switch
              :model-value="rule.isEnabled"
              color="success"
              density="compact"
              hide-details
              class="d-inline-flex"
              @update:model-value="toggleRule(rule, $event)"
            />
          </td>
          <td class="text-right">
            <div class="d-flex align-center justify-end gap-1">
              <v-btn
                size="small"
                variant="outlined"
                color="primary"
                prepend-icon="mdi-play"
                :loading="runningRuleId === rule.id"
                @click="runNow(rule)"
              >
                Chạy Thử
              </v-btn>
              <v-btn icon="mdi-pencil" size="small" variant="text" @click="openEditDialog(rule)" />
              <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="confirmDelete(rule)" />
            </div>
          </td>
        </tr>
      </tbody>
    </v-table>

    <!-- Dialog for Create / Edit -->
    <AiAuditRuleDialog
      v-model="showDialog"
      :rule="selectedRule"
      :groups="groups"
      :accounts="accounts"
      @saved="onRuleSaved"
    />

    <!-- Run Now Result Modal -->
    <v-dialog v-model="showRunNowModal" max-width="850px">
      <v-card class="pa-5 neo-card" elevation="0">
        <v-card-title class="pa-0 mb-3 d-flex align-center justify-space-between font-weight-bold">
          <div class="d-flex align-center gap-2">
            <v-icon color="success">mdi-check-circle-outline</v-icon>
            <span>Kết Quả Đánh Giá Ngay (Run Now)</span>
          </div>
          <v-btn icon="mdi-close" variant="text" density="compact" @click="showRunNowModal = false" />
        </v-card-title>

        <v-card-text class="pa-0">
          <v-alert
            v-if="runNowResult?.lastRunStatus === 'dispatch_failed'"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-3"
          >
            <strong>Cảnh báo gửi tin:</strong> Báo cáo thẩm định đã hoàn thành và lưu vào cơ sở dữ liệu, nhưng gặp sự cố khi gửi tin nhắn Zalo: {{ runNowResult.error }}. Bạn có thể vào Tab Lịch Sử để Resend sau khi kiểm tra lại quyền nhóm.
          </v-alert>

          <v-tabs v-model="resultTab" density="compact" color="primary" class="mb-3">
            <v-tab value="supervisory">📋 Báo Cáo Giám Sát</v-tab>
            <v-tab v-if="runNowResult?.operationalReminderMessage" value="reminder">🔔 Tin Nhắn Nhắc Nhở Vận Hành</v-tab>
          </v-tabs>

          <div v-show="resultTab === 'supervisory'" class="pa-4 bg-surface-variant rounded markdown-body" style="max-height: 400px; overflow-y: auto; white-space: pre-wrap; font-family: monospace; font-size: 13px;">
            {{ runNowResult?.supervisoryReportMarkdown }}
          </div>

          <div v-show="resultTab === 'reminder'" class="pa-4 bg-surface-variant rounded" style="max-height: 400px; overflow-y: auto; white-space: pre-wrap; font-family: monospace; font-size: 13px;">
            {{ runNowResult?.operationalReminderMessage }}
          </div>
        </v-card-text>

        <v-card-actions class="pa-0 mt-4 d-flex justify-space-between">
          <v-btn
            v-if="runNowResult?.reportId"
            color="primary"
            variant="text"
            prepend-icon="mdi-history"
            @click="goToHistory"
          >
            Xem trong Lịch Sử Báo Cáo
          </v-btn>
          <v-spacer v-else />
          <v-btn variant="outlined" @click="showRunNowModal = false">Đóng</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  aiReportApi,
  type AiAuditRule,
  type GroupItem,
  type RunAuditRuleNowResult,
} from '../../api/ai-report-api';
import AiAuditRuleDialog from './AiAuditRuleDialog.vue';

defineProps<{
  groups: GroupItem[];
  accounts: Array<{ id: string; displayName: string | null; zaloUid: string | null }>;
}>();

const emit = defineEmits<{
  (e: 'navigate-archive'): void;
}>();

const rules = ref<AiAuditRule[]>([]);
const loading = ref(false);
const showDialog = ref(false);
const selectedRule = ref<AiAuditRule | null>(null);

const runningRuleId = ref<string | null>(null);
const showRunNowModal = ref(false);
const runNowResult = ref<RunAuditRuleNowResult | null>(null);
const resultTab = ref('supervisory');

onMounted(async () => {
  await fetchRules();
});

async function fetchRules() {
  loading.value = true;
  try {
    const res = await aiReportApi.getAuditRules();
    rules.value = res.rules;
  } catch (err: any) {
    console.error('Failed to fetch audit rules:', err);
  } finally {
    loading.value = false;
  }
}

function openCreateDialog() {
  selectedRule.value = null;
  showDialog.value = true;
}

function openEditDialog(rule: AiAuditRule) {
  selectedRule.value = rule;
  showDialog.value = true;
}

async function toggleRule(rule: AiAuditRule, enabled: boolean | null) {
  const isEnabled = !!enabled;
  rule.isEnabled = isEnabled;
  try {
    await aiReportApi.updateAuditRule(rule.id, { isEnabled });
  } catch (err: any) {
    rule.isEnabled = !isEnabled;
    alert('Không thể cập nhật trạng thái');
  }
}

async function confirmDelete(rule: AiAuditRule) {
  if (!confirm(`Bạn có chắc chắn muốn xóa quy tắc "${rule.name}"?`)) return;
  try {
    await aiReportApi.deleteAuditRule(rule.id);
    rules.value = rules.value.filter((r) => r.id !== rule.id);
  } catch (err: any) {
    alert(err?.response?.data?.error || 'Không thể xóa quy tắc');
  }
}

async function runNow(rule: AiAuditRule) {
  runningRuleId.value = rule.id;
  try {
    const result = await aiReportApi.runAuditRuleNow(rule.id);
    runNowResult.value = result;
    resultTab.value = 'supervisory';
    showRunNowModal.value = true;
    await fetchRules();
  } catch (err: any) {
    alert(err?.response?.data?.error || err?.message || 'Lỗi khi kích hoạt chạy thử');
  } finally {
    runningRuleId.value = null;
  }
}

function onRuleSaved() {
  fetchRules();
}

function goToHistory() {
  showRunNowModal.value = false;
  emit('navigate-archive');
}

function formatTemplateType(type: string): string {
  switch (type) {
    case 'schedule_submission':
      return 'Lịch làm việc';
    case 'work_progress':
      return 'Tiến độ KPI';
    case 'image_verification':
      return 'Xác thực ảnh chứng từ';
    case 'custom':
      return 'Tùy biến';
    default:
      return type;
  }
}

function formatDestination(rule: AiAuditRule): string {
  if (rule.destinationType === 'group') {
    return rule.targetGroupName || 'Nhóm Zalo Giám sát';
  }
  if (rule.destinationType === 'self') return 'Zalo cá nhân / Cloud';
  if (rule.destinationType === 'uid') return `Zalo UID (${rule.targetUid})`;
  if (rule.destinationType === 'email') return `Email (${rule.emailRecipients?.length || 0})`;
  return rule.destinationType;
}

function formatDays(days: number[]): string {
  if (days.length === 7) return 'Hàng ngày';
  if (days.length === 5 && !days.includes(6) && !days.includes(7)) return 'Ngày làm việc (T2-T6)';
  const dayNames = ['', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  return days.map((d) => dayNames[d]).join(', ');
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ${d.toLocaleDateString('vi-VN')}`;
  } catch {
    return iso;
  }
}
</script>
