<template>
  <v-card class="pa-5 mb-4 chart-card neo-card" elevation="0">
    <div class="d-flex align-center justify-space-between flex-wrap gap-2 mb-3">
      <h2 class="text-subtitle-1 font-weight-bold d-flex align-center">
        <v-icon color="primary" class="mr-2">mdi-robot-outline</v-icon>
        Cấu Hình AI Provider & Dự Phòng (Failover)
      </h2>
      <v-chip v-if="settings.isSystemDefault" size="x-small" color="info" variant="flat" class="font-weight-bold">
        <v-icon start size="14">auto.svg</v-icon>
        Đang dùng cấu hình mặc định (.env)
      </v-chip>
    </div>

    <!-- Provider Selection Tabs -->
    <v-tabs v-model="selectedTab" density="compact" color="primary" class="mb-4 neo-tabs" grow>
      <v-tab value="deepseek">
        <v-icon start>deepseek.svg</v-icon>
        DeepSeek
        <v-chip v-if="settings.primaryProvider === 'deepseek'" size="x-small" color="primary" variant="flat" class="ml-1 font-weight-bold">CHÍNH</v-chip>
      </v-tab>
      <v-tab value="gemini">
        <v-icon start>gemini.svg</v-icon>
        Gemini
        <v-chip v-if="settings.primaryProvider === 'gemini'" size="x-small" color="primary" variant="flat" class="ml-1 font-weight-bold">CHÍNH</v-chip>
      </v-tab>
      <v-tab value="openai">
        <v-icon start>openai.svg</v-icon>
        OpenAI
        <v-chip v-if="settings.primaryProvider === 'openai'" size="x-small" color="primary" variant="flat" class="ml-1 font-weight-bold">CHÍNH</v-chip>
      </v-tab>
      <v-tab value="custom">
        <v-icon start>auto.svg</v-icon>
        Custom
        <v-chip v-if="settings.primaryProvider === 'custom'" size="x-small" color="primary" variant="flat" class="ml-1 font-weight-bold">CHÍNH</v-chip>
      </v-tab>
    </v-tabs>

    <div class="d-flex align-center justify-space-between gap-2 mb-3 flex-wrap">
      <v-radio-group v-model="settings.primaryProvider" inline hide-details density="compact">
        <span class="text-caption font-weight-bold mr-2">Nhà cung cấp chính:</span>
        <v-radio label="DeepSeek" value="deepseek" density="compact" />
        <v-radio label="Gemini" value="gemini" density="compact" />
        <v-radio label="OpenAI" value="openai" density="compact" />
        <v-radio label="Custom" value="custom" density="compact" />
      </v-radio-group>
      <v-btn
        v-if="canSetAsPrimary"
        size="small"
        color="warning"
        variant="tonal"
        prepend-icon="mdi-lightning-bolt"
        class="font-weight-bold"
        @click="setAsPrimary(selectedTab)"
      >
        ⚡ Đặt {{ getProviderLabel(selectedTab) }} làm nhà cung cấp chính
      </v-btn>
    </div>

    <!-- Active Provider Config -->
    <v-row dense>
      <v-col cols="12" md="6">
        <v-combobox
          v-model="currentProvider.model"
          :items="availableModelSuggestions"
          label="Mô hình (Model)"
          density="compact"
          variant="outlined"
          placeholder="Nhập hoặc chọn tên model"
          :loading="isFetchingModels"
          :hint="modelHint"
          persistent-hint
          @focus="onModelFocus"
          @click="onModelFocus"
        >
          <template #append-inner>
            <v-tooltip location="top" text="Tải danh sách model từ API">
              <template #activator="{ props: tooltipProps }">
                <v-btn
                  v-bind="tooltipProps"
                  icon="mdi-refresh"
                  variant="text"
                  size="small"
                  density="compact"
                  :loading="isFetchingModels"
                  :disabled="!hasApiKeyConfigured"
                  @click.stop="fetchModels"
                />
              </template>
            </v-tooltip>
          </template>
        </v-combobox>
      </v-col>
      <v-col cols="12" md="6">
        <v-text-field
          v-model="currentProvider.apiKey"
          :type="showApiKey ? 'text' : 'password'"
          label="API Key"
          :placeholder="currentProvider.apiKeySet ? '(Đã lưu khóa bảo mật — nhập lại nếu muốn đổi)' : 'Nhập API key'"
          :append-inner-icon="showApiKey ? 'mdi-eye-off' : 'mdi-eye'"
          density="compact"
          variant="outlined"
          @click:append-inner="showApiKey = !showApiKey"
        />
      </v-col>
      <v-col v-if="selectedTab === 'custom' || selectedTab === 'deepseek'" cols="12">
        <v-text-field
          v-model="currentProvider.baseUrl"
          label="Base URL API"
          placeholder="https://api.deepseek.com hoặc https://your-gateway.com/v1"
          density="compact"
          variant="outlined"
          hint="Bắt buộc HTTPS công khai, trừ khi máy chủ bật ALLOW_PRIVATE_AI_GATEWAYS"
          persistent-hint
        />
      </v-col>
    </v-row>

    <!-- Test Connection & Save Config Actions -->
    <div class="d-flex align-center justify-space-between flex-wrap gap-2 mt-2 mb-3">
      <div class="d-flex align-center gap-2 flex-wrap">
        <v-btn
          size="small"
          variant="outlined"
          color="primary"
          prepend-icon="mdi-connection"
          :loading="isTesting"
          @click="runTestConnection"
        >
          Kiểm tra kết nối
        </v-btn>
        <v-chip v-if="testResult" size="small" :color="testResult.success ? 'success' : 'error'" variant="flat">
          {{ testResult.success ? `✓ Thành công (${testResult.latencyMs}ms)` : `✗ Lỗi: ${testResult.message}` }}
        </v-chip>
        <v-btn
          v-if="testResult?.success && settings.primaryProvider !== selectedTab"
          size="x-small"
          color="warning"
          variant="flat"
          prepend-icon="mdi-lightning-bolt"
          class="font-weight-bold"
          @click="setAsPrimary(selectedTab)"
        >
          Đặt {{ getProviderLabel(selectedTab) }} làm chính ngay
        </v-btn>
      </div>

      <v-btn
        size="small"
        color="primary"
        variant="flat"
        prepend-icon="mdi-content-save"
        :loading="isSaving"
        @click="emit('save')"
      >
        Lưu Cấu Hình AI
      </v-btn>
    </div>

    <v-divider class="my-3" />

    <!-- Failover Chain Configuration -->
    <div class="d-flex align-center justify-space-between flex-wrap gap-2 mb-2">
      <v-switch
        v-model="settings.fallbackEnabled"
        color="primary"
        label="Tự động chuyển sang Model dự phòng khi gặp sự cố (Failover)"
        hide-details
        density="compact"
      />
    </div>

    <div v-if="settings.fallbackEnabled" class="my-2 d-flex align-center gap-1 flex-wrap">
      <span class="text-caption text-medium-emphasis mr-1">Thứ tự dự phòng:</span>
      <v-chip
        v-for="p in settings.fallbackChain"
        :key="p"
        size="x-small"
        variant="tonal"
        color="secondary"
        class="font-weight-medium text-capitalize"
      >
        {{ p }}
      </v-chip>
    </div>

    <v-checkbox
      v-if="settings.fallbackEnabled"
      v-model="settings.allowSystemFallback"
      label="Cho phép sử dụng khóa dự phòng mặc định của hệ thống (.env) khi gặp sự cố"
      hide-details
      density="compact"
      color="primary"
    />
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { aiReportApi, type AiProviderSettings, type TestAiResult, type AiProviderDetail } from '@/api/ai-report-api';
import { ALL_AI_PROVIDERS, DEFAULT_AI_PROVIDERS, MODEL_SUGGESTIONS, computeFallbackChain } from '@/api/ai-report-view-helpers';

const props = defineProps<{
  isSaving?: boolean;
}>();

const emit = defineEmits<{
  (e: 'save'): void;
}>();

const settings = defineModel<AiProviderSettings>({ required: true });

const selectedTab = ref<'deepseek' | 'gemini' | 'openai' | 'custom'>('deepseek');
const showApiKey = ref(false);
const isTesting = ref(false);
const testResult = ref<TestAiResult | null>(null);

// Pure computed property: guarantees no mutations inside getter
const currentProvider = computed<AiProviderDetail>(() => {
  return settings.value?.providers?.[selectedTab.value] ?? DEFAULT_AI_PROVIDERS[selectedTab.value];
});

const currentPrimaryConfig = computed(() => {
  const prim = settings.value?.primaryProvider || 'deepseek';
  return settings.value?.providers?.[prim];
});

const isCurrentPrimaryUnset = computed(() => {
  return !currentPrimaryConfig.value?.apiKey && !currentPrimaryConfig.value?.apiKeySet;
});

const canSetAsPrimary = computed(() => {
  return (
    selectedTab.value !== settings.value?.primaryProvider &&
    Boolean(currentProvider.value?.apiKey || currentProvider.value?.apiKeySet)
  );
});

function getProviderLabel(tab: string) {
  switch (tab) {
    case 'deepseek': return 'DeepSeek';
    case 'gemini': return 'Gemini';
    case 'openai': return 'OpenAI';
    default: return 'Custom';
  }
}

function setAsPrimary(tab: 'deepseek' | 'gemini' | 'openai' | 'custom') {
  if (settings.value) {
    settings.value.primaryProvider = tab;
  }
}

// Auto-switch primary provider if current primary has no key configured
watch(
  () => currentProvider.value.apiKey,
  (newKey) => {
    if (newKey && isCurrentPrimaryUnset.value && selectedTab.value !== settings.value?.primaryProvider) {
      if (settings.value) {
        settings.value.primaryProvider = selectedTab.value;
      }
    }
    if (newKey && newKey.trim().length > 8 && !newKey.includes('••••')) {
      fetchModels();
    }
  }
);

// Update fallback chain only when the user explicitly changes the primary provider
watch(
  () => settings.value?.primaryProvider,
  (newPrimary, oldPrimary) => {
    if (newPrimary && oldPrimary && newPrimary !== oldPrimary && settings.value) {
      settings.value.fallbackChain = computeFallbackChain(newPrimary);
    }
  }
);

// Ensure all providers are initialized safely once upon setup
function ensureAllProviders() {
  if (!settings.value) return;
  if (!settings.value.providers) settings.value.providers = {};
  for (const p of ALL_AI_PROVIDERS) {
    if (!settings.value.providers[p]) {
      settings.value.providers[p] = { ...DEFAULT_AI_PROVIDERS[p] };
    }
  }
}
ensureAllProviders();

async function runTestConnection() {
  isTesting.value = true;
  testResult.value = null;
  try {
    const res = await aiReportApi.testAiConnection({
      type: selectedTab.value,
      model: currentProvider.value.model,
      apiKey: currentProvider.value.apiKey,
      baseUrl: currentProvider.value.baseUrl,
      supportsVision: currentProvider.value.supportsVision,
    });
    testResult.value = res;
    if (res.success) {
      fetchModels();
    }
  } catch (err: any) {
    testResult.value = {
      success: false,
      latencyMs: 0,
      message: err?.response?.data?.error || err?.message || 'Kết nối thất bại',
      modelName: currentProvider.value.model,
    };
  } finally {
    isTesting.value = false;
  }
}

const dynamicModels = ref<Record<string, string[]>>({});
const isFetchingModels = ref(false);
const fetchModelError = ref<string | null>(null);

const hasApiKeyConfigured = computed(() => {
  return Boolean(currentProvider.value?.apiKey || currentProvider.value?.apiKeySet);
});

const availableModelSuggestions = computed<string[]>(() => {
  const defaults = MODEL_SUGGESTIONS[selectedTab.value] || [];
  const dynamic = dynamicModels.value[selectedTab.value] || [];
  return Array.from(new Set([...defaults, ...dynamic]));
});

const modelHint = computed(() => {
  if (fetchModelError.value) {
    return `⚠️ ${fetchModelError.value}`;
  }
  if (selectedTab.value === 'deepseek') {
    return 'Official DeepSeek: deepseek-flash & deepseek-v4-pro (hỗ trợ Native Multimodal Vision). Tự động tải từ Base URL.';
  }
  if (selectedTab.value === 'custom') {
    return 'Hỗ trợ bất kỳ OpenAI-compatible gateway nào. Tự động tải model từ Base URL.';
  }
  return 'Danh sách mô hình tự động cập nhật từ Base URL nhà cung cấp khi chọn.';
});

async function fetchModels() {
  if (!hasApiKeyConfigured.value) return;
  isFetchingModels.value = true;
  fetchModelError.value = null;
  try {
    const res = await aiReportApi.fetchProviderModels({
      type: selectedTab.value,
      apiKey: currentProvider.value.apiKey,
      baseUrl: currentProvider.value.baseUrl,
    });
    if (res.models && res.models.length > 0) {
      dynamicModels.value[selectedTab.value] = res.models;
      if (!currentProvider.value.model) {
        currentProvider.value.model = res.models[0];
      }
    }
  } catch (err: any) {
    fetchModelError.value = err?.response?.data?.error || err?.message || 'Không thể tải danh sách model';
  } finally {
    isFetchingModels.value = false;
  }
}

async function onModelFocus() {
  if (hasApiKeyConfigured.value && !isFetchingModels.value && !dynamicModels.value[selectedTab.value]?.length) {
    await fetchModels();
  }
}

watch(selectedTab, (newTab) => {
  fetchModelError.value = null;
  if (hasApiKeyConfigured.value && !dynamicModels.value[newTab]?.length) {
    fetchModels();
  }
});

onMounted(() => {
  if (hasApiKeyConfigured.value) {
    fetchModels();
  }
});
</script>

<style scoped>
.neo-card {
  border: 1.5px solid var(--border-color);
  border-radius: 8px;
}
.neo-tabs {
  border-bottom: 1px solid var(--border-color);
}
</style>
