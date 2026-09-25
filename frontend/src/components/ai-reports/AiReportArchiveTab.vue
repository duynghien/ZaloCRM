<template>
  <div class="ai-report-archive-tab">
    <v-card class="pa-5" elevation="0">
      <div class="d-flex align-center justify-space-between flex-wrap gap-4 mb-4">
        <div class="d-flex align-center gap-2">
          <v-chip
            v-for="filter in typeFilters"
            :key="filter.value"
            :variant="archiveTypeFilter === filter.value ? 'flat' : 'outlined'"
            :color="archiveTypeFilter === filter.value ? 'primary' : undefined"
            @click="setArchiveFilter(filter.value)"
          >
            {{ filter.label }}
          </v-chip>
        </div>

        <v-btn variant="text" prepend-icon="mdi-refresh" @click="loadReports">
          Làm mới
        </v-btn>
      </div>

      <v-table hover class="rounded-lg">
        <thead>
          <tr>
            <th class="font-weight-bold">Thời gian tạo</th>
            <th class="font-weight-bold">Tiêu đề báo cáo</th>
            <th class="font-weight-bold">Loại</th>
            <th class="font-weight-bold">Khoảng thời gian</th>
            <th class="font-weight-bold">Kênh gửi</th>
            <th class="font-weight-bold text-right">Hành động</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rep in reports" :key="rep.id">
            <td class="text-caption">{{ formatDateTime(rep.createdAt) }}</td>
            <td class="font-weight-medium">
              {{ rep.title }}
              <v-chip v-if="!reportCanResend(rep)" size="small" color="warning" class="ml-2">
                Nguồn chưa xác minh
              </v-chip>
              <v-chip
                v-if="rep.metadata?.isFallback"
                size="x-small"
                color="warning"
                variant="flat"
                class="ml-2 font-weight-bold"
                prepend-icon="mdi-alert"
              >
                Dự phòng: {{ rep.metadata.actualModel || 'Fallback' }}
              </v-chip>
            </td>
            <td>
              <v-chip size="small" :color="getReportTypeColor(rep.reportType)">
                {{ rep.reportType }}
              </v-chip>
            </td>
            <td class="text-caption text-medium-emphasis">
              {{ formatDate(rep.periodFrom) }} - {{ formatDate(rep.periodTo) }}
            </td>
            <td>
              <div class="d-flex gap-1">
                <v-chip size="x-small" :color="rep.sentZalo ? 'success' : 'default'">
                  Zalo: {{ rep.sentZalo ? 'Đã gửi' : 'Chưa' }}
                </v-chip>
                <v-chip size="x-small" :color="rep.sentEmail ? 'info' : 'default'">
                  Email: {{ rep.sentEmail ? 'Đã gửi' : 'Chưa' }}
                </v-chip>
              </div>
            </td>
            <td class="text-right">
              <v-btn
                icon="mdi-eye-outline"
                size="small"
                variant="text"
                color="primary"
                aria-label="Xem chi tiết"
                @click="emit('view-report', rep)"
              />
              <v-btn
                icon="mdi-file-pdf-box"
                size="small"
                variant="text"
                color="primary"
                aria-label="Tải PDF"
                :loading="Boolean(downloadingPdfIds[rep.id])"
                @click="handleDownloadPdf(rep.id)"
              />
              <v-btn
                icon="mdi-send-outline"
                size="small"
                variant="text"
                color="secondary"
                :disabled="!reportCanResend(rep)"
                aria-label="Gửi lại báo cáo"
                @click="openResendDialog(rep)"
              />
              <v-btn
                v-if="canManageKnowledge"
                icon="mdi-lightbulb-on-outline"
                size="small"
                variant="text"
                color="amber-darken-3"
                aria-label="Góp ý & Dạy AI"
                @click="emit('feedback-report', rep)"
              />
            </td>
          </tr>
          <tr v-if="reports.length === 0">
            <td colspan="6" class="text-center py-8 text-medium-emphasis">
              Chưa có báo cáo nào được lưu trữ.
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <!-- Dialog: Resend Report -->
    <v-dialog v-model="resendDialog" max-width="500">
      <v-card v-if="selectedReportForResend" class="pa-5 chart-card" elevation="0">
        <h3 class="text-h6 font-weight-bold mb-3">Gửi Lại Báo Cáo</h3>
        <p class="text-body-2 mb-4 font-weight-medium">{{ selectedReportForResend.title }}</p>

        <v-alert
          v-if="resendRequiresReconciliation"
          type="warning"
          variant="tonal"
          class="mb-4"
        >
          Lượt gửi trước đó có thể đã gửi một phần hoặc chưa xác nhận kết quả.
          Bấm "Gửi lại ngay" để thử lại với cùng thông tin, hoặc "Tạo lượt gửi mới" nếu bạn đã xác minh người nhận.
        </v-alert>

        <v-checkbox
          v-model="resendForm.sendZalo"
          label="Gửi qua Zalo"
          density="compact"
          color="primary"
          hide-details
          class="mb-2"
        />

        <div v-if="resendForm.sendZalo" class="pl-7 mb-3">
          <v-select
            v-model="resendForm.senderAccountId"
            :items="senderOptions"
            item-title="label"
            item-value="id"
            label="Tài khoản Zalo gửi"
            density="compact"
            variant="outlined"
            class="mb-3"
          />

          <v-radio-group v-model="resendForm.zaloDestinationType" density="compact">
            <v-radio label="Cloud của tôi (Self-conversation)" value="self" />
            <v-radio label="Zalo UID / Số điện thoại" value="uid" />
          </v-radio-group>

          <v-text-field
            v-if="resendForm.zaloDestinationType === 'uid'"
            v-model="resendForm.zaloTargetUid"
            label="Zalo UID / Số điện thoại nhận"
            density="compact"
            variant="outlined"
            class="mb-3"
          />

          <v-radio-group v-model="resendForm.zaloDeliveryMode" density="compact" inline>
            <v-radio label="Tóm tắt + PDF" value="dual_pdf" />
            <v-radio label="Toàn văn tin nhắn" value="full_text" />
          </v-radio-group>
        </div>

        <v-checkbox
          v-model="resendForm.sendEmail"
          label="Gửi qua Email"
          density="compact"
          color="primary"
          hide-details
          class="mb-2"
        />

        <div v-if="resendForm.sendEmail" class="pl-7 mb-3">
          <v-text-field
            v-model="resendForm.emailRecipient"
            label="Email nhận báo cáo"
            placeholder="example@company.com"
            density="compact"
            variant="outlined"
          />
        </div>

        <div class="d-flex justify-end gap-2 mt-4">
          <v-btn variant="text" rounded="lg" @click="resendDialog = false">Hủy</v-btn>
          <v-btn
            v-if="resendRequiresReconciliation"
            variant="outlined"
            color="warning"
            rounded="lg"
            @click="prepareReconciledResend"
          >
            Tạo lượt gửi mới
          </v-btn>
          <v-btn
            color="primary"
            rounded="lg"
            class="font-weight-bold"
            style="border: 1.5px solid var(--border-color);"
            :loading="isResending"
            @click="handleResendSubmit"
          >
            Gửi lại ngay
          </v-btn>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  aiReportApi,
  type GeneratedReportItem,
  type ResendReportPayload,
} from '@/api/ai-report-api';
import {
  reportCanResend,
  resendAttemptKey,
  completeResendAttempt,
  resendNeedsReconciliation,
  markResendAttemptUncertain,
  reconcileResendAttempt,
} from '@/api/ai-report-view-helpers';

const props = defineProps<{
  senderOptions: Array<{ id: string; label: string; connected: boolean }>;
  canManageKnowledge: boolean;
}>();

const emit = defineEmits<{
  (e: 'view-report', report: GeneratedReportItem): void;
  (e: 'feedback-report', report: GeneratedReportItem): void;
  (e: 'notify', msg: { text: string; color: string }): void;
}>();

const reports = ref<GeneratedReportItem[]>([]);
const archiveTypeFilter = ref<string>('all');
const downloadingPdfIds = ref<Record<string, boolean>>({});

const typeFilters = [
  { label: 'Tất cả', value: 'all' },
  { label: 'Hàng ngày', value: 'daily' },
  { label: 'Hàng tuần', value: 'weekly' },
  { label: 'Tùy chỉnh', value: 'custom' },
];

function setArchiveFilter(val: string) {
  archiveTypeFilter.value = val;
  loadReports();
}

function getReportTypeColor(type: string) {
  if (type === 'daily') return 'primary';
  if (type === 'weekly') return 'purple';
  return 'teal';
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

function formatDate(str: string) {
  if (!str) return '';
  return new Date(str).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
  });
}

async function loadReports() {
  try {
    const typeParam = archiveTypeFilter.value === 'all' ? undefined : archiveTypeFilter.value;
    const res = await aiReportApi.getReports({ report_type: typeParam });
    reports.value = res.reports;
  } catch (err) {
    console.error('[AiReportArchiveTab] Load reports error:', err);
    emit('notify', { text: 'Không thể tải danh sách báo cáo', color: 'error' });
  }
}

async function handleDownloadPdf(id: string) {
  if (!id) return;
  downloadingPdfIds.value[id] = true;
  try {
    await aiReportApi.downloadReportPdf(id, `bao-cao-${id.slice(0, 8)}.pdf`);
    emit('notify', { text: 'Đã tải xuống file PDF báo cáo thành công!', color: 'success' });
  } catch (err: any) {
    emit('notify', { text: err?.response?.data?.error || err?.message || 'Không thể tải file PDF', color: 'error' });
  } finally {
    downloadingPdfIds.value[id] = false;
  }
}

// Resend Dialog State
const resendDialog = ref(false);
const selectedReportForResend = ref<GeneratedReportItem | null>(null);
const isResending = ref(false);
const resendRequiresReconciliation = ref(false);
const resendForm = ref({
  sendZalo: true,
  senderAccountId: '',
  zaloDestinationType: 'self' as 'self' | 'uid',
  zaloTargetUid: '',
  zaloDeliveryMode: 'dual_pdf' as 'dual_pdf' | 'full_text',
  sendEmail: false,
  emailRecipient: '',
});

function openResendDialog(rep: GeneratedReportItem) {
  if (!reportCanResend(rep)) {
    emit('notify', { text: 'Không thể gửi lại báo cáo có nguồn chưa xác minh', color: 'warning' });
    return;
  }
  selectedReportForResend.value = rep;
  resendRequiresReconciliation.value = resendNeedsReconciliation(rep.id);
  resendForm.value.sendZalo = rep.sentZalo;
  resendForm.value.sendEmail = rep.sentEmail;
  resendForm.value.zaloDeliveryMode = 'dual_pdf';
  resendDialog.value = true;
}

function prepareReconciledResend() {
  const report = selectedReportForResend.value;
  if (!report || isResending.value || !reconcileResendAttempt(report.id)) return;
  resendRequiresReconciliation.value = false;
  emit('notify', { text: 'Đã chuẩn bị lượt gửi mới. Kiểm tra lựa chọn rồi bấm Gửi ngay.', color: 'info' });
}

async function handleResendSubmit() {
  const report = selectedReportForResend.value;
  if (!report || !reportCanResend(report) || isResending.value) return;
  if (resendForm.value.sendZalo && !resendForm.value.senderAccountId) {
    emit('notify', { text: 'Vui lòng chọn tài khoản Zalo gửi báo cáo', color: 'warning' });
    return;
  }
  isResending.value = true;
  try {
    const payload: ResendReportPayload = {
      send_zalo: resendForm.value.sendZalo,
      zalo_account_id: resendForm.value.sendZalo ? resendForm.value.senderAccountId : undefined,
      send_email: resendForm.value.sendEmail,
      zalo_destination_type: resendForm.value.zaloDestinationType,
      zalo_target_uid: resendForm.value.sendZalo && resendForm.value.zaloDestinationType === 'uid'
        ? resendForm.value.zaloTargetUid.trim() || undefined : undefined,
      zalo_delivery_mode: resendForm.value.zaloDeliveryMode,
      email_recipients: resendForm.value.emailRecipient ? [resendForm.value.emailRecipient] : undefined,
    };
    const key = await resendAttemptKey(report.id, payload);
    markResendAttemptUncertain(report.id);
    const result = await aiReportApi.resendReport(report.id, payload, key);
    if (!result.success || result.zalo?.deliveryUncertain || result.zalo?.success === false || result.email?.success === false) {
      emit('notify', { text: 'Gửi lại báo cáo chưa hoàn tất hoặc thất bại một phần.', color: 'warning' });
      return;
    }
    completeResendAttempt(report.id);
    resendRequiresReconciliation.value = false;
    resendDialog.value = false;
    emit('notify', { text: 'Đã gửi lại báo cáo thành công!', color: 'success' });
    loadReports();
  } catch (err: any) {
    emit('notify', { text: err?.response?.data?.error || 'Lỗi khi gửi lại báo cáo', color: 'error' });
  } finally {
    resendRequiresReconciliation.value = resendNeedsReconciliation(report.id);
    isResending.value = false;
  }
}

defineExpose({
  loadReports,
  handleDownloadPdf,
  openResendDialog,
});

onMounted(() => {
  loadReports();
});
</script>
