<template>
  <div class="ai-reports-view">
    <!-- Header Banner -->
    <v-card class="mb-6 rounded-xl border-0 overflow-hidden" elevation="2">
      <div class="hero-banner pa-6 d-flex align-center justify-space-between flex-wrap gap-4">
        <div class="d-flex align-center gap-4">
          <div class="ai-orb-large d-flex align-center justify-center">
            <v-icon size="32" color="white">mdi-robot-excited-outline</v-icon>
          </div>
          <div>
            <h1 class="text-h5 font-weight-bold text-white mb-1">
              Báo Cáo Điều Hành AI (AI Group Digest)
            </h1>
            <p class="text-body-2 text-white opacity-80 mb-0">
              Tổng hợp đa phương tiện (Chat, PDF, Excel, Ảnh) từ nhóm Zalo & phát hành báo cáo đa kênh.
            </p>
          </div>
        </div>

        <div class="d-flex align-center gap-2">
          <v-chip color="cyan-lighten-4" class="text-cyan-darken-4 font-weight-bold" prepend-icon="mdi-flash">
            Gemini 2.0 Flash
          </v-chip>
          <v-chip color="light-green-lighten-4" class="text-green-darken-4 font-weight-bold" prepend-icon="mdi-check-decagram">
            Multi-Channel (Zalo + Web + Email)
          </v-chip>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <v-tabs v-model="activeTab" bg-color="surface" color="primary" grow density="comfortable">
        <v-tab value="generate">
          <v-icon start>mdi-lightning-bolt-outline</v-icon>
          ⚡ Tạo Báo Cáo Ngay
        </v-tab>
        <v-tab value="archive">
          <v-icon start>mdi-history</v-icon>
          📜 Lịch Sử Báo Cáo
        </v-tab>
        <v-tab value="settings">
          <v-icon start>mdi-cog-outline</v-icon>
          ⚙️ Cấu Hình Tự Động Hóa
        </v-tab>
      </v-tabs>
    </v-card>

    <!-- ── TAB 1: ON-DEMAND GENERATION ──────────────────────────────────────── -->
    <div v-show="activeTab === 'generate'">
      <v-row>
        <!-- Generator Controls Panel -->
        <v-col cols="12" md="4">
          <v-card class="pa-5 rounded-xl mb-4" elevation="1">
            <h2 class="text-subtitle-1 font-weight-bold mb-4 d-flex align-center">
              <v-icon color="primary" class="mr-2">mdi-filter-variant</v-icon>
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
              :items="groups"
              item-title="groupName"
              item-value="threadId"
              multiple
              chips
              closable-chips
              density="compact"
              variant="outlined"
              placeholder="Chọn nhóm Zalo cần tóm tắt"
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
              <v-radio-group v-model="generatorForm.zaloDestinationType" density="compact" hide-details>
                <v-radio label="Cloud của tôi (Self-conversation)" value="self" />
                <v-radio label="Nhập Zalo UID / SĐT cụ thể" value="uid" />
              </v-radio-group>
              <v-text-field
                v-if="generatorForm.zaloDestinationType === 'uid'"
                v-model="generatorForm.zaloTargetUid"
                placeholder="Nhập Zalo UID người nhận"
                density="compact"
                variant="outlined"
                class="mt-2"
                hide-details
              />
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
              rounded="xl"
              elevation="2"
              :loading="isGenerating"
              :disabled="isGenerating || selectedGroupIds.length === 0"
              @click="handleGenerateReport"
            >
              <v-icon start>mdi-lightning-bolt</v-icon>
              {{ isGenerating ? `Đang tổng hợp (${generatingTimer}s)...` : '⚡ Tạo Báo Cáo Ngay' }}
            </v-btn>
          </v-card>
        </v-col>

        <!-- Markdown Viewer Panel -->
        <v-col cols="12" md="8">
          <v-card class="pa-6 rounded-xl min-height-card" elevation="1">
            <!-- Empty State -->
            <div v-if="!currentReport && !isGenerating" class="d-flex flex-column align-center justify-center py-16 text-center">
              <v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-text-box-search-outline</v-icon>
              <h3 class="text-h6 font-weight-bold text-medium-emphasis mb-2">Chưa có báo cáo nào được tạo</h3>
              <p class="text-body-2 text-disabled" style="max-width: 420px;">
                Chọn khoảng thời gian và danh sách nhóm Zalo ở bảng bên trái, sau đó bấm <strong>"⚡ Tạo Báo Cáo Ngay"</strong> để AI trích xuất và tổng hợp toàn bộ nội dung.
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
                    <span>🕒 Tạo lúc: {{ formatDateTime(currentReport.createdAt) }}</span>
                    <span>•</span>
                    <v-chip size="x-small" color="primary" variant="flat">{{ currentReport.reportType }}</v-chip>
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
                  <v-btn color="primary" size="small" prepend-icon="mdi-send-outline" @click="openResendDialog(currentReport)">
                    Gửi lại
                  </v-btn>
                </div>
              </div>

              <!-- Rendered Markdown Body -->
              <div class="markdown-body-rendered pa-2" v-html="renderedMarkdown"></div>
            </div>
          </v-card>
        </v-col>
      </v-row>
    </div>

    <!-- ── TAB 2: REPORT ARCHIVE ────────────────────────────────────────────── -->
    <div v-show="activeTab === 'archive'">
      <v-card class="pa-5 rounded-xl" elevation="1">
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
              <td class="font-weight-medium">{{ rep.title }}</td>
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
                <v-btn icon="mdi-eye-outline" size="small" variant="text" color="primary" @click="viewReportDetail(rep)" />
                <v-btn icon="mdi-send-outline" size="small" variant="text" color="secondary" @click="openResendDialog(rep)" />
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
    </div>

    <!-- ── TAB 3: AUTOMATION & SETTINGS ────────────────────────────────────── -->
    <div v-show="activeTab === 'settings'">
      <v-row>
        <!-- Cron Schedule & Channels -->
        <v-col cols="12" md="6">
          <v-card class="pa-5 rounded-xl mb-4" elevation="1">
            <h2 class="text-subtitle-1 font-weight-bold mb-4 d-flex align-center">
              <v-icon color="primary" class="mr-2">mdi-clock-time-four-outline</v-icon>
              Lịch Tự Động Hóa (Cron Schedules)
            </h2>

            <v-switch
              v-model="automationSettings.dailyEnabled"
              color="primary"
              label="Báo cáo hàng ngày lúc 18:00 (Daily at 18:00)"
              hint="Tự động tổng hợp hoạt động trong ngày và phát hành lúc 18:00"
              persistent-hint
              class="mb-3"
            />

            <v-switch
              v-model="automationSettings.weeklyEnabled"
              color="primary"
              label="Báo cáo tổng kết tuần (Thứ 7 lúc 17:00)"
              hint="Tự động tổng hợp dữ liệu 7 ngày qua vào 17:00 chiều Thứ 7"
              persistent-hint
              class="mb-4"
            />

            <v-divider class="my-4" />

            <h2 class="text-subtitle-1 font-weight-bold mb-4 d-flex align-center">
              <v-icon color="primary" class="mr-2">mdi-cellphone-message</v-icon>
              Cấu Hình Kênh Zalo
            </h2>

            <v-switch
              v-model="automationSettings.sendZalo"
              color="primary"
              label="Tự động gửi báo cáo về Zalo"
              class="mb-2"
            />

            <div v-if="automationSettings.sendZalo" class="pl-2 mb-4">
              <v-radio-group v-model="automationSettings.zaloDestinationType" density="compact">
                <v-radio label="Cloud của tôi (Self-conversation)" value="self" />
                <v-radio label="Zalo UID / SĐT người nhận cụ thể" value="uid" />
              </v-radio-group>
              <v-text-field
                v-if="automationSettings.zaloDestinationType === 'uid'"
                v-model="automationSettings.zaloTargetUid"
                label="Zalo UID đích"
                placeholder="Nhập Zalo UID"
                density="compact"
                variant="outlined"
              />
            </div>
          </v-card>
        </v-col>

        <!-- SMTP Settings -->
        <v-col cols="12" md="6">
          <v-card class="pa-5 rounded-xl mb-4" elevation="1">
            <h2 class="text-subtitle-1 font-weight-bold mb-4 d-flex align-center">
              <v-icon color="primary" class="mr-2">mdi-email-outline</v-icon>
              Cấu Hình Email SMTP
            </h2>

            <v-switch
              v-model="automationSettings.sendEmail"
              color="primary"
              label="Tự động gửi bản tin qua Email"
              class="mb-3"
            />

            <v-row dense>
              <v-col cols="8">
                <v-text-field
                  v-model="smtpSettings.host"
                  label="SMTP Host"
                  placeholder="smtp.gmail.com"
                  density="compact"
                  variant="outlined"
                />
              </v-col>
              <v-col cols="4">
                <v-text-field
                  v-model="smtpSettings.port"
                  label="Port"
                  type="number"
                  placeholder="587"
                  density="compact"
                  variant="outlined"
                />
              </v-col>
            </v-row>

            <v-text-field
              v-model="smtpSettings.user"
              label="SMTP Username / Email"
              placeholder="your-email@gmail.com"
              density="compact"
              variant="outlined"
              class="mb-2"
            />

            <v-text-field
              v-model="smtpSettings.pass"
              label="SMTP Password / App Password"
              type="password"
              :placeholder="smtpSettings.passSet ? '(Mật khẩu đã được lưu - nhập lại nếu muốn đổi)' : 'Nhập mật khẩu SMTP'"
              density="compact"
              variant="outlined"
              class="mb-2"
            />

            <v-text-field
              v-model="smtpSettings.from"
              label="From Sender"
              placeholder='"ZaloCRM AI Digest" <no-reply@company.com>'
              density="compact"
              variant="outlined"
              class="mb-2"
            />

            <v-combobox
              v-model="automationSettings.emailRecipients"
              label="Danh sách email nhận báo cáo"
              multiple
              chips
              closable-chips
              density="compact"
              variant="outlined"
              placeholder="Nhập email và ấn Enter"
            />

            <v-btn
              color="primary"
              block
              size="large"
              rounded="xl"
              class="mt-4 font-weight-bold"
              :loading="isSavingSettings"
              @click="saveAllSettings"
            >
              <v-icon start>mdi-content-save</v-icon>
              Lưu Cấu Hình Tự Động Hóa
            </v-btn>
          </v-card>
        </v-col>

        <!-- Monitored Groups Table -->
        <v-col cols="12">
          <v-card class="pa-5 rounded-xl" elevation="1">
            <h2 class="text-subtitle-1 font-weight-bold mb-4 d-flex align-center">
              <v-icon color="primary" class="mr-2">mdi-account-group-outline</v-icon>
              Cấu Hình Trọng Tâm Từng Nhóm Zalo ({{ groups.length }} nhóm)
            </h2>

            <v-table hover>
              <thead>
                <tr>
                  <th>Tên nhóm</th>
                  <th>Trạng thái theo dõi</th>
                  <th>Ghi chú trọng tâm cho AI</th>
                  <th>Từ khóa làm nổi bật</th>
                  <th class="text-right">Hành động</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="g in groups" :key="g.threadId">
                  <td class="font-weight-medium">{{ g.groupName }}</td>
                  <td>
                    <v-switch
                      v-model="g.isEnabled"
                      color="primary"
                      density="compact"
                      hide-details
                      @update:model-value="saveGroupConfig(g)"
                    />
                  </td>
                  <td>
                    <v-text-field
                      v-model="g.customPrompt"
                      placeholder="Ví dụ: Tập trung vào báo cáo doanh số & tiến độ xử lý khách VIP"
                      density="compact"
                      variant="plain"
                      hide-details
                      @blur="saveGroupConfig(g)"
                    />
                  </td>
                  <td>
                    <span v-if="g.focusKeywords?.length">{{ g.focusKeywords.join(', ') }}</span>
                    <span v-else class="text-disabled text-caption">Chưa thiết lập</span>
                  </td>
                  <td class="text-right">
                    <v-btn
                      size="small"
                      variant="text"
                      color="primary"
                      prepend-icon="mdi-pencil-outline"
                      @click="openEditGroupDialog(g)"
                    >
                      Sửa
                    </v-btn>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </v-card>
        </v-col>
      </v-row>
    </div>

    <!-- ── DIALOG: EDIT GROUP CONFIG ──────────────────────────────────────── -->
    <v-dialog v-model="editGroupDialog" max-width="560">
      <v-card v-if="editingGroup" class="pa-5 rounded-xl">
        <h3 class="text-h6 font-weight-bold mb-4">Cấu Hình Nhóm: {{ editingGroup.groupName }}</h3>

        <v-text-field
          v-model="editingGroup.groupName"
          label="Tên nhóm hiển thị"
          density="compact"
          variant="outlined"
          class="mb-3"
        />

        <v-textarea
          v-model="editingGroup.customPrompt"
          label="Yêu cầu trọng tâm cho AI (Custom Prompt)"
          placeholder="Nhập hướng dẫn riêng cho AI khi tóm tắt nhóm này..."
          rows="3"
          density="compact"
          variant="outlined"
          class="mb-3"
        />

        <v-combobox
          v-model="editingGroup.focusKeywords"
          label="Từ khóa ưu tiên (Focus Keywords)"
          multiple
          chips
          closable-chips
          density="compact"
          variant="outlined"
          placeholder="Nhập từ khóa và ấn Enter (VD: Doanh số, Bug, Khách VIP)"
          class="mb-4"
        />

        <div class="d-flex justify-end gap-2">
          <v-btn variant="text" @click="editGroupDialog = false">Hủy</v-btn>
          <v-btn color="primary" @click="handleSaveEditingGroup">Lưu thay đổi</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <!-- ── DIALOG: RESEND REPORT ─────────────────────────────────────────── -->
    <v-dialog v-model="resendDialog" max-width="500">
      <v-card v-if="selectedReportForResend" class="pa-5 rounded-xl">
        <h3 class="text-h6 font-weight-bold mb-3">Gửi Lại Báo Cáo</h3>
        <p class="text-body-2 text-medium-emphasis mb-4">{{ selectedReportForResend.title }}</p>

        <v-checkbox
          v-model="resendForm.sendZalo"
          label="Gửi qua Zalo cá nhân"
          density="compact"
          color="primary"
          hide-details
        />
        <div v-if="resendForm.sendZalo" class="pl-7 mb-3">
          <v-radio-group v-model="resendForm.zaloDestinationType" density="compact" hide-details>
            <v-radio label="Cloud của tôi (Self-conversation)" value="self" />
            <v-radio label="Nhập Zalo UID cụ thể" value="uid" />
          </v-radio-group>
          <v-text-field
            v-if="resendForm.zaloDestinationType === 'uid'"
            v-model="resendForm.zaloTargetUid"
            placeholder="Zalo UID"
            density="compact"
            variant="outlined"
            class="mt-2"
          />
        </div>

        <v-checkbox
          v-model="resendForm.sendEmail"
          label="Gửi qua Email HTML"
          density="compact"
          color="primary"
          hide-details
        />
        <div v-if="resendForm.sendEmail" class="pl-7 mb-3">
          <v-text-field
            v-model="resendForm.emailRecipient"
            placeholder="Địa chỉ Email nhận"
            density="compact"
            variant="outlined"
            class="mt-2"
          />
        </div>

        <div class="d-flex justify-end gap-2 mt-4">
          <v-btn variant="text" @click="resendDialog = false">Hủy</v-btn>
          <v-btn color="primary" :loading="isResending" @click="handleResendSubmit">Gửi ngay</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <!-- Snackbar Notification -->
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="3000">
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  aiReportApi,
  type GroupItem,
  type GeneratedReportItem,
  type AutomationSettings,
  type SmtpSettings,
} from '@/api/ai-report-api';

const activeTab = ref('generate');

// Generator state
const groups = ref<GroupItem[]>([]);
const selectedGroupIds = ref<string[]>([]);
const isGenerating = ref(false);
const generatingTimer = ref(0);
const activeJobId = ref<string | null>(null);
let timerInterval: any = null;
const pendingJobStorageKey = 'zalocrm.ai-report.pending-job';

const currentReport = ref<GeneratedReportItem | null>(null);

const generatorForm = ref({
  fromDate: '',
  toDate: '',
  sendZalo: true,
  zaloDestinationType: 'self' as 'self' | 'uid',
  zaloTargetUid: '',
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
    const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Monday
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
  selectedGroupIds.value = groups.value.map((g) => g.threadId);
}

function deselectAllGroups() {
  selectedGroupIds.value = [];
}

// Rendered Markdown
const renderedMarkdown = computed(() => {
  if (!currentReport.value?.summaryContent) return '';
  const parsed = marked.parse(currentReport.value.summaryContent);
  return DOMPurify.sanitize(typeof parsed === 'string' ? parsed : '');
});

// Report Archive State
const reports = ref<GeneratedReportItem[]>([]);
const archiveTypeFilter = ref('all');
const typeFilters = [
  { label: 'Tất cả', value: 'all' },
  { label: 'Hàng ngày', value: 'daily' },
  { label: 'Hàng tuần', value: 'weekly' },
  { label: 'Tức thì (On-Demand)', value: 'on_demand' },
];

function setArchiveFilter(val: string) {
  archiveTypeFilter.value = val;
  loadReports();
}

// Settings State
const automationSettings = ref<AutomationSettings>({
  dailyEnabled: true,
  weeklyEnabled: true,
  sendZalo: true,
  zaloDestinationType: 'self',
  sendEmail: false,
  emailRecipients: [],
});

const smtpSettings = ref<SmtpSettings>({
  host: '',
  port: 587,
  user: '',
  pass: '',
  passSet: false,
  from: '',
});

const isSavingSettings = ref(false);

// Edit Group Dialog
const editGroupDialog = ref(false);
const editingGroup = ref<GroupItem | null>(null);

function openEditGroupDialog(group: GroupItem) {
  editingGroup.value = JSON.parse(JSON.stringify(group));
  editGroupDialog.value = true;
}

async function handleSaveEditingGroup() {
  if (!editingGroup.value) return;
  await saveGroupConfig(editingGroup.value);
  const idx = groups.value.findIndex((g) => g.threadId === editingGroup.value?.threadId);
  if (idx !== -1) {
    groups.value[idx] = editingGroup.value;
  }
  editGroupDialog.value = false;
  showSnackbar('Đã lưu cấu hình nhóm thành công', 'success');
}

async function saveGroupConfig(g: GroupItem) {
  try {
    await aiReportApi.updateConfig(g.threadId, {
      group_name: g.groupName,
      is_enabled: g.isEnabled,
      custom_prompt: g.customPrompt,
      focus_keywords: g.focusKeywords,
    });
  } catch (err) {
    showSnackbar('Lỗi khi lưu cấu hình nhóm', 'error');
  }
}

// Resend Dialog
const resendDialog = ref(false);
const selectedReportForResend = ref<GeneratedReportItem | null>(null);
const isResending = ref(false);
const resendForm = ref({
  sendZalo: true,
  zaloDestinationType: 'self' as 'self' | 'uid',
  zaloTargetUid: '',
  sendEmail: false,
  emailRecipient: '',
});

function openResendDialog(rep: GeneratedReportItem) {
  selectedReportForResend.value = rep;
  resendForm.value.sendZalo = rep.sentZalo;
  resendForm.value.sendEmail = rep.sentEmail;
  resendDialog.value = true;
}

async function handleResendSubmit() {
  if (!selectedReportForResend.value) return;
  isResending.value = true;
  try {
    await aiReportApi.resendReport(selectedReportForResend.value.id, {
      send_zalo: resendForm.value.sendZalo,
      send_email: resendForm.value.sendEmail,
      zalo_destination_type: resendForm.value.zaloDestinationType,
      zalo_target_uid: resendForm.value.zaloTargetUid,
      email_recipients: resendForm.value.emailRecipient ? [resendForm.value.emailRecipient] : undefined,
    });
    resendDialog.value = false;
    showSnackbar('Đã gửi lại báo cáo thành công!', 'success');
    loadReports();
  } catch (err: any) {
    showSnackbar(err?.response?.data?.error || 'Lỗi khi gửi lại báo cáo', 'error');
  } finally {
    isResending.value = false;
  }
}

// Snackbar
const snackbar = ref({
  show: false,
  text: '',
  color: 'success',
});

function showSnackbar(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

// Actions
async function handleGenerateReport() {
  if (!generatorForm.value.fromDate || !generatorForm.value.toDate) {
    showSnackbar('Vui lòng chọn đầy đủ thời gian bắt đầu và kết thúc', 'warning');
    return;
  }

  isGenerating.value = true;
  generatingTimer.value = 0;
  timerInterval = setInterval(() => {
    generatingTimer.value++;
  }, 1000);

  try {
    const res = await aiReportApi.generateReport({
      from_date: new Date(generatorForm.value.fromDate).toISOString(),
      to_date: new Date(generatorForm.value.toDate).toISOString(),
      group_thread_ids: selectedGroupIds.value,
      send_zalo: generatorForm.value.sendZalo,
      send_email: generatorForm.value.sendEmail,
      zalo_destination_type: generatorForm.value.zaloDestinationType,
      zalo_target_uid: generatorForm.value.zaloTargetUid,
      email_recipients: generatorForm.value.emailRecipient ? [generatorForm.value.emailRecipient] : undefined,
    }, crypto.randomUUID());
    activeJobId.value = res.jobId;
    sessionStorage.setItem(pendingJobStorageKey, res.jobId);
    await waitForReportJob(res.jobId);
  } catch (err: any) {
    showSnackbar(err?.response?.data?.error || 'Lỗi trong quá trình tạo báo cáo AI', 'error');
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
      currentReport.value = report;
      sessionStorage.removeItem(pendingJobStorageKey);
      showSnackbar('Đã tạo báo cáo AI thành công!', 'success');
      loadReports();
      return;
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      sessionStorage.removeItem(pendingJobStorageKey);
      showSnackbar(job.errorMessage || (job.status === 'cancelled' ? 'Đã hủy tạo báo cáo' : 'Tạo báo cáo thất bại'), 'error');
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
    showSnackbar(err?.response?.data?.error || 'Không thể hủy báo cáo', 'error');
  }
}

function copyMarkdown() {
  if (!currentReport.value?.summaryContent) return;
  navigator.clipboard.writeText(currentReport.value.summaryContent);
  showSnackbar('Đã sao chép nội dung Markdown vào clipboard!', 'info');
}

function printReport() {
  window.print();
}

function viewReportDetail(rep: GeneratedReportItem) {
  currentReport.value = rep;
  activeTab.value = 'generate';
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

// Data loaders
async function loadGroups() {
  try {
    const res = await aiReportApi.getGroups();
    groups.value = res.groups;
    selectedGroupIds.value = res.groups.filter((g) => g.isEnabled).map((g) => g.threadId);
  } catch (err) {
    loggerError('Load groups error', err);
  }
}

async function loadReports() {
  try {
    const typeParam = archiveTypeFilter.value === 'all' ? undefined : archiveTypeFilter.value;
    const res = await aiReportApi.getReports({ report_type: typeParam });
    reports.value = res.reports;
  } catch (err) {
    loggerError('Load reports error', err);
  }
}

async function loadSettings() {
  try {
    const res = await aiReportApi.getSettings();
    if (res.automation) automationSettings.value = res.automation;
    if (res.smtp) smtpSettings.value = res.smtp;
  } catch (err) {
    loggerError('Load settings error', err);
  }
}

async function saveAllSettings() {
  isSavingSettings.value = true;
  try {
    await aiReportApi.updateSettings({
      automation: automationSettings.value,
      smtp: {
        host: smtpSettings.value.host,
        port: Number(smtpSettings.value.port),
        user: smtpSettings.value.user,
        pass: smtpSettings.value.pass || undefined,
        from: smtpSettings.value.from,
      },
    });
    showSnackbar('Đã lưu cấu hình tự động hóa & SMTP thành công!', 'success');
  } catch (err: any) {
    showSnackbar(err?.response?.data?.error || 'Lỗi khi lưu cấu hình', 'error');
  } finally {
    isSavingSettings.value = false;
  }
}

function loggerError(msg: string, err: any) {
  console.error(`[AiReportsView] ${msg}:`, err);
}

onMounted(() => {
  applyPreset(presets[0]);
  loadGroups();
  loadReports();
  loadSettings();
  const pendingJobId = sessionStorage.getItem(pendingJobStorageKey);
  if (pendingJobId) {
    activeJobId.value = pendingJobId;
    isGenerating.value = true;
    waitForReportJob(pendingJobId).finally(() => { isGenerating.value = false; activeJobId.value = null; });
  }
});

onUnmounted(() => {
  if (timerInterval) clearInterval(timerInterval);
});
</script>

<style scoped>
.hero-banner {
  background: linear-gradient(135deg, #0284c7 0%, #0369a1 50%, #075985 100%);
}

.ai-orb-large {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: linear-gradient(135deg, #00f2ff, #0284c7);
  box-shadow: 0 0 20px rgba(0, 242, 255, 0.4);
}

.min-height-card {
  min-height: 560px;
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

/* Print Styles */
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
