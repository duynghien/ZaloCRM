<template>
  <v-dialog :model-value="modelValue" max-width="640" persistent @update:model-value="$emit('update:modelValue', $event)">
    <v-card class="pa-5 chart-card neo-card" elevation="0">
      <div class="d-flex align-center justify-space-between mb-4">
        <h3 class="text-h6 font-weight-bold d-flex align-center">
          <v-icon color="primary" class="mr-2">{{ isEditing ? 'mdi-pencil-outline' : 'mdi-plus-circle-outline' }}</v-icon>
          {{ isEditing ? 'Cập Nhật Quy Tắc Tri Thức' : 'Thêm Quy Tắc Tri Thức Thủ Công' }}
        </h3>
        <v-btn icon="mdi-close" variant="text" size="small" @click="closeDialog" />
      </div>

      <v-form ref="formRef" v-model="isFormValid" @submit.prevent="handleSave">
        <v-row dense>
          <v-col cols="12" sm="6">
            <v-select
              v-model="form.scope"
              label="Phạm vi áp dụng *"
              :items="scopeItems"
              item-title="label"
              item-value="value"
              density="compact"
              variant="outlined"
              :rules="[v => !!v || 'Bắt buộc chọn']"
            />
          </v-col>
          <v-col cols="12" sm="6">
            <v-select
              v-model="form.category"
              label="Phân loại tri thức *"
              :items="categoryItems"
              item-title="label"
              item-value="value"
              density="compact"
              variant="outlined"
              :rules="[v => !!v || 'Bắt buộc chọn']"
            />
          </v-col>

          <v-col v-if="form.scope === 'branch'" cols="12">
            <v-combobox
              v-model="form.branchTag"
              label="Mã / Tên chi nhánh *"
              :items="availableBranches"
              placeholder="VD: CN1, Quận 1, Hoàng Văn Thụ..."
              density="compact"
              variant="outlined"
              :rules="[v => !!v || 'Bắt buộc nhập chi nhánh']"
            />
          </v-col>

          <v-col v-if="form.scope === 'group'" cols="12">
            <v-select
              v-model="form.groupThreadId"
              label="Nhóm Zalo áp dụng *"
              :items="groupItems"
              item-title="name"
              item-value="id"
              density="compact"
              variant="outlined"
              :rules="[v => !!v || 'Bắt buộc chọn nhóm Zalo']"
            />
          </v-col>

          <v-col cols="12">
            <v-text-field
              v-model="form.title"
              label="Tiêu đề quy tắc ngắn gọn *"
              placeholder="VD: Tuấn Anh là Bếp trưởng chịu trách nhiệm duyệt hủy hàng"
              density="compact"
              variant="outlined"
              maxlength="120"
              counter
              :rules="[v => !!v?.trim() || 'Bắt buộc nhập tiêu đề']"
            />
          </v-col>

          <v-col cols="12">
            <v-textarea
              v-model="form.content"
              label="Nội dung tri thức / Chỉ dẫn AI *"
              placeholder="VD: Khi xuất hiện tin nhắn hủy đồ ăn từ tài khoản Tuấn Anh, AI ghi nhận là hủy theo SOP bếp, không ghi nhận là thất thoát."
              rows="3"
              density="compact"
              variant="outlined"
              maxlength="2000"
              counter
              :rules="[v => !!v?.trim() || 'Bắt buộc nhập nội dung']"
            />
          </v-col>

          <v-col cols="12">
            <v-switch
              v-model="form.isActive"
              color="primary"
              label="Kích hoạt quy tắc ngay cho các báo cáo tiếp theo"
              density="compact"
              hide-details
            />
          </v-col>
        </v-row>

        <v-alert v-if="errorMessage" type="error" variant="tonal" class="mt-3 mb-1" density="compact">
          {{ errorMessage }}
        </v-alert>

        <div class="d-flex justify-end gap-2 mt-4 pt-3 border-t">
          <v-btn variant="outlined" :disabled="isSaving" @click="closeDialog">Hủy bỏ</v-btn>
          <v-btn color="primary" type="submit" :loading="isSaving" :disabled="!isFormValid">
            {{ isEditing ? 'Lưu thay đổi' : 'Thêm quy tắc' }}
          </v-btn>
        </div>
      </v-form>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { AiKnowledgeRule, CreateKnowledgeRuleInput, KnowledgeScope, KnowledgeCategory } from '@/api/ai-knowledge-api';
import { aiKnowledgeApi } from '@/api/ai-knowledge-api';

interface GroupOption {
  threadId: string;
  groupName: string;
}

const props = defineProps<{
  modelValue: boolean;
  ruleToEdit: AiKnowledgeRule | null;
  availableBranches: string[];
  groups: GroupOption[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'saved', rule: AiKnowledgeRule): void;
}>();

const isEditing = computed(() => !!props.ruleToEdit);
const isFormValid = ref(false);
const isSaving = ref(false);
const errorMessage = ref('');

const scopeItems = [
  { label: 'Toàn hệ thống (Org)', value: 'org' },
  { label: 'Chi nhánh (Branch)', value: 'branch' },
  { label: 'Nhóm Zalo cụ thể (Group)', value: 'group' },
];

const categoryItems = [
  { label: 'Nhân sự & Vai trò', value: 'personnel' },
  { label: 'Quy trình SOP', value: 'sop' },
  { label: 'Thuật ngữ & Viết tắt', value: 'terminology' },
  { label: 'Bài học đính chính', value: 'correction' },
  { label: 'Quy định chung', value: 'general' },
];

const groupItems = computed(() =>
  props.groups.map(g => ({ id: g.threadId, name: g.groupName || g.threadId }))
);

const form = ref<{
  scope: KnowledgeScope;
  branchTag: string;
  groupThreadId: string;
  category: KnowledgeCategory;
  title: string;
  content: string;
  isActive: boolean;
}>({
  scope: 'org',
  branchTag: '',
  groupThreadId: '',
  category: 'general',
  title: '',
  content: '',
  isActive: true,
});

watch(
  () => props.ruleToEdit,
  (rule) => {
    if (rule) {
      form.value = {
        scope: rule.scope,
        branchTag: rule.branchTag || '',
        groupThreadId: rule.groupThreadId || '',
        category: rule.category,
        title: rule.title,
        content: rule.content,
        isActive: rule.isActive,
      };
    } else {
      form.value = {
        scope: 'org',
        branchTag: '',
        groupThreadId: '',
        category: 'general',
        title: '',
        content: '',
        isActive: true,
      };
    }
    errorMessage.value = '';
  },
  { immediate: true },
);

function closeDialog() {
  emit('update:modelValue', false);
}

async function handleSave() {
  errorMessage.value = '';
  isSaving.value = true;
  try {
    const payload: CreateKnowledgeRuleInput = {
      scope: form.value.scope,
      category: form.value.category,
      title: form.value.title.trim(),
      content: form.value.content.trim(),
      isActive: form.value.isActive,
      branchTag: form.value.scope === 'branch' ? form.value.branchTag.trim() : undefined,
      groupThreadId: form.value.scope === 'group' ? form.value.groupThreadId : undefined,
    };

    let resultRule: AiKnowledgeRule;
    if (isEditing.value && props.ruleToEdit) {
      const res = await aiKnowledgeApi.updateKnowledgeRule(props.ruleToEdit.id, payload);
      resultRule = res.rule;
    } else {
      const res = await aiKnowledgeApi.createKnowledgeRule(payload);
      resultRule = res.rule;
    }

    emit('saved', resultRule);
    closeDialog();
  } catch (err: any) {
    errorMessage.value = err?.response?.data?.error || err.message || 'Lỗi khi lưu quy tắc';
  } finally {
    isSaving.value = false;
  }
}
</script>

<style scoped>
.neo-card {
  border: 1.5px solid var(--border-color);
  border-radius: 12px;
}
</style>
