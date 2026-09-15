<template>
  <v-dialog :model-value="modelValue" max-width="800px" persistent @update:model-value="$emit('update:modelValue', $event)">
    <v-card class="pa-5 neo-card" elevation="0">
      <v-card-title class="pa-0 mb-4 d-flex align-center justify-space-between font-weight-bold">
        <div class="d-flex align-center gap-2">
          <v-icon color="primary">mdi-target</v-icon>
          <span>{{ isEdit ? 'Chỉnh Sửa Quy Tắc Giám Sát' : 'Tạo Quy Tắc Giám Sát Mới' }}</span>
        </div>
        <v-btn icon="mdi-close" variant="text" density="compact" @click="$emit('update:modelValue', false)" />
      </v-card-title>

      <v-card-text class="pa-0">
        <v-form ref="formRef" @submit.prevent="handleSave">
          <v-row dense>
            <!-- 1. Tên & Trạng thái -->
            <v-col cols="12" md="8">
              <v-text-field
                v-model="formData.name"
                label="Tên quy tắc giám sát *"
                placeholder="Ví dụ: Kiểm tra nộp lịch làm việc ca sáng"
                variant="outlined"
                density="compact"
                :rules="[(v) => !!v || 'Vui lòng nhập tên quy tắc']"
              />
            </v-col>
            <v-col cols="12" md="4" class="d-flex align-center">
              <v-switch
                v-model="formData.isEnabled"
                label="Kích hoạt quy tắc"
                color="success"
                density="compact"
                hide-details
              />
            </v-col>

            <!-- 2. Nhóm nguồn -->
            <v-col cols="12" md="6">
              <v-select
                v-model="formData.zaloAccountId"
                :items="accountOptions"
                label="Tài khoản Zalo theo dõi *"
                variant="outlined"
                density="compact"
                :rules="[(v) => !!v || 'Vui lòng chọn tài khoản Zalo']"
                @update:model-value="onAccountChange"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-autocomplete
                v-model="formData.groupThreadId"
                :items="filteredSourceGroups"
                item-title="title"
                item-value="value"
                label="Nhóm Zalo nguồn cần theo dõi *"
                variant="outlined"
                density="compact"
                :rules="[(v) => !!v || 'Vui lòng chọn nhóm Zalo nguồn']"
                @update:model-value="onGroupChange"
              />
            </v-col>

            <!-- 3. Thời gian chạy -->
            <v-col cols="12" md="4">
              <v-text-field
                v-model="formData.runTime"
                label="Giờ chạy định kỳ (HH:mm) *"
                placeholder="10:00"
                variant="outlined"
                density="compact"
                :rules="[
                  (v) => !!v || 'Vui lòng nhập giờ',
                  (v) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(v) || 'Định dạng HH:mm (ví dụ 10:00)',
                ]"
              />
            </v-col>
            <v-col cols="12" md="8">
              <div class="text-caption font-weight-bold mb-1">Ngày chạy trong tuần:</div>
              <div class="d-flex gap-1 flex-wrap align-center">
                <v-btn
                  v-for="day in DAY_ITEMS"
                  :key="day.val"
                  size="small"
                  :variant="formData.daysOfWeek.includes(day.val) ? 'flat' : 'outlined'"
                  :color="formData.daysOfWeek.includes(day.val) ? 'primary' : undefined"
                  density="compact"
                  class="font-weight-bold"
                  @click="toggleDay(day.val)"
                >
                  {{ day.label }}
                </v-btn>
                <v-btn size="x-small" variant="text" class="text-caption text-primary ml-2" @click="setWeekdays">
                  Ngày làm việc (T2-T6)
                </v-btn>
                <v-btn size="x-small" variant="text" class="text-caption text-primary" @click="setAllDays">
                  Hàng ngày
                </v-btn>
              </div>
            </v-col>

            <!-- 4. Khung giờ quét & Nhân sự -->
            <v-col cols="12" md="6">
              <v-select
                v-model="formData.scanWindowType"
                :items="SCAN_WINDOW_OPTIONS"
                label="Khung giờ quét tin nhắn *"
                variant="outlined"
                density="compact"
              />
              <v-text-field
                v-if="formData.scanWindowType === 'last_n_hours'"
                v-model.number="formData.scanWindowHours"
                type="number"
                label="Số giờ gần nhất (1 - 168)"
                variant="outlined"
                density="compact"
                min="1"
                max="168"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-select
                v-model="formData.personnelType"
                :items="PERSONNEL_OPTIONS"
                label="Đối tượng nhân sự kiểm tra *"
                variant="outlined"
                density="compact"
              />
              <v-textarea
                v-if="formData.personnelType === 'explicit_list'"
                v-model="personnelInput"
                label="Danh sách nhân sự (mỗi dòng 1 tên hoặc cách nhau bằng dấu phẩy)"
                variant="outlined"
                density="compact"
                rows="2"
              />
            </v-col>

            <!-- 5. Kịch bản & Prompt -->
            <v-col cols="12">
              <v-select
                v-model="formData.templateType"
                :items="TEMPLATE_OPTIONS"
                label="Kịch bản nghiệp vụ thẩm định *"
                variant="outlined"
                density="compact"
                @update:model-value="onTemplateChange"
              />
            </v-col>
            <v-col cols="12">
              <v-textarea
                v-model="formData.customPrompt"
                label="Chỉ thị yêu cầu đánh giá / Tiêu chí thẩm định (Prompt)"
                placeholder="Nhập yêu cầu kiểm tra chi tiết..."
                variant="outlined"
                density="compact"
                rows="3"
              />
            </v-col>

            <!-- 6. Kênh nhận báo cáo & Nhắc nhở -->
            <v-col cols="12" md="6">
              <v-select
                v-model="formData.destinationType"
                :items="DESTINATION_OPTIONS"
                label="Kênh nhận báo cáo thẩm định *"
                variant="outlined"
                density="compact"
              />
              <v-autocomplete
                v-if="formData.destinationType === 'group'"
                v-model="formData.targetGroupId"
                :items="filteredDestGroups"
                item-title="title"
                item-value="value"
                label="Nhóm Zalo giám sát đích *"
                variant="outlined"
                density="compact"
                @update:model-value="onTargetGroupChange"
              />
              <v-text-field
                v-if="formData.destinationType === 'uid'"
                v-model="formData.targetUid"
                label="Zalo UID người nhận *"
                variant="outlined"
                density="compact"
              />
              <v-text-field
                v-if="formData.destinationType === 'email'"
                v-model="emailInput"
                label="Email nhận báo cáo (phân cách bằng dấu phẩy) *"
                variant="outlined"
                density="compact"
              />
            </v-col>
            <v-col cols="12" md="6">
              <div class="pa-3 border rounded bg-surface-variant">
                <v-switch
                  v-model="formData.sendOperationalReminder"
                  label="Tự động nhắc nhở trong nhóm nguồn (Dual-Dispatch)"
                  color="warning"
                  density="compact"
                  hide-details
                />
                <div class="text-caption text-medium-emphasis mt-2">
                  Khi bật, hệ thống sẽ tự động gửi tin nhắn điểm danh lịch sự (tạo tất định, chống prompt injection) nhắc nhở nhân sự chưa nộp hoặc biểu dương 100% tuân thủ.
                </div>
              </div>
            </v-col>
          </v-row>
        </v-form>
      </v-card-text>

      <v-card-actions class="pa-0 mt-4 d-flex justify-end gap-2">
        <v-btn variant="outlined" @click="$emit('update:modelValue', false)">Hủy</v-btn>
        <v-btn color="primary" variant="flat" :loading="saving" @click="handleSave">
          {{ isEdit ? 'Cập Nhật' : 'Lưu Quy Tắc' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { aiReportApi, type AiAuditRule, type AuditRuleInput, type GroupItem } from '../../api/ai-report-api';

const props = defineProps<{
  modelValue: boolean;
  rule?: AiAuditRule | null;
  groups: GroupItem[];
  accounts: Array<{ id: string; displayName: string | null; zaloUid: string | null }>;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'saved', rule: AiAuditRule): void;
}>();

const formRef = ref<any>(null);
const saving = ref(false);
const personnelInput = ref('');
const emailInput = ref('');

const isEdit = computed(() => !!props.rule?.id);

const DAY_ITEMS = [
  { val: 1, label: 'T2' },
  { val: 2, label: 'T3' },
  { val: 3, label: 'T4' },
  { val: 4, label: 'T5' },
  { val: 5, label: 'T6' },
  { val: 6, label: 'T7' },
  { val: 7, label: 'CN' },
];

const SCAN_WINDOW_OPTIONS = [
  { value: 'since_start_of_day', title: 'Từ đầu ngày (00:00) đến giờ chạy' },
  { value: 'last_n_hours', title: 'N giờ gần nhất' },
];

const PERSONNEL_OPTIONS = [
  { value: 'all_group_members', title: 'Toàn bộ thành viên nhóm (Tự động)' },
  { value: 'explicit_list', title: 'Nhập danh sách nhân sự cụ thể' },
];

const TEMPLATE_OPTIONS = [
  { value: 'schedule_submission', title: 'Báo cáo lịch làm việc / Kế hoạch ngày' },
  { value: 'work_progress', title: 'Kiểm tra tiến độ công việc / KPI' },
  { value: 'image_verification', title: 'Kiểm tra hình ảnh / Biên bản chứng từ' },
  { value: 'custom', title: 'Kịch bản tùy biến tự do' },
];

const DESTINATION_OPTIONS = [
  { value: 'group', title: 'Nhóm Zalo Giám sát' },
  { value: 'self', title: 'Zalo cá nhân / Cloud' },
  { value: 'uid', title: 'Zalo UID người nhận' },
  { value: 'email', title: 'Hộp thư Email' },
];

const defaultForm: AuditRuleInput = {
  name: '',
  isEnabled: true,
  zaloAccountId: '',
  groupThreadId: '',
  groupName: '',
  runTime: '10:00',
  daysOfWeek: [1, 2, 3, 4, 5],
  scanWindowType: 'since_start_of_day',
  scanWindowHours: 24,
  personnelType: 'all_group_members',
  personnelList: [],
  templateType: 'schedule_submission',
  customPrompt: '',
  destinationType: 'group',
  targetGroupId: '',
  targetGroupName: '',
  targetUid: '',
  emailRecipients: [],
  sendOperationalReminder: true,
};

const formData = ref<AuditRuleInput>({ ...defaultForm });

const accountOptions = computed(() =>
  props.accounts.map((acc) => ({
    value: acc.id,
    title: acc.displayName || `Zalo (${acc.zaloUid || acc.id})`,
  })),
);

const filteredSourceGroups = computed(() => {
  return props.groups
    .filter((g) => !formData.value.zaloAccountId || g.zaloAccount?.id === formData.value.zaloAccountId)
    .map((g) => ({
      value: g.threadId,
      title: g.groupName,
    }));
});

const filteredDestGroups = computed(() => {
  return props.groups.map((g) => ({
    value: g.threadId,
    title: `${g.groupName} (${g.zaloAccount?.displayName || 'Zalo'})`,
  }));
});

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      if (props.rule) {
        formData.value = {
          name: props.rule.name,
          isEnabled: props.rule.isEnabled,
          zaloAccountId: props.rule.zaloAccountId,
          groupThreadId: props.rule.groupThreadId,
          groupName: props.rule.groupName,
          runTime: props.rule.runTime,
          daysOfWeek: [...props.rule.daysOfWeek],
          scanWindowType: props.rule.scanWindowType,
          scanWindowHours: props.rule.scanWindowHours ?? 24,
          personnelType: props.rule.personnelType,
          personnelList: [...(props.rule.personnelList || [])],
          templateType: props.rule.templateType,
          customPrompt: props.rule.customPrompt,
          destinationType: props.rule.destinationType,
          targetGroupId: props.rule.targetGroupId,
          targetGroupName: props.rule.targetGroupName,
          targetUid: props.rule.targetUid,
          emailRecipients: [...(props.rule.emailRecipients || [])],
          sendOperationalReminder: props.rule.sendOperationalReminder,
        };
        personnelInput.value = (props.rule.personnelList || []).join('\n');
        emailInput.value = (props.rule.emailRecipients || []).join(', ');
      } else {
        formData.value = {
          ...defaultForm,
          zaloAccountId: props.accounts[0]?.id || '',
        };
        personnelInput.value = '';
        emailInput.value = '';
      }
    }
  },
);

function toggleDay(day: number) {
  const idx = formData.value.daysOfWeek.indexOf(day);
  if (idx >= 0) {
    if (formData.value.daysOfWeek.length > 1) {
      formData.value.daysOfWeek.splice(idx, 1);
    }
  } else {
    formData.value.daysOfWeek.push(day);
    formData.value.daysOfWeek.sort();
  }
}

function setWeekdays() {
  formData.value.daysOfWeek = [1, 2, 3, 4, 5];
}

function setAllDays() {
  formData.value.daysOfWeek = [1, 2, 3, 4, 5, 6, 7];
}

function onAccountChange() {
  const matchingGroup = filteredSourceGroups.value[0];
  if (matchingGroup) {
    formData.value.groupThreadId = matchingGroup.value;
    formData.value.groupName = matchingGroup.title;
  }
}

function onGroupChange(threadId: string) {
  const g = props.groups.find((group) => group.threadId === threadId);
  if (g) {
    formData.value.groupName = g.groupName;
  }
}

function onTargetGroupChange(threadId: string) {
  const g = props.groups.find((group) => group.threadId === threadId);
  if (g) {
    formData.value.targetGroupName = g.groupName;
  }
}

function onTemplateChange(tmpl: string) {
  if (tmpl === 'schedule_submission' && !formData.value.customPrompt) {
    formData.value.customPrompt = 'Kiểm tra nhân sự gửi lịch trình / kế hoạch làm việc trước giờ quy định.';
  } else if (tmpl === 'work_progress' && !formData.value.customPrompt) {
    formData.value.customPrompt = 'Kiểm tra báo cáo tiến độ công việc, doanh số hoặc KPI đạt được trong ca.';
  } else if (tmpl === 'image_verification' && !formData.value.customPrompt) {
    formData.value.customPrompt = 'Kiểm tra hình ảnh chụp chứng từ, hóa đơn hoặc hiện trường có rõ nét, đúng quy cách không.';
  }
}

async function handleSave() {
  const valid = await formRef.value?.validate();
  if (valid && !valid.valid) return;

  if (formData.value.personnelType === 'explicit_list') {
    formData.value.personnelList = personnelInput.value
      .split(/[,\n]/)
      .map((n) => n.trim())
      .filter(Boolean);
  } else {
    formData.value.personnelList = [];
  }

  if (formData.value.destinationType === 'email') {
    formData.value.emailRecipients = emailInput.value
      .split(/[,\n]/)
      .map((e) => e.trim())
      .filter(Boolean);
  }

  saving.value = true;
  try {
    let resultRule: AiAuditRule;
    if (isEdit.value && props.rule?.id) {
      const res = await aiReportApi.updateAuditRule(props.rule.id, formData.value);
      resultRule = res.rule;
    } else {
      const res = await aiReportApi.createAuditRule(formData.value);
      resultRule = res.rule;
    }
    emit('saved', resultRule);
    emit('update:modelValue', false);
  } catch (err: any) {
    alert(err?.response?.data?.error || err?.message || 'Lỗi khi lưu quy tắc');
  } finally {
    saving.value = false;
  }
}
</script>
