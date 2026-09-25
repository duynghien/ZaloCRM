<template>
  <div class="ai-report-settings-tab">
    <v-row>
      <!-- AI Provider & Fallback Configuration -->
      <v-col cols="12">
        <AiProviderSettingsCard
          v-model="aiProviderSettings"
          :is-saving="isSavingAi"
          @save="handleSaveAiSettings"
        />
      </v-col>

      <!-- Cron Schedule & Channels -->
      <v-col cols="12" md="6">
        <v-card class="pa-5 mb-4" elevation="0">
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
            <v-select
              v-model="automationSettings.senderAccountId"
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
            <v-radio-group v-model="automationSettings.zaloDestinationType" density="compact">
              <v-radio label="Cloud của tôi (Self-conversation)" value="self" />
              <v-radio label="Nhập Zalo UID hoặc Số điện thoại" value="uid" />
            </v-radio-group>
            <v-text-field
              v-if="automationSettings.zaloDestinationType === 'uid'"
              v-model="automationSettings.zaloTargetUid"
              label="Zalo UID / Số điện thoại đích"
              placeholder="Nhập Zalo UID hoặc Số điện thoại người nhận"
              density="compact"
              variant="outlined"
              hint="Nhập số định danh Zalo UID hoặc Số điện thoại người nhận"
              persistent-hint
            />
          </div>
        </v-card>
      </v-col>

      <!-- SMTP Settings -->
      <v-col cols="12" md="6">
        <v-card class="pa-5 mb-4" elevation="0">
          <h2 class="text-subtitle-1 font-weight-bold mb-4 d-flex align-center">
            <v-icon color="primary" class="mr-2">mailbox.svg</v-icon>
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
            rounded="lg"
            style="border: 1.5px solid var(--border-color);"
            elevation="0"
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
        <v-card class="pa-5 chart-card" elevation="0">
          <h2 class="text-subtitle-1 font-weight-bold mb-4 d-flex align-center">
            <v-icon color="primary" class="mr-2">users.svg</v-icon>
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
              <tr v-for="g in groups" :key="groupPairKey(g)">
                <td class="font-weight-medium">
                  {{ g.groupName }}
                  <div class="text-caption text-medium-emphasis">{{ groupAccountLabel(g) }}</div>
                </td>
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

    <!-- Dialog: Edit Group Config -->
    <v-dialog v-model="editGroupDialog" max-width="560">
      <v-card v-if="editingGroup" class="pa-5 chart-card" elevation="0">
        <h3 class="text-h6 font-weight-bold mb-4">Cấu Hình Nhóm: {{ editingGroup.groupName }}</h3>
        <p class="text-body-2 mb-4">{{ groupAccountLabel(editingGroup) }}</p>

        <v-text-field
          v-model="editingGroup.groupName"
          label="Tên nhóm hiển thị"
          density="compact"
          variant="outlined"
          rounded="lg"
          class="mb-3"
        />

        <div class="mb-3">
          <div class="text-caption text-medium-emphasis mb-1 font-weight-medium">Áp dụng Preset mẫu theo ngành:</div>
          <div class="d-flex flex-wrap gap-1">
            <v-chip
              v-for="preset in INDUSTRY_PRESETS"
              :key="preset.id"
              :prepend-icon="preset.icon"
              size="small"
              variant="outlined"
              color="primary"
              class="cursor-pointer font-weight-medium"
              @click="applyIndustryPreset(preset)"
            >
              {{ preset.label }}
            </v-chip>
          </div>
        </div>

        <v-textarea
          v-model="editingGroup.customPrompt"
          label="Yêu cầu trọng tâm cho AI (Custom Prompt)"
          placeholder="Nhập hướng dẫn riêng cho AI khi tóm tắt nhóm này..."
          rows="3"
          density="compact"
          variant="outlined"
          rounded="lg"
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
          rounded="lg"
          placeholder="Nhập từ khóa và ấn Enter (VD: Doanh số, Bug, Khách VIP)"
          class="mb-4"
        />

        <div class="d-flex justify-end gap-2">
          <v-btn variant="text" rounded="lg" @click="editGroupDialog = false">Hủy</v-btn>
          <v-btn color="primary" rounded="lg" class="font-weight-bold" style="border: 1.5px solid var(--border-color);" @click="handleSaveEditingGroup">
            Lưu thay đổi
          </v-btn>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import AiProviderSettingsCard from '@/components/ai-reports/AiProviderSettingsCard.vue';
import {
  aiReportApi,
  type GroupItem,
  type AutomationSettings,
  type SmtpSettings,
  type AiProviderSettings,
} from '@/api/ai-report-api';
import {
  groupPairKey,
  groupAccountLabel,
  createDefaultAiProviderSettings,
  DEFAULT_AI_PROVIDERS,
} from '@/api/ai-report-view-helpers';

const props = defineProps<{
  groups: GroupItem[];
  senderOptions: Array<{ id: string; label: string; connected: boolean }>;
}>();

const emit = defineEmits<{
  (e: 'settings-saved'): void;
  (e: 'group-updated', group: GroupItem): void;
  (e: 'notify', msg: { text: string; color: string }): void;
}>();

const aiProviderSettings = ref<AiProviderSettings>(createDefaultAiProviderSettings());
const isSavingAi = ref(false);
const isSavingSettings = ref(false);

const automationSettings = ref<AutomationSettings>({
  dailyEnabled: true,
  weeklyEnabled: true,
  sendZalo: true,
  senderAccountId: '',
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

const editGroupDialog = ref(false);
const editingGroup = ref<GroupItem | null>(null);

const INDUSTRY_PRESETS = [
  {
    id: 'fnb',
    label: 'F&B / Quán / Coworking',
    icon: 'mdi-coffee',
    focusKeywords: ['huỷ', 'hỏng', 'hết hàng', 'thiếu', 'sự cố', 'xin cốc', 'bàn giao', 'checklist', 'thành phẩm', 'tồn kho'],
    customPrompt: 'Đặc biệt chú ý đối chiếu số lượng cốc huỷ, kiểm tra việc nhân viên có ghi rõ lý do huỷ hay không; cảnh báo các nguyên liệu hết trước ca kế tiếp; kiểm tra việc hoàn thành checklist máy móc và bàn giao ca.',
  },
  {
    id: 'sales',
    label: 'Bán hàng / Sales CRM',
    icon: 'mdi-briefcase-outline',
    focusKeywords: ['báo giá', 'chốt đơn', 'thanh toán', 'cọc', 'khiếu nại', 'khách hẹn', 'hợp đồng'],
    customPrompt: 'Tập trung vào số lượng lead mới, đơn hàng thành công, doanh số dự kiến và các thắc mắc/khiếu nại của khách hàng chưa được xử lý.',
  },
  {
    id: 'tech',
    label: 'Kỹ thuật / Vận hành hệ thống',
    icon: 'mdi-tools',
    focusKeywords: ['sự cố', 'lỗi', 'bug', 'tiến độ', 'release', 'server', 'downtime', 'hoàn thành', 'deploy'],
    customPrompt: 'Làm rõ các sự cố kỹ thuật, thời gian khắc phục, tiến độ các task trọng tâm và rủi ro chậm tiến độ.',
  },
];

function applyIndustryPreset(preset: typeof INDUSTRY_PRESETS[number]) {
  if (!editingGroup.value) return;
  const hasPrompt = Boolean(editingGroup.value.customPrompt && editingGroup.value.customPrompt.trim());
  const hasKeywords = Boolean(editingGroup.value.focusKeywords && editingGroup.value.focusKeywords.length > 0);
  if (hasPrompt || hasKeywords) {
    const confirmed = window.confirm(`Nhóm đang có cấu hình riêng. Bạn có chắc chắn muốn ghi đè bằng mẫu preset "${preset.label}" không?`);
    if (!confirmed) return;
  }
  editingGroup.value.customPrompt = preset.customPrompt;
  editingGroup.value.focusKeywords = [...preset.focusKeywords];
}

function openEditGroupDialog(group: GroupItem) {
  editingGroup.value = JSON.parse(JSON.stringify(group));
  editGroupDialog.value = true;
}

async function handleSaveEditingGroup() {
  if (!editingGroup.value) return;
  if (!await saveGroupConfig(editingGroup.value)) return;
  emit('group-updated', editingGroup.value);
  editGroupDialog.value = false;
  emit('notify', { text: 'Đã lưu cấu hình nhóm thành công', color: 'success' });
}

async function saveGroupConfig(g: GroupItem) {
  if (!g.zaloAccount) {
    emit('notify', { text: 'Tài khoản nguồn không còn khả dụng', color: 'error' });
    return false;
  }
  try {
    await aiReportApi.updateConfig(g.threadId, {
      zalo_account_id: g.zaloAccount.id,
      group_name: g.groupName,
      is_enabled: g.isEnabled,
      custom_prompt: g.customPrompt,
      focus_keywords: g.focusKeywords,
    });
    return true;
  } catch {
    emit('notify', { text: 'Lỗi khi lưu cấu hình nhóm', color: 'error' });
    return false;
  }
}

function sanitizeAiProvidersPayload(settings: AiProviderSettings): Partial<AiProviderSettings> {
  const cleanProviders: Record<string, any> = {};
  for (const [key, p] of Object.entries(settings.providers || {})) {
    cleanProviders[key] = {
      type: p.type,
      model: p.model?.trim() || undefined,
      apiKey: p.apiKey?.trim() || undefined,
      baseUrl: p.baseUrl?.trim() || undefined,
      supportsVision: p.supportsVision,
    };
  }
  return {
    primaryProvider: settings.primaryProvider,
    fallbackEnabled: settings.fallbackEnabled,
    fallbackChain: settings.fallbackChain,
    allowSystemFallback: settings.allowSystemFallback,
    providers: cleanProviders,
  };
}

async function handleSaveAiSettings() {
  isSavingAi.value = true;
  try {
    await aiReportApi.updateSettings({
      aiProviders: sanitizeAiProvidersPayload(aiProviderSettings.value),
    });
    emit('notify', { text: 'Đã lưu cấu hình AI Provider thành công!', color: 'success' });
    await loadSettings();
  } catch (err: any) {
    emit('notify', { text: err?.response?.data?.error || 'Không thể lưu cấu hình AI Provider', color: 'error' });
  } finally {
    isSavingAi.value = false;
  }
}

async function saveAllSettings() {
  if (automationSettings.value.sendZalo && !automationSettings.value.senderAccountId) {
    emit('notify', { text: 'Vui lòng chọn tài khoản Zalo gửi báo cáo tự động', color: 'warning' });
    return;
  }
  isSavingSettings.value = true;
  try {
    await aiReportApi.updateSettings({
      aiProviders: sanitizeAiProvidersPayload(aiProviderSettings.value),
      automation: {
        ...automationSettings.value,
        senderAccountId: automationSettings.value.senderAccountId || undefined,
        zaloTargetUid: automationSettings.value.sendZalo && automationSettings.value.zaloDestinationType === 'uid'
          ? automationSettings.value.zaloTargetUid?.trim() || undefined : undefined,
      },
      smtp: {
        host: smtpSettings.value.host,
        port: Number(smtpSettings.value.port),
        user: smtpSettings.value.user,
        pass: smtpSettings.value.pass || undefined,
        from: smtpSettings.value.from,
      },
    });
    emit('notify', { text: 'Đã lưu cấu hình tự động hóa, AI Provider & SMTP thành công!', color: 'success' });
    emit('settings-saved');
  } catch (err: any) {
    emit('notify', { text: err?.response?.data?.error || 'Lỗi khi lưu cấu hình', color: 'error' });
  } finally {
    isSavingSettings.value = false;
  }
}

async function loadSettings() {
  try {
    const res = await aiReportApi.getSettings();
    if (res.automation) automationSettings.value = res.automation;
    if (res.smtp) smtpSettings.value = res.smtp;
    if (res.aiProviders) {
      aiProviderSettings.value = {
        ...res.aiProviders,
        providers: {
          ...DEFAULT_AI_PROVIDERS,
          ...(res.aiProviders.providers || {}),
        },
      };
    }
  } catch (err) {
    console.error('Load settings error', err);
  }
}

onMounted(() => {
  loadSettings();
});
</script>
