<template>
  <div class="ai-knowledge-tab">
    <!-- Action & Filter Bar -->
    <v-card class="pa-4 mb-4 chart-card neo-card" elevation="0">
      <div class="d-flex align-center justify-space-between flex-wrap gap-3 mb-3">
        <div class="d-flex align-center gap-2 flex-grow-1" style="max-width: 450px;">
          <v-text-field
            v-model="searchQuery"
            placeholder="Tìm theo tiêu đề, nội dung quy tắc..."
            prepend-inner-icon="mdi-magnify"
            density="compact"
            variant="outlined"
            hide-details
            clearable
          />
        </div>
        <div class="d-flex align-center gap-2">
          <v-btn variant="outlined" prepend-icon="mdi-refresh" density="comfortable" :loading="isLoading" @click="loadRules">
            Làm mới
          </v-btn>
          <v-btn v-if="canManage" color="primary" prepend-icon="mdi-plus" density="comfortable" @click="openCreateDialog">
            Thêm quy tắc
          </v-btn>
        </div>
      </div>

      <!-- Scope & Category Chips -->
      <div class="d-flex align-center flex-wrap gap-2">
        <span class="text-caption font-weight-bold text-medium-emphasis mr-1">Cấp độ:</span>
        <v-chip
          v-for="s in scopeFilters"
          :key="s.value"
          size="small"
          :variant="selectedScope === s.value ? 'flat' : 'outlined'"
          :color="selectedScope === s.value ? 'primary' : undefined"
          @click="selectedScope = s.value"
        >
          {{ s.label }}
        </v-chip>

        <span class="text-caption font-weight-bold text-medium-emphasis ml-3 mr-1">Phân loại:</span>
        <v-chip
          v-for="c in categoryFilters"
          :key="c.value"
          size="small"
          :variant="selectedCategory === c.value ? 'flat' : 'outlined'"
          :color="selectedCategory === c.value ? 'secondary' : undefined"
          @click="selectedCategory = c.value"
        >
          {{ c.label }}
        </v-chip>
      </div>
    </v-card>

    <!-- Rules List -->
    <v-card class="chart-card neo-card" elevation="0">
      <div v-if="isLoading" class="text-center py-12">
        <v-progress-circular indeterminate color="primary" />
        <div class="text-caption text-medium-emphasis mt-2">Đang tải tri thức vận hành...</div>
      </div>

      <div v-else-if="filteredRules.length === 0" class="text-center py-12 text-medium-emphasis">
        <v-icon size="48" color="medium-emphasis" class="mb-2">mdi-school-outline</v-icon>
        <div class="text-subtitle-2">Chưa có quy tắc tri thức nào phù hợp.</div>
        <div class="text-caption">Thêm quy tắc mới hoặc gửi góp ý từ báo cáo để dạy AI.</div>
      </div>

      <div v-else class="pa-2">
        <div
          v-for="rule in filteredRules"
          :key="rule.id"
          class="pa-4 mb-2 d-flex align-start justify-space-between flex-wrap gap-3 rule-item"
          :class="{ 'rule-disabled': !rule.isActive }"
        >
          <div style="max-width: 80%;">
            <div class="d-flex align-center gap-2 mb-1 flex-wrap">
              <v-chip size="x-small" :color="getScopeColor(rule.scope)" variant="flat" class="font-weight-bold text-uppercase">
                {{ formatScopeLabel(rule) }}
              </v-chip>
              <v-chip size="x-small" variant="tonal" class="font-weight-medium">
                {{ formatCategoryLabel(rule.category) }}
              </v-chip>
              <span class="text-caption text-medium-emphasis">{{ rule.version ? `v${rule.version} • ` : '' }}{{ formatDate(rule.updatedAt) }}</span>
            </div>
            <div class="text-subtitle-2 font-weight-bold text-primary mb-1">{{ rule.title }}</div>
            <p class="text-body-2 text-medium-emphasis mb-0" style="white-space: pre-wrap;">{{ rule.content || rule.ruleContent }}</p>
          </div>

          <div class="d-flex align-center gap-2">
            <v-switch
              :model-value="rule.isActive"
              color="primary"
              density="compact"
              hide-details
              :disabled="!canManage || togglingIds[rule.id]"
              @update:model-value="handleToggle(rule)"
            />
            <v-btn v-if="canManage" icon="mdi-pencil-outline" size="small" variant="text" @click="openEditDialog(rule)" />
            <v-btn v-if="canManage" icon="mdi-delete-outline" size="small" variant="text" color="error" @click="handleDelete(rule)" />
          </div>
        </div>
      </div>
    </v-card>

    <!-- Dialog Thêm/Sửa Quy Tắc -->
    <AiKnowledgeRuleDialog
      v-model="showRuleDialog"
      :rule-to-edit="editingRule"
      :available-branches="availableBranches"
      :groups="groups"
      @saved="onRuleSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { GroupItem } from '@/api/ai-report-api';
import type { AiKnowledgeRule, KnowledgeScope, KnowledgeCategory } from '@/api/ai-knowledge-api';
import { aiKnowledgeApi } from '@/api/ai-knowledge-api';
import AiKnowledgeRuleDialog from './AiKnowledgeRuleDialog.vue';

const props = defineProps<{
  groups: GroupItem[];
  canManage: boolean;
}>();

const rules = ref<AiKnowledgeRule[]>([]);
const availableBranches = ref<string[]>([]);
const isLoading = ref(false);
const togglingIds = ref<Record<string, boolean>>({});
const searchQuery = ref('');
const selectedScope = ref<string>('all');
const selectedCategory = ref<string>('all');
const showRuleDialog = ref(false);
const editingRule = ref<AiKnowledgeRule | null>(null);

const scopeFilters = [
  { label: 'Tất cả cấp', value: 'all' },
  { label: 'Toàn hệ thống', value: 'org' },
  { label: 'Chi nhánh', value: 'branch' },
  { label: 'Nhóm Zalo', value: 'group' },
];

const categoryFilters = [
  { label: 'Tất cả phân loại', value: 'all' },
  { label: 'Nhân sự', value: 'personnel' },
  { label: 'Quy trình SOP', value: 'sop' },
  { label: 'Thuật ngữ', value: 'terminology' },
  { label: 'Đính chính', value: 'correction' },
  { label: 'Quy định', value: 'general' },
];

const filteredRules = computed(() => {
  return rules.value.filter(r => {
    if (selectedScope.value !== 'all' && r.scope !== selectedScope.value) return false;
    if (selectedCategory.value !== 'all' && r.category !== selectedCategory.value) return false;
    if (searchQuery.value?.trim()) {
      const q = searchQuery.value.toLowerCase().trim();
      const matchTitle = r.title.toLowerCase().includes(q);
      const matchContent = r.content.toLowerCase().includes(q);
      const matchBranch = r.branchTag?.toLowerCase().includes(q);
      if (!matchTitle && !matchContent && !matchBranch) return false;
    }
    return true;
  });
});

async function loadRules() {
  isLoading.value = true;
  try {
    const [rulesRes, branchesRes] = await Promise.all([
      aiKnowledgeApi.getKnowledgeRules(),
      aiKnowledgeApi.getAvailableBranches(),
    ]);
    rules.value = rulesRes.rules;
    availableBranches.value = branchesRes.branches;
  } catch (err) {
    console.error('Lỗi khi tải tri thức:', err);
  } finally {
    isLoading.value = false;
  }
}

async function handleToggle(rule: AiKnowledgeRule) {
  togglingIds.value[rule.id] = true;
  try {
    const res = await aiKnowledgeApi.toggleKnowledgeRule(rule.id);
    rule.isActive = res.rule.isActive;
  } catch (err) {
    console.error('Lỗi khi bật/tắt quy tắc:', err);
  } finally {
    delete togglingIds.value[rule.id];
  }
}

async function handleDelete(rule: AiKnowledgeRule) {
  if (!confirm(`Bạn có chắc muốn xóa quy tắc: "${rule.title}"?`)) return;
  try {
    await aiKnowledgeApi.deleteKnowledgeRule(rule.id);
    rules.value = rules.value.filter(r => r.id !== rule.id);
  } catch (err) {
    console.error('Lỗi khi xóa quy tắc:', err);
  }
}

function openCreateDialog() {
  editingRule.value = null;
  showRuleDialog.value = true;
}

function openEditDialog(rule: AiKnowledgeRule) {
  editingRule.value = rule;
  showRuleDialog.value = true;
}

function onRuleSaved(savedRule: AiKnowledgeRule) {
  const index = rules.value.findIndex(r => r.id === savedRule.id);
  if (index >= 0) {
    rules.value[index] = savedRule;
  } else {
    rules.value.unshift(savedRule);
  }
}

function getScopeColor(scope: KnowledgeScope) {
  if (scope === 'org') return 'info';
  if (scope === 'branch') return 'warning';
  return 'success';
}

function formatScopeLabel(rule: AiKnowledgeRule) {
  if (rule.scope === 'org') return 'Toàn hệ thống';
  if (rule.scope === 'branch') return `Chi nhánh: ${rule.branchTag || 'N/A'}`;
  const group = props.groups.find(g => g.threadId === rule.groupThreadId);
  return `Nhóm: ${group?.groupName || rule.groupThreadId || 'N/A'}`;
}

function formatCategoryLabel(cat: KnowledgeCategory) {
  const map: Record<string, string> = {
    personnel: 'Nhân sự',
    sop: 'Quy trình SOP',
    terminology: 'Thuật ngữ',
    correction: 'Đính chính',
    general: 'Quy định',
  };
  return map[cat] || cat;
}

function formatDate(str: string) {
  if (!str) return '';
  return new Date(str).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

onMounted(loadRules);
</script>

<style scoped>
.neo-card {
  border: 1.5px solid var(--border-color);
  border-radius: 12px;
}
.rule-item {
  border: 1.5px solid var(--border-color);
  border-radius: 8px;
  background: var(--v-theme-surface);
  transition: opacity 0.2s ease;
}
.rule-disabled {
  opacity: 0.55;
  background: rgba(0, 0, 0, 0.02);
}
</style>
