<template>
  <v-card class="pa-4" style="border: 1.5px solid var(--border-color); border-radius: 12px;" elevation="0">
    <div class="d-flex align-center justify-space-between mb-3">
      <div>
        <h2 class="neo-subtitle font-weight-bold mb-1" style="font-size: 1.1rem;">
          TÍCH HỢP <span class="neo-title-accent">KIOTVIET</span>
        </h2>
        <p class="text-caption text-grey mb-0">
          Kết nối KiotViet Public API để đồng bộ danh mục sản phẩm và xuất hóa đơn tự động.
        </p>
      </div>
      <v-chip
        v-if="publicConfig"
        size="small"
        :color="isConfigured ? 'success' : 'default'"
        variant="flat"
        rounded="pill"
        class="neo-pill"
      >
        {{ isConfigured ? 'Đã kết nối' : 'Chưa cấu hình' }}
      </v-chip>
    </div>

    <!-- Feedback Alerts -->
    <v-alert
      v-if="errorMessage"
      type="error"
      variant="tonal"
      density="compact"
      closable
      class="mb-3 text-caption"
      @click:close="errorMessage = null"
    >
      {{ errorMessage }}
    </v-alert>

    <v-alert
      v-if="successMessage"
      type="success"
      variant="tonal"
      density="compact"
      closable
      class="mb-3 text-caption"
      @click:close="successMessage = null"
    >
      {{ successMessage }}
    </v-alert>

    <v-row dense>
      <!-- Retailer (Mã gian hàng) -->
      <v-col cols="12" sm="6">
        <v-text-field
          v-model="form.retailer"
          label="Mã gian hàng (Retailer) *"
          placeholder="Ví dụ: mykiotvietshop"
          density="compact"
          variant="outlined"
          rounded="lg"
          hide-details="auto"
          class="mb-3"
          @input="onIdentityChanged"
        />
      </v-col>

      <!-- Client ID -->
      <v-col cols="12" sm="6">
        <v-text-field
          v-model="form.clientId"
          label="Client ID *"
          placeholder="Nhập Client ID do KiotViet cấp"
          density="compact"
          variant="outlined"
          rounded="lg"
          hide-details="auto"
          class="mb-3"
          @input="onIdentityChanged"
        />
      </v-col>

      <!-- Client Secret -->
      <v-col cols="12" sm="6">
        <v-text-field
          v-model="form.clientSecret"
          label="Client Secret *"
          :placeholder="publicConfig?.secretConfigured ? '•••••••• (Đã lưu bí mật)' : 'Nhập Client Secret'"
          type="password"
          density="compact"
          variant="outlined"
          rounded="lg"
          hide-details="auto"
          class="mb-3"
          @input="onIdentityChanged"
        />
      </v-col>

      <!-- Clear secret option if configured -->
      <v-col v-if="publicConfig?.secretConfigured" cols="12" sm="6" class="d-flex align-center">
        <v-checkbox
          v-model="form.clearSecret"
          label="Xóa bí mật đã lưu (Ngắt kết nối KiotViet)"
          density="compact"
          color="error"
          hide-details
        />
      </v-col>

      <!-- Test Connection Button -->
      <v-col cols="12" class="mb-3">
        <div class="d-flex align-center" style="gap: 8px;">
          <v-btn
            color="primary"
            variant="tonal"
            rounded="lg"
            class="font-weight-bold"
            :loading="testing"
            :disabled="!form.retailer || !form.clientId"
            @click="handleTestConnection"
          >
            Kiểm tra kết nối (Draft)
          </v-btn>
          <span v-if="testSuccess" class="text-caption text-success font-weight-bold">
            ✓ Kết nối KiotViet thành công!
          </span>
        </div>
      </v-col>

      <v-divider class="my-3" />

      <!-- Branch Selection -->
      <v-col cols="12" sm="4">
        <v-select
          v-model="form.branchId"
          label="Chi nhánh làm việc *"
          :items="branches"
          item-title="name"
          item-value="id"
          density="compact"
          variant="outlined"
          rounded="lg"
          hide-details="auto"
          class="mb-3"
          :disabled="branches.length === 0"
        />
      </v-col>

      <!-- Seller Selection -->
      <v-col cols="12" sm="4">
        <v-select
          v-model="form.soldById"
          label="Nhân viên bán hàng mặc định"
          :items="sellers"
          item-title="name"
          item-value="id"
          density="compact"
          variant="outlined"
          rounded="lg"
          hide-details="auto"
          clearable
          class="mb-3"
          :disabled="sellers.length === 0"
        />
      </v-col>

      <!-- Payment Account Selection -->
      <v-col cols="12" sm="4">
        <v-select
          v-model="form.paymentAccountId"
          label="Tài khoản nhận tiền mặc định"
          :items="paymentAccounts"
          item-title="name"
          item-value="id"
          density="compact"
          variant="outlined"
          rounded="lg"
          hide-details="auto"
          clearable
          class="mb-3"
          :disabled="paymentAccounts.length === 0"
        />
      </v-col>

      <!-- Auto Sync Switch -->
      <v-col cols="12" class="mb-3">
        <v-switch
          v-model="form.autoSync"
          label="Tự động xuất khi xác nhận đơn đủ sản phẩm"
          color="primary"
          density="compact"
          hide-details
          :disabled="!form.branchId"
        />
        <div class="text-caption text-grey ml-8" style="font-size: 0.72rem;">
          Khi bật: Đơn hàng ở trạng thái "Đã xác nhận" có đầy đủ sản phẩm KiotViet hợp lệ sẽ tự động được xếp hàng xuất hóa đơn.
        </div>
      </v-col>
    </v-row>

    <!-- Save Button -->
    <div class="d-flex justify-end mt-2">
      <v-btn
        color="primary"
        rounded="lg"
        class="font-weight-bold px-6"
        style="border: 1.5px solid var(--border-color); height: 40px;"
        :loading="saving"
        @click="handleSave"
      >
        LƯU CẤU HÌNH
      </v-btn>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useKiotviet, type KiotvietPublicConfigDto } from '@/composables/use-kiotviet';

const {
  getPublicConfig,
  saveConfig,
  testConnection,
  getBranches,
  getSellers,
  getPaymentAccounts,
} = useKiotviet();

const publicConfig = ref<KiotvietPublicConfigDto | null>(null);
const saving = ref(false);
const testing = ref(false);
const testSuccess = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);

const branches = ref<Array<{ id: number; name: string }>>([]);
const sellers = ref<Array<{ id: number; name: string }>>([]);
const paymentAccounts = ref<Array<{ id: number; name: string }>>([]);

const form = reactive({
  retailer: '',
  clientId: '',
  clientSecret: '',
  clearSecret: false,
  branchId: null as number | null,
  soldById: null as number | null,
  paymentAccountId: null as number | null,
  autoSync: false,
});

const isConfigured = computed(() => {
  return publicConfig.value?.secretConfigured && !!publicConfig.value?.branchId;
});

function onIdentityChanged() {
  testSuccess.value = false;
}

async function loadConfig() {
  try {
    const pub = await getPublicConfig();
    publicConfig.value = pub;
    form.retailer = pub.retailer || '';
    form.clientId = pub.clientId || '';
    form.clientSecret = '';
    form.clearSecret = false;
    form.branchId = pub.branchId ? Number(pub.branchId) : null;
    form.soldById = pub.soldById ? Number(pub.soldById) : null;
    form.paymentAccountId = pub.paymentAccountId ? Number(pub.paymentAccountId) : null;
    form.autoSync = pub.autoSync;

    if (pub.secretConfigured) {
      await loadMetadata();
    }
  } catch (err: any) {
    console.error('Failed to load KiotViet config:', err);
  }
}

async function loadMetadata() {
  try {
    const [b, s, p] = await Promise.all([
      getBranches(),
      getSellers(),
      getPaymentAccounts(),
    ]);
    branches.value = b;
    sellers.value = s;
    paymentAccounts.value = p;
  } catch (err) {
    console.error('Failed to load KiotViet metadata:', err);
  }
}

async function handleTestConnection() {
  testing.value = true;
  testSuccess.value = false;
  errorMessage.value = null;

  try {
    const res = await testConnection({
      retailer: form.retailer.trim(),
      clientId: form.clientId.trim(),
      clientSecret: form.clientSecret ? form.clientSecret.trim() : undefined,
    });

    if (res.success) {
      testSuccess.value = true;
      // Fetch metadata for this retailer
      await loadMetadata();
    } else {
      errorMessage.value = res.message || 'Kiểm tra kết nối thất bại';
    }
  } catch (err: any) {
    errorMessage.value = err?.response?.data?.message || err?.message || 'Lỗi kiểm tra kết nối KiotViet';
  } finally {
    testing.value = false;
  }
}

async function handleSave() {
  saving.value = true;
  errorMessage.value = null;
  successMessage.value = null;

  try {
    const payload: any = {
      retailer: form.retailer.trim(),
      clientId: form.clientId.trim(),
      branchId: form.branchId ? String(form.branchId) : null,
      soldById: form.soldById ? String(form.soldById) : null,
      paymentAccountId: form.paymentAccountId ? String(form.paymentAccountId) : null,
      autoSync: form.autoSync,
    };

    if (form.clientSecret && form.clientSecret.trim()) {
      payload.clientSecret = form.clientSecret.trim();
    }
    if (form.clearSecret) {
      payload.clearSecret = true;
    }

    const expectedRevision = publicConfig.value?.configRevision;
    const res = await saveConfig(payload, expectedRevision);

    successMessage.value = 'Lưu cấu hình KiotViet thành công!';
    publicConfig.value = res.config;
    form.clientSecret = '';
    form.clearSecret = false;
  } catch (err: any) {
    errorMessage.value = err?.response?.data?.message || err?.message || 'Có lỗi xảy ra khi lưu cấu hình KiotViet';
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  loadConfig();
});
</script>

<style scoped>
</style>
