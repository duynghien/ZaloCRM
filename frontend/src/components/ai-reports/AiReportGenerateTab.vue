<template>
  <div class="ai-report-generate-tab">
    <v-row>
      <!-- Generator Controls Panel -->
      <v-col cols="12" md="4">
        <v-card class="pa-5 mb-4" elevation="0">
          <h2 class="text-subtitle-1 font-weight-bold mb-4 d-flex align-center">
            <v-icon color="primary" class="mr-2">lines-leaning.svg</v-icon>
            Tùy Chọn Tổng Hợp
          </h2>

          <!-- Quick Presets -->
          <label class="text-caption font-weight-bold text-medium-emphasis mb-2 d-block">
            Mốc thời gian nhanh:
          </label>
          <div class="d-flex flex-wrap gap-2 mb-4">
            <v-chip
              v-for="preset in presets"
              :key="preset.label"
              size="small"
              :variant="selectedPreset === preset.label ? 'flat' : 'outlined'"
              :color="selectedPreset === preset.label ? 'primary' : undefined"
              @click="applyPreset(preset)"
            >
              {{ preset.label }}
            </v-chip>
          </div>

          <!-- Date Range Inputs -->
          <v-text-field
            v-model="generatorForm.fromDate"
            label="Từ ngày & giờ"
            type="datetime-local"
            density="compact"
            variant="outlined"
            class="mb-3"
          />
          <v-text-field
            v-model="generatorForm.toDate"
            label="Đến ngày & giờ"
            type="datetime-local"
            density="compact"
            variant="outlined"
            class="mb-4"
          />

          <!-- Group Selection -->
          <div class="d-flex align-center justify-space-between mb-2">
            <label class="text-caption font-weight-bold text-medium-emphasis">
              Nhóm Zalo theo dõi ({{ selectedGroupIds.length }}/{{ groups.length }}):
            </label>
            <div class="d-flex gap-1">
              <v-btn variant="text" size="x-small" color="primary" @click="selectAllGroups">Tất cả</v-btn>
              <v-btn variant="text" size="x-small" color="secondary" @click="deselectAllGroups">Bỏ chọn</v-btn>
            </div>
          </div>

          <v-select
            v-model="selectedGroupIds"
            :items="groupOptions"
            item-title="label"
            item-value="key"
            multiple
            chips
            closable-chips
            density="compact"
            variant="outlined"
            placeholder="Chọn nhóm Zalo cần tóm tắt"
            hint="Chọn tối đa 20 nguồn. Cùng một nhóm trên hai tài khoản là hai nguồn riêng."
            persistent-hint
            class="mb-4"
          />

          <v-divider class="my-3" />

          <!-- Dispatch Options -->
          <h3 class="text-caption font-weight-bold text-medium-emphasis mb-2">
            Kênh phát hành tức thì:
          </h3>

          <v-checkbox
            v-model="generatorForm.sendZalo"
            density="compact"
            hide-details
            color="primary"
            label="Gửi tin nhắn về Zalo cá nhân"
          />
          <div v-if="generatorForm.sendZalo" class="pl-7 mb-3">
            <v-select
              v-model="generatorForm.senderAccountId"
              :items="senderOptions"
              item-title="label"
              item-value="id"
              label="Tài khoản Zalo gửi báo cáo"
              placeholder="Chọn tài khoản gửi"
              density="compact"
              variant="outlined"
              hint="Chọn rõ tài khoản gửi; tài khoản này có thể khác nguồn tổng hợp."
              persistent-hint
              class="mb-3"
            />
            <v-alert
              v-if="generatorForm.senderAccountId && !isSenderAccountConnected(generatorForm.senderAccountId)"
              type="warning"
              density="compact"
              variant="tonal"
              class="mb-3"
            >
              Tài khoản Zalo này hiện đang mất kết nối (Chưa kết nối). Vui lòng quét lại mã QR trong mục Quản lý tài khoản Zalo trước khi gửi.
            </v-alert>
            <v-radio-group v-model="generatorForm.zaloDestinationType" density="compact" hide-details class="mb-2">
              <v-radio label="Cloud của tôi (Self-conversation)" value="self" />
              <v-radio label="Nhập Zalo UID hoặc Số điện thoại" value="uid" />
            </v-radio-group>
            <v-text-field
              v-if="generatorForm.zaloDestinationType === 'uid'"
              v-model="generatorForm.zaloTargetUid"
              placeholder="Nhập Zalo UID hoặc Số điện thoại người nhận"
              density="compact"
              variant="outlined"
              class="mt-2 mb-3"
              hint="Nhập số định danh Zalo UID hoặc Số điện thoại người nhận"
              persistent-hint
            />
            <div class="text-caption font-weight-bold text-medium-emphasis mt-3 mb-1">Hình thức gửi tin Zalo:</div>
            <v-radio-group v-model="generatorForm.zaloDeliveryMode" density="compact" hide-details>
              <v-radio value="dual_pdf" label="Tóm tắt trọng tâm + File PDF chi tiết (Khuyên dùng)" />
              <v-radio value="full_text" label="Toàn văn dạng chữ (Full Text)" />
            </v-radio-group>
          </div>

          <v-checkbox
            v-model="generatorForm.sendEmail"
            density="compact"
            hide-details
            color="primary"
            label="Gửi bản tin qua Email HTML"
          />
          <div v-if="generatorForm.sendEmail" class="pl-7 mb-3">
            <v-text-field
              v-model="generatorForm.emailRecipient"
              placeholder="Nhập địa chỉ email người nhận"
              density="compact"
              variant="outlined"
              class="mt-2"
              hide-details
            />
          </div>

          <!-- Submit Button -->
          <v-btn
            block
            color="primary"
            size="large"
            class="mt-4 font-weight-bold"
            rounded="lg"
            style="border: 1.5px solid var(--border-color);"
            elevation="0"
            :loading="isGenerating"
            :disabled="isGenerating || selectedGroupIds.length === 0 || selectedGroupIds.length > 20 || (generatorForm.sendZalo && (!generatorForm.senderAccountId || !isSenderAccountConnected(generatorForm.senderAccountId)))"
            @click="handleGenerateReport"
          >
            <v-icon start>mdi-lightning-bolt</v-icon>
            {{ isGenerating ? `Đang tổng hợp (${generatingTimer}s)...` : 'Tạo báo cáo ngay' }}
          </v-btn>
        </v-card>
      </v-col>

      <!-- Markdown Viewer Panel -->
      <v-col cols="12" md="8">
        <v-card class="pa-6 min-height-card" elevation="0">
          <!-- Empty State -->
          <div v-if="!currentReport && !isGenerating" class="d-flex flex-column align-center justify-center py-16 text-center">
            <v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-text-box-search-outline</v-icon>
            <h3 class="text-h6 font-weight-bold text-medium-emphasis mb-2">Chưa có báo cáo nào được tạo</h3>
            <p class="text-body-2 text-disabled" style="max-width: 420px;">
              Chọn khoảng thời gian và danh sách nhóm Zalo ở bảng bên trái, sau đó bấm <strong>"Tạo báo cáo ngay"</strong> để AI trích xuất và tổng hợp toàn bộ nội dung.
            </p>
          </div>

          <!-- Generating State -->
          <div v-if="isGenerating" class="d-flex flex-column align-center justify-center py-16 text-center">
            <v-progress-circular indeterminate color="primary" size="64" width="6" class="mb-6" />
            <h3 class="text-h6 font-weight-bold mb-2">AI đang đọc & phân tích các nhóm Zalo...</h3>
            <p class="text-body-2 text-medium-emphasis mb-0">
              Đang quét tin nhắn văn bản, trích xuất bảng tính Excel, tài liệu PDF và tổng hợp báo cáo điều hành chuẩn 5 phần.
            </p>
            <v-chip class="mt-4 font-weight-bold" color="primary" variant="tonal">
              Thời gian xử lý: {{ generatingTimer }}s
            </v-chip>
            <v-btn class="mt-4" variant="outlined" color="error" @click="cancelGeneratingJob">Hủy tạo báo cáo</v-btn>
          </div>

          <!-- Report Display -->
          <div v-if="currentReport && !isGenerating">
            <!-- Report Action Bar -->
            <div class="d-flex align-center justify-space-between flex-wrap gap-2 pb-4 mb-4 border-b">
              <div>
                <h2 class="text-h6 font-weight-bold mb-1">{{ currentReport.title }}</h2>
                <div class="d-flex align-center gap-2 text-caption text-medium-emphasis">
                  <span class="d-inline-flex align-center">
                    <v-icon size="14" class="mr-1">mdi-clock-outline</v-icon>
                    Tạo lúc: {{ formatDateTime(currentReport.createdAt) }}
                  </span>
                  <span>•</span>
                  <v-chip size="x-small" color="primary" variant="flat">{{ currentReport.reportType }}</v-chip>
                  <v-chip v-if="currentReport.metadata?.isFallback" size="x-small" color="warning" variant="flat" class="font-weight-bold" prepend-icon="mdi-alert">
                    Dự phòng: {{ currentReport.metadata.actualModel }}
                  </v-chip>
                  <v-chip v-if="currentReport.sentZalo" size="x-small" color="success" prepend-icon="mdi-check">Đã gửi Zalo</v-chip>
                  <v-chip v-if="currentReport.sentEmail" size="x-small" color="info" prepend-icon="mdi-check">Đã gửi Email</v-chip>
                </div>
              </div>

              <div class="d-flex align-center gap-2">
                <v-btn variant="outlined" size="small" prepend-icon="mdi-content-copy" @click="copyMarkdown">
                  Sao chép
                </v-btn>
                <v-btn variant="outlined" size="small" prepend-icon="mdi-printer" @click="printReport">
                  In / PDF
                </v-btn>
                <v-btn variant="outlined" size="small" prepend-icon="mdi-file-pdf-box" :loading="isDownloadingPdf" @click="handleDownloadPdf">
                  Tải PDF
                </v-btn>
                <v-btn color="primary" size="small" prepend-icon="mdi-send-outline" :disabled="!reportCanResend(currentReport)" @click="emit('open-resend', currentReport)">
                  Gửi lại
                </v-btn>
                <v-btn
                  v-if="canManageKnowledge"
                  color="amber-darken-3"
                  variant="flat"
                  size="small"
                  prepend-icon="mdi-lightbulb-on-outline"
                  @click="emit('open-feedback', currentReport)"
                >
                  Góp ý & Dạy AI
                </v-btn>
              </div>
            </div>

            <v-alert v-if="!reportCanResend(currentReport)" type="warning" variant="tonal" class="mb-4">
              Báo cáo cũ chưa xác minh tài khoản nguồn. Chỉ quản trị viên được xem; không thể gửi lại.
              Hãy chọn rõ nhóm và tài khoản nguồn để tạo báo cáo mới.
            </v-alert>

            <v-alert
              v-if="deliveryError"
              type="warning"
              variant="tonal"
              class="mb-4"
              closable
              @click:close="deliveryError = ''"
            >
              <div class="d-flex align-center justify-space-between flex-wrap gap-2">
                <span class="d-inline-flex align-center">
                  <v-icon size="18" color="warning" class="mr-1">mdi-alert</v-icon>
                  Báo cáo đã tạo thành công nhưng gặp sự cố khi gửi: {{ deliveryError }}
                </span>
                <v-btn
                  color="warning"
                  variant="flat"
                  size="small"
                  class="ml-3"
                  @click="emit('open-resend', currentReport)"
                >
                  Gửi lại ngay
                </v-btn>
              </div>
            </v-alert>

            <!-- Modular Action Items Card -->
            <AiReportActionItemsCard
              :report="currentReport"
              :groups="groups"
              :sender-options="senderOptions"
              @tasks-updated="onTasksUpdated"
              @notify="emit('notify', $event)"
            />

            <!-- Rendered Markdown Body -->
            <div class="markdown-body-rendered pa-2" v-html="renderedMarkdown"></div>
          </div>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import AiReportActionItemsCard from '@/components/ai-reports/AiReportActionItemsCard.vue';
import {
  aiReportApi,
  type GroupItem,
  type GeneratedReportItem,
  type ReportActionItem,
} from '@/api/ai-report-api';
import {
  groupPairKey,
  groupAccountLabel,
  reportCanResend,
} from '@/api/ai-report-view-helpers';

const props = defineProps<{
  groups: GroupItem[];
  senderAccounts: Awaited<ReturnType<typeof aiReportApi.getSenderAccounts>>;
  senderOptions: Array<{ id: string; label: string; connected: boolean }>;
  canManageKnowledge: boolean;
  currentReport: GeneratedReportItem | null;
}>();

const emit = defineEmits<{
  (e: 'update:currentReport', report: GeneratedReportItem | null): void;
  (e: 'report-generated'): void;
  (e: 'open-resend', report: GeneratedReportItem): void;
  (e: 'open-feedback', report: GeneratedReportItem): void;
  (e: 'notify', msg: { text: string; color: string }): void;
}>();

const deliveryError = ref('');
const isGenerating = ref(false);
const generatingTimer = ref(0);
const activeJobId = ref<string | null>(null);
const isDownloadingPdf = ref(false);
let timerInterval: any = null;
const pendingJobStorageKey = 'zalocrm.ai-report.pending-job';

const selectedGroupIds = ref<string[]>([]);
const groupOptions = computed(() =>
  props.groups
    .filter((group) => group.zaloAccount)
    .map((group) => ({
      key: groupPairKey(group),
      label: `${group.groupName} — ${groupAccountLabel(group)}`,
    }))
);

watch(
  () => props.groups,
  (newGroups) => {
    if (selectedGroupIds.value.length === 0 && newGroups.length > 0) {
      selectedGroupIds.value = newGroups
        .filter((g) => g.isEnabled && g.zaloAccount)
        .map(groupPairKey);
    }
  },
  { immediate: true }
);

function isSenderAccountConnected(accountId?: string | null): boolean {
  if (!accountId) return false;
  const acc = props.senderAccounts.find((a) => a.id === accountId);
  return acc?.status === 'connected';
}

function formatDeliveryError(rawError?: string | null): string {
  if (!rawError) return '';
  if (rawError.includes('report_sender_unavailable') || rawError.includes('Sender unavailable') || rawError.includes('mất kết nối')) {
    return 'Tài khoản Zalo gửi báo cáo đang mất kết nối hoặc phiên đăng nhập đã hết hạn. Vui lòng vào Quản lý tài khoản Zalo để quét lại mã QR.';
  }
  if (rawError.includes('Không thể xác định Cloud của tôi') || rawError.includes('send2me_id')) {
    return 'Không thể xác định Cloud của tôi (send2me_id). Vui lòng kết nối lại tài khoản Zalo để làm mới phiên làm việc.';
  }
  return rawError;
}

const generatorForm = ref({
  fromDate: '',
  toDate: '',
  sendZalo: true,
  senderAccountId: '',
  zaloDestinationType: 'self' as 'self' | 'uid',
  zaloTargetUid: '',
  zaloDeliveryMode: 'dual_pdf' as 'dual_pdf' | 'full_text',
  sendEmail: false,
  emailRecipient: '',
});

// Presets
const selectedPreset = ref('Hôm nay');
const presets = [
  { label: 'Hôm nay', days: 0 },
  { label: 'Hôm qua', days: 1 },
  { label: '7 ngày qua', days: 7 },
  { label: 'Tuần này', days: 'this_week' },
];

function applyPreset(preset: any) {
  selectedPreset.value = preset.label;
  const now = new Date();

  if (preset.days === 0) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    generatorForm.value.fromDate = formatToLocalDatetimeInput(start);
    generatorForm.value.toDate = formatToLocalDatetimeInput(now);
  } else if (preset.days === 1) {
    const start = new Date(now);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setDate(end.getDate() - 1);
    end.setHours(23, 59, 59, 999);
    generatorForm.value.fromDate = formatToLocalDatetimeInput(start);
    generatorForm.value.toDate = formatToLocalDatetimeInput(end);
  } else if (preset.days === 7) {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    generatorForm.value.fromDate = formatToLocalDatetimeInput(start);
    generatorForm.value.toDate = formatToLocalDatetimeInput(now);
  } else if (preset.days === 'this_week') {
    const start = new Date(now);
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1);
    start.setDate(diff);
    start.setHours(0, 0, 0, 0);
    generatorForm.value.fromDate = formatToLocalDatetimeInput(start);
    generatorForm.value.toDate = formatToLocalDatetimeInput(now);
  }
}

function formatToLocalDatetimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function selectAllGroups() {
  selectedGroupIds.value = props.groups.filter((g) => g.zaloAccount).map(groupPairKey);
}

function deselectAllGroups() {
  selectedGroupIds.value = [];
}

// Rendered Markdown setup
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const renderedMarkdown = computed(() => {
  if (!props.currentReport?.summaryContent) return '';
  const parsed = marked.parse(props.currentReport.summaryContent);
  return DOMPurify.sanitize(typeof parsed === 'string' ? parsed : '', {
    FORBID_TAGS: ['style', 'form', 'input'],
  });
});

async function handleGenerateReport() {
  if (isGenerating.value) return;
  const chosen = props.groups.filter((group) => selectedGroupIds.value.includes(groupPairKey(group)));
  if (!chosen.length || chosen.length > 20 || chosen.length !== selectedGroupIds.value.length || chosen.some((g) => !g.zaloAccount)) {
    emit('notify', { text: 'Chọn từ 1 đến 20 nhóm cùng tài khoản nguồn hợp lệ', color: 'warning' });
    return;
  }
  if (generatorForm.value.sendZalo && !generatorForm.value.senderAccountId) {
    emit('notify', { text: 'Vui lòng chọn tài khoản Zalo gửi báo cáo', color: 'warning' });
    return;
  }
  if (generatorForm.value.sendZalo && !isSenderAccountConnected(generatorForm.value.senderAccountId)) {
    emit('notify', {
      text: 'Tài khoản Zalo gửi báo cáo đang mất kết nối. Vui lòng kết nối lại tài khoản trước khi tạo báo cáo.',
      color: 'warning',
    });
    return;
  }
  if (!generatorForm.value.fromDate || !generatorForm.value.toDate) {
    emit('notify', { text: 'Vui lòng chọn đầy đủ thời gian bắt đầu và kết thúc', color: 'warning' });
    return;
  }

  isGenerating.value = true;
  deliveryError.value = '';
  generatingTimer.value = 0;
  timerInterval = setInterval(() => {
    generatingTimer.value++;
  }, 1000);

  try {
    const res = await aiReportApi.generateReport(
      {
        from_date: new Date(generatorForm.value.fromDate).toISOString(),
        to_date: new Date(generatorForm.value.toDate).toISOString(),
        group_targets: chosen.map((group) => ({
          zalo_account_id: group.zaloAccount!.id,
          group_thread_id: group.threadId,
        })),
        zalo_account_id: generatorForm.value.sendZalo ? generatorForm.value.senderAccountId : undefined,
        send_zalo: generatorForm.value.sendZalo,
        send_email: generatorForm.value.sendEmail,
        zalo_destination_type: generatorForm.value.zaloDestinationType,
        zalo_target_uid:
          generatorForm.value.sendZalo && generatorForm.value.zaloDestinationType === 'uid'
            ? generatorForm.value.zaloTargetUid.trim() || undefined
            : undefined,
        zalo_delivery_mode: generatorForm.value.zaloDeliveryMode,
        email_recipients: generatorForm.value.emailRecipient ? [generatorForm.value.emailRecipient] : undefined,
      },
      crypto.randomUUID()
    );
    activeJobId.value = res.jobId;
    sessionStorage.setItem(pendingJobStorageKey, res.jobId);
    await waitForReportJob(res.jobId);
  } catch (err: any) {
    emit('notify', {
      text: err?.response?.data?.error || 'Lỗi trong quá trình tạo báo cáo AI',
      color: 'error',
    });
  } finally {
    isGenerating.value = false;
    activeJobId.value = null;
    if (timerInterval) clearInterval(timerInterval);
  }
}

async function waitForReportJob(jobId: string) {
  let delayMs = 1_000;
  while (activeJobId.value === jobId) {
    const { job } = await aiReportApi.getJob(jobId);
    if (job.status === 'succeeded' && job.resultReportId) {
      const { report } = await aiReportApi.getReport(job.resultReportId);
      emit('update:currentReport', report);
      sessionStorage.removeItem(pendingJobStorageKey);
      emit('notify', { text: 'Đã tạo báo cáo AI thành công!', color: 'success' });
      emit('report-generated');
      return;
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      sessionStorage.removeItem(pendingJobStorageKey);
      if (job.resultReportId) {
        try {
          const { report } = await aiReportApi.getReport(job.resultReportId);
          emit('update:currentReport', report);
          emit('report-generated');
        } catch (getReportErr) {
          console.error('[AiReportGenerateTab] Get generated report after delivery failure:', getReportErr);
        }
      }
      const rawError =
        job.errorMessage ||
        (job.status === 'cancelled'
          ? 'Đã hủy tạo báo cáo. Phần đã gửi trước khi hủy không thể thu hồi.'
          : 'Tạo báo cáo thất bại');
      deliveryError.value = formatDeliveryError(rawError);
      emit('notify', {
        text: job.resultReportId
          ? 'Báo cáo đã tổng hợp thành công nhưng chưa thể gửi qua kênh phát hành. Bạn có thể xem nội dung và bấm Gửi lại.'
          : deliveryError.value,
        color: job.resultReportId ? 'warning' : 'error',
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs * 2, 8_000);
  }
}

async function cancelGeneratingJob() {
  if (!activeJobId.value) return;
  try {
    await aiReportApi.cancelJob(activeJobId.value);
  } catch (err: any) {
    emit('notify', { text: err?.response?.data?.error || 'Không thể hủy báo cáo', color: 'error' });
  }
}

function copyMarkdown() {
  if (!props.currentReport?.summaryContent) return;
  navigator.clipboard.writeText(props.currentReport.summaryContent);
  emit('notify', { text: 'Đã sao chép nội dung Markdown vào clipboard!', color: 'info' });
}

function printReport() {
  window.print();
}

async function handleDownloadPdf() {
  if (!props.currentReport?.id) return;
  isDownloadingPdf.value = true;
  try {
    await aiReportApi.downloadReportPdf(props.currentReport.id, `bao-cao-${props.currentReport.id.slice(0, 8)}.pdf`);
    emit('notify', { text: 'Đã tải xuống file PDF báo cáo thành công!', color: 'success' });
  } catch (err: any) {
    emit('notify', { text: err?.response?.data?.error || err?.message || 'Không thể tải file PDF', color: 'error' });
  } finally {
    isDownloadingPdf.value = false;
  }
}

function onTasksUpdated(tasks: ReportActionItem[]) {
  if (props.currentReport && props.currentReport.structuredData) {
    const updated = {
      ...props.currentReport,
      structuredData: {
        ...props.currentReport.structuredData,
        actionItems: tasks,
      },
    };
    emit('update:currentReport', updated);
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

onMounted(() => {
  applyPreset(presets[0]);
  const pendingJobId = sessionStorage.getItem(pendingJobStorageKey);
  if (pendingJobId) {
    activeJobId.value = pendingJobId;
    isGenerating.value = true;
    waitForReportJob(pendingJobId)
      .catch((err) => {
        emit('notify', { text: err?.response?.data?.error || 'Không thể kiểm tra tiến độ báo cáo', color: 'error' });
      })
      .finally(() => {
        isGenerating.value = false;
        activeJobId.value = null;
      });
  }
});

onUnmounted(() => {
  activeJobId.value = null;
  if (timerInterval) clearInterval(timerInterval);
});
</script>

<style scoped>
.min-height-card {
  min-height: 560px;
}

.markdown-body-rendered :deep(blockquote) {
  border-left: 3px solid #0068FF;
  background: var(--surface-variant);
  padding: 0.5rem 1rem;
  margin: 1rem 0;
  border-radius: 2px;
}

.markdown-body-rendered :deep(code) {
  font-family: monospace;
  background: var(--surface-variant);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  font-size: 0.9em;
}

.markdown-body-rendered :deep(pre) {
  background: var(--surface-variant);
  border: 1.5px solid var(--border-color);
  padding: 1rem;
  border-radius: var(--radius-btn, 8px);
  overflow-x: auto;
  margin: 1rem 0;
}

.markdown-body-rendered :deep(h1) {
  font-size: 1.5rem;
  font-weight: 700;
  margin-top: 1.5rem;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid rgba(var(--v-theme-primary), 0.2);
}

.markdown-body-rendered :deep(h2) {
  font-size: 1.25rem;
  font-weight: 600;
  margin-top: 1.25rem;
  margin-bottom: 0.5rem;
  border-left: 4px solid rgb(var(--v-theme-primary));
  padding-left: 0.75rem;
}

.markdown-body-rendered :deep(h3) {
  font-size: 1.05rem;
  font-weight: 600;
  margin-top: 1rem;
  margin-bottom: 0.4rem;
}

.markdown-body-rendered :deep(ul),
.markdown-body-rendered :deep(ol) {
  padding-left: 1.5rem;
  margin-bottom: 1rem;
}

.markdown-body-rendered :deep(li) {
  margin-bottom: 0.35rem;
  line-height: 1.6;
}

.markdown-body-rendered :deep(p) {
  margin-bottom: 0.85rem;
  line-height: 1.6;
}

.markdown-body-rendered :deep(hr) {
  border: 0;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  margin: 1.5rem 0;
}

.markdown-body-rendered :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
}

.markdown-body-rendered :deep(th),
.markdown-body-rendered :deep(td) {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding: 8px 12px;
  text-align: left;
}

.markdown-body-rendered :deep(th) {
  background: rgba(var(--v-theme-surface-variant), 0.5);
  font-weight: 600;
}

@media print {
  body * {
    visibility: hidden;
  }
  .markdown-body-rendered,
  .markdown-body-rendered * {
    visibility: visible;
  }
  .markdown-body-rendered {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
  }
}
</style>
