<template>
  <div class="ai-reports-view">
    <!-- Header Banner -->
    <v-card class="mb-6 overflow-hidden chart-card" elevation="0">
      <div class="neo-banner pa-6 d-flex align-center justify-space-between flex-wrap gap-4">
        <div class="d-flex align-center gap-4">
          <div>
            <h1 class="neo-page-title mb-1" style="font-size: 1.5rem;">
              BÁO CÁO <span class="neo-title-accent">ĐIỀU HÀNH AI</span>
            </h1>
            <p class="text-caption neo-subtitle" style="color: var(--text-muted);">
              TỔNG HỢP ĐA PHƯƠNG TIỆN (CHAT, PDF, EXCEL, ẢNH) TỪ NHÓM ZALO & PHÁT HÀNH BÁO CÁO ĐA KÊNH.
            </p>
          </div>
        </div>

        <div class="d-flex align-center gap-2">
          <v-chip color="primary" variant="flat" rounded="pill" class="font-weight-bold neo-pill" style="border: 1.5px solid var(--border-color); font-size: 0.72rem;" prepend-icon="bolt.svg">
            {{ activeProviderLabel }} AI
          </v-chip>
          <v-chip color="success" variant="flat" rounded="pill" class="font-weight-bold neo-pill" style="border: 1.5px solid var(--border-color); font-size: 0.72rem;" prepend-icon="check.svg">
            MULTI-CHANNEL (ZALO + WEB + EMAIL)
          </v-chip>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <v-tabs v-model="activeTab" bg-color="surface" color="primary" grow density="comfortable">
        <v-tab value="generate">
          <v-icon start>bolt.svg</v-icon>
          Tạo báo cáo ngay
        </v-tab>
        <v-tab value="archive">
          <v-icon start>keyboard-alt.svg</v-icon>
          Lịch sử báo cáo
        </v-tab>
        <v-tab value="settings">
          <v-icon start>auto.svg</v-icon>
          Cấu hình tự động hóa
        </v-tab>
        <v-tab value="audit_rules">
          <v-icon start>mdi-target</v-icon>
          Quy tắc giám sát
        </v-tab>
        <v-tab value="knowledge">
          <v-icon start>mdi-file-document-multiple-outline</v-icon>
          Tài liệu cho AI
        </v-tab>
      </v-tabs>
    </v-card>

    <!-- ── TAB 1: ON-DEMAND GENERATION ──────────────────────────────────────── -->
    <div v-show="activeTab === 'generate'">
      <AiReportGenerateTab
        v-model:current-report="currentReport"
        :groups="groups"
        :sender-accounts="senderAccounts"
        :sender-options="senderOptions"
        :can-manage-knowledge="canManageKnowledge"
        @report-generated="onReportGenerated"
        @open-resend="onOpenResend"
        @open-feedback="openFeedbackDialog"
        @notify="showSnackbar($event.text, $event.color)"
      />
    </div>

    <!-- ── TAB 2: REPORT ARCHIVE ────────────────────────────────────────────── -->
    <div v-show="activeTab === 'archive'">
      <AiReportArchiveTab
        ref="archiveTabRef"
        :sender-options="senderOptions"
        :can-manage-knowledge="canManageKnowledge"
        @view-report="onViewReport"
        @feedback-report="openFeedbackDialog"
        @notify="showSnackbar($event.text, $event.color)"
      />
    </div>

    <!-- ── TAB 3: AUTOMATION & SETTINGS ────────────────────────────────────── -->
    <div v-if="activeTab === 'settings'">
      <AiReportSettingsTab
        :groups="groups"
        :sender-options="senderOptions"
        @settings-saved="loadSettings"
        @group-updated="onGroupUpdated"
        @notify="showSnackbar($event.text, $event.color)"
      />
    </div>

    <!-- ── TAB 4: AUDIT RULES MANAGER ────────────────────────────────────── -->
    <div v-if="activeTab === 'audit_rules'">
      <AiAuditRulesCard
        :groups="groups"
        :accounts="senderAccounts"
        @navigate-archive="activeTab = 'archive'"
      />
    </div>

    <!-- ── TAB 5: AI KNOWLEDGE BASE ──────────────────────────────────────── -->
    <div v-if="activeTab === 'knowledge'">
      <AiKnowledgeBaseTab
        :groups="groups"
        :can-manage="canManageKnowledge"
      />
    </div>

    <!-- ── DIALOG: AI REPORT FEEDBACK & LEARNING ─────────────────────────── -->
    <AiReportFeedbackDialog
      v-model="showFeedbackDialog"
      :report="feedbackTargetReport"
      :groups="groups"
      :available-branches="availableBranches"
      @feedback-submitted="onFeedbackSubmitted"
    />

    <!-- Snackbar Notification -->
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="3000">
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import AiReportGenerateTab from '@/components/ai-reports/AiReportGenerateTab.vue';
import AiReportArchiveTab from '@/components/ai-reports/AiReportArchiveTab.vue';
import AiReportSettingsTab from '@/components/ai-reports/AiReportSettingsTab.vue';
import AiAuditRulesCard from '@/components/ai-reports/AiAuditRulesCard.vue';
import AiKnowledgeBaseTab from '@/components/ai-reports/AiKnowledgeBaseTab.vue';
import AiReportFeedbackDialog from '@/components/ai-reports/AiReportFeedbackDialog.vue';
import { useAuthStore } from '@/stores/auth';
import { aiKnowledgeApi, type SubmitReportFeedbackResponse } from '@/api/ai-knowledge-api';
import { groupPairKey, createDefaultAiProviderSettings } from '@/api/ai-report-view-helpers';
import {
  aiReportApi,
  type GroupItem,
  type GeneratedReportItem,
  type AiProviderSettings,
} from '@/api/ai-report-api';

const authStore = useAuthStore();
const canManageKnowledge = computed(() => authStore.isAdmin);

const activeTab = ref('generate');
const archiveTabRef = ref<InstanceType<typeof AiReportArchiveTab> | null>(null);

const availableBranches = ref<string[]>([]);
const showFeedbackDialog = ref(false);
const feedbackTargetReport = ref<GeneratedReportItem | null>(null);

const groups = ref<GroupItem[]>([]);
const senderAccounts = ref<Awaited<ReturnType<typeof aiReportApi.getSenderAccounts>>>([]);
const currentReport = ref<GeneratedReportItem | null>(null);
const aiProviderSettings = ref<AiProviderSettings>(createDefaultAiProviderSettings());

const senderOptions = computed(() =>
  senderAccounts.value.map((account) => ({
    id: account.id,
    label: `${account.displayName || 'Tài khoản Zalo'} (${account.zaloUid || account.id}) — ${
      account.status === 'connected' ? 'Đã kết nối' : 'Chưa kết nối'
    }`,
    connected: account.status === 'connected',
  }))
);

const activeProviderLabel = computed(() => {
  const p = aiProviderSettings.value.primaryProvider || 'deepseek';
  return p.toUpperCase();
});

const snackbar = ref({
  show: false,
  text: '',
  color: 'success',
});

function showSnackbar(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

function openFeedbackDialog(report: GeneratedReportItem) {
  feedbackTargetReport.value = report;
  showFeedbackDialog.value = true;
}

function onFeedbackSubmitted(_res: SubmitReportFeedbackResponse) {
  showSnackbar('Đã gửi phản hồi và cập nhật tri thức AI thành công!', 'success');
}

function onOpenResend(report: GeneratedReportItem) {
  archiveTabRef.value?.openResendDialog(report);
}

function onViewReport(report: GeneratedReportItem) {
  currentReport.value = report;
  activeTab.value = 'generate';
}

function onReportGenerated() {
  archiveTabRef.value?.loadReports();
}

function onGroupUpdated(updatedGroup: GroupItem) {
  const idx = groups.value.findIndex((g) => groupPairKey(g) === groupPairKey(updatedGroup));
  if (idx !== -1) {
    groups.value[idx] = updatedGroup;
  }
}

async function loadAvailableBranches() {
  try {
    const res = await aiKnowledgeApi.getAvailableBranches();
    availableBranches.value = res.branches;
  } catch (err) {
    console.error('[AiReportsView] Lỗi khi tải danh sách chi nhánh:', err);
  }
}

async function loadGroups() {
  try {
    const res = await aiReportApi.getGroups();
    groups.value = res.groups;
  } catch (err) {
    console.error('[AiReportsView] Load groups error:', err);
  }
}

async function loadSenderAccounts() {
  try {
    senderAccounts.value = await aiReportApi.getSenderAccounts();
  } catch (err) {
    showSnackbar('Không thể tải tài khoản gửi báo cáo', 'error');
    console.error('[AiReportsView] Load sender accounts error:', err);
  }
}

async function loadSettings() {
  try {
    const res = await aiReportApi.getSettings();
    if (res.aiProviders) {
      aiProviderSettings.value = res.aiProviders;
    }
  } catch (err) {
    console.error('[AiReportsView] Load settings error:', err);
  }
}

onMounted(() => {
  loadGroups();
  loadSenderAccounts();
  loadSettings();
  loadAvailableBranches();
});
</script>

<style scoped>
.neo-banner {
  background: var(--surface-card);
  border-bottom: 1.5px solid var(--border-color);
}
</style>
