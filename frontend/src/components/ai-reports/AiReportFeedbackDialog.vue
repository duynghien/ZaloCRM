<template>
  <v-dialog :model-value="modelValue" max-width="680" persistent @update:model-value="$emit('update:modelValue', $event)">
    <v-card class="pa-5 chart-card neo-card" elevation="0">
      <div class="d-flex align-center justify-space-between mb-3">
        <div>
          <h3 class="text-h6 font-weight-bold d-flex align-center">
            <v-icon color="amber-darken-3" class="mr-2">mdi-lightbulb-on-outline</v-icon>
            Góp Ý & Dạy AI Báo Cáo
          </h3>
          <p class="text-caption text-medium-emphasis">
            Báo cáo: <strong>{{ report?.title || 'Báo cáo AI' }}</strong> (Mã: #{{ report?.id?.slice(0, 8) }})
          </p>
        </div>
        <v-btn icon="mdi-close" variant="text" size="small" @click="closeDialog" />
      </div>

      <!-- Result state when rule distilled -->
      <div v-if="distilledResult" class="py-2">
        <v-alert type="success" variant="tonal" class="mb-4" density="comfortable" icon="mdi-check-decagram">
          <div class="font-weight-bold mb-1">AI đã học thành công và kích hoạt quy tắc mới!</div>
          <div class="text-caption">Quy tắc này sẽ tự động được nạp vào các lần tóm tắt & báo cáo tiếp theo.</div>
        </v-alert>

        <v-card variant="outlined" class="pa-4 mb-4 neo-rule-box" color="primary">
          <div class="d-flex align-center justify-space-between mb-2">
            <v-chip size="x-small" color="primary" variant="flat" class="font-weight-bold text-uppercase">
              {{ distilledResult.category }}
            </v-chip>
            <v-chip size="x-small" color="success" variant="flat">
              ĐÃ KÍCH HOẠT (ACTIVE)
            </v-chip>
          </div>
          <div class="text-subtitle-2 font-weight-bold mb-1">{{ distilledResult.title }}</div>
          <p class="text-body-2 text-medium-emphasis mb-0">{{ distilledResult.content || distilledResult.ruleContent }}</p>
        </v-card>

        <div class="d-flex justify-end">
          <v-btn color="primary" @click="closeDialog">Hoàn tất & Đóng</v-btn>
        </div>
      </div>

      <!-- Input Form -->
      <v-form v-else ref="formRef" v-model="isFormValid" @submit.prevent="handleSubmit">
        <v-row dense>
          <v-col cols="12" sm="6">
            <v-select
              v-model="form.section"
              label="Mục báo cáo cần chỉnh sửa *"
              :items="sectionOptions"
              item-title="label"
              item-value="value"
              density="compact"
              variant="outlined"
            />
          </v-col>
          <v-col cols="12" sm="6">
            <v-select
              v-model="form.targetScope"
              label="Phạm vi bài học áp dụng *"
              :items="scopeOptions"
              item-title="label"
              item-value="value"
              density="compact"
              variant="outlined"
            />
          </v-col>

          <v-col v-if="form.targetScope === 'branch'" cols="12">
            <v-combobox
              v-model="form.branchTag"
              label="Chi nhánh áp dụng *"
              :items="availableBranches"
              placeholder="Nhập mã hoặc tên chi nhánh (VD: CN1, Hoàng Văn Thụ...)"
              density="compact"
              variant="outlined"
              :rules="[v => !!v || 'Vui lòng nhập chi nhánh']"
            />
          </v-col>

          <v-col v-if="form.targetScope === 'group'" cols="12">
            <v-select
              v-model="form.groupThreadId"
              label="Nhóm Zalo nguồn áp dụng *"
              :items="relevantGroupOptions"
              item-title="name"
              item-value="id"
              density="compact"
              variant="outlined"
              :rules="[v => !!v || 'Vui lòng chọn nhóm']"
            />
          </v-col>

          <v-col cols="12">
            <v-textarea
              v-model="form.originalContent"
              label="Đoạn AI viết chưa chuẩn / Trích dẫn (không bắt buộc)"
              placeholder="VD: Tuấn Anh làm thất thoát 500g bơ sốt..."
              rows="2"
              density="compact"
              variant="outlined"
            />
          </v-col>

          <v-col cols="12">
            <v-textarea
              v-model="form.comment"
              label="Thực tế đúng là gì / Chỉ dẫn của Quản trị viên *"
              placeholder="VD: Tuấn Anh là Bếp trưởng, việc bỏ bơ sốt là hủy nguyên liệu hết hạn theo đúng quy trình SOP bếp, không phải làm thất thoát."
              rows="3"
              density="compact"
              variant="outlined"
              :rules="[v => !!v?.trim() || 'Vui lòng nhập phản hồi của quản lý']"
            />
          </v-col>
        </v-row>

        <v-alert v-if="errorMessage" type="error" variant="tonal" class="mt-2 mb-2" density="compact">
          {{ errorMessage }}
        </v-alert>

        <div class="d-flex align-center justify-space-between mt-4 pt-3 border-t">
          <span class="text-caption text-medium-emphasis">
            💡 AI sẽ tự động phân tích & chắt lọc quy tắc tri thức chuẩn hóa trong ~2s.
          </span>
          <div class="d-flex gap-2">
            <v-btn variant="outlined" :disabled="isSubmitting" @click="closeDialog">Hủy</v-btn>
            <v-btn color="amber-darken-3" type="submit" :loading="isSubmitting" :disabled="!isFormValid">
              Gửi Góp Ý & Dạy AI
            </v-btn>
          </div>
        </div>
      </v-form>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { GeneratedReportItem, GroupItem } from '@/api/ai-report-api';
import type { AiKnowledgeRule, KnowledgeScope, SubmitReportFeedbackResponse } from '@/api/ai-knowledge-api';
import { aiKnowledgeApi } from '@/api/ai-knowledge-api';

const props = defineProps<{
  modelValue: boolean;
  report: GeneratedReportItem | null;
  groups: GroupItem[];
  availableBranches: string[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'feedbackSubmitted', res: SubmitReportFeedbackResponse): void;
}>();

const isFormValid = ref(false);
const isSubmitting = ref(false);
const errorMessage = ref('');
const distilledResult = ref<AiKnowledgeRule | null>(null);

const sectionOptions = [
  { label: 'Điểm nổi bật & Sự cố (Highlights)', value: 'highlights' },
  { label: 'Công việc hoàn thành (Completed)', value: 'completed' },
  { label: 'Tồn đọng & Trở ngại (Blockers)', value: 'blockers' },
  { label: 'Số liệu & Chỉ số (Metrics)', value: 'metrics' },
  { label: 'Hành động đề xuất (Actions)', value: 'actions' },
  { label: 'Nội dung chung toàn báo cáo', value: 'general' },
];

const scopeOptions = [
  { label: '🟢 Nhóm này (Group-level)', value: 'group' },
  { label: '🟡 Chi nhánh (Branch-level)', value: 'branch' },
  { label: '🔵 Toàn hệ thống (Org-level)', value: 'org' },
];

const relevantGroupOptions = computed(() => {
  const reportGroupIds = props.report?.groupThreadIds || [];
  const matched = props.groups.filter(g => reportGroupIds.includes(g.threadId));
  const list = matched.length > 0 ? matched : props.groups;
  return list.map(g => ({ id: g.threadId, name: g.groupName || g.threadId }));
});

const form = ref<{
  section: string;
  targetScope: KnowledgeScope;
  branchTag: string;
  groupThreadId: string;
  originalContent: string;
  comment: string;
}>({
  section: 'general',
  targetScope: 'group',
  branchTag: '',
  groupThreadId: '',
  originalContent: '',
  comment: '',
});

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      distilledResult.value = null;
      errorMessage.value = '';
      const firstGroupId = props.report?.groupThreadIds?.[0] || '';
      form.value = {
        section: 'general',
        targetScope: firstGroupId ? 'group' : 'org',
        branchTag: props.availableBranches[0] || '',
        groupThreadId: firstGroupId,
        originalContent: '',
        comment: '',
      };
    }
  },
);

function closeDialog() {
  emit('update:modelValue', false);
}

async function handleSubmit() {
  if (!props.report) return;
  errorMessage.value = '';
  isSubmitting.value = true;
  try {
    const commentText = form.value.comment.trim();
    const snippetText = form.value.originalContent.trim();
    const res = await aiKnowledgeApi.submitReportFeedback(props.report.id, {
      section: form.value.section,
      sectionKey: form.value.section,
      originalContent: snippetText || undefined,
      originalSnippet: snippetText || undefined,
      comment: commentText,
      feedbackComment: commentText,
      targetScope: form.value.targetScope,
      branchTag: form.value.targetScope === 'branch' ? form.value.branchTag.trim() : undefined,
      groupThreadId: form.value.targetScope === 'group' ? form.value.groupThreadId : undefined,
    });
    distilledResult.value = res.distilledRule;
    emit('feedbackSubmitted', res);
  } catch (err: any) {
    errorMessage.value = err?.response?.data?.error || err.message || 'Lỗi khi gửi góp ý cho AI';
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<style scoped>
.neo-card {
  border: 1.5px solid var(--border-color);
  border-radius: 12px;
}
.neo-rule-box {
  border: 1.5px solid var(--border-color) !important;
  border-radius: 8px;
}
</style>
