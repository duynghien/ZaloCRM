<template>
  <div class="kiotviet-customer-picker">
    <div class="d-flex align-center justify-space-between mb-2">
      <span class="text-caption font-weight-bold neo-subtitle" style="font-size: 0.8rem;">
        KHÁCH HÀNG KIOTVIET
      </span>
      <span v-if="selectedCustomer" class="text-caption text-success font-weight-bold">
        ✓ Đã liên kết: {{ selectedCustomer.name }} ({{ selectedCustomer.code }})
      </span>
    </div>

    <!-- Selected Customer Card -->
    <div
      v-if="selectedCustomer"
      class="pa-2 mb-2 d-flex align-center justify-space-between"
      style="border: 1.5px solid var(--border-color); border-radius: 8px; background: var(--surface-variant);"
    >
      <div>
        <div class="text-caption font-weight-bold">{{ selectedCustomer.name }}</div>
        <div class="text-caption text-grey">
          Mã KH: <strong class="font-mono">{{ selectedCustomer.code }}</strong> · SĐT: {{ selectedCustomer.contactNumber || '—' }}
        </div>
      </div>
      <v-btn
        v-if="!disabled"
        size="x-small"
        variant="text"
        color="error"
        @click="clearSelected"
      >
        Thay đổi
      </v-btn>
    </div>

    <!-- Search / Picker when not selected -->
    <div v-else-if="!disabled">
      <div class="d-flex align-center mb-2" style="gap: 8px;">
        <v-text-field
          v-model="searchPhone"
          label="Tìm khách hàng theo SĐT KiotViet"
          placeholder="Nhập SĐT khách hàng..."
          density="compact"
          variant="outlined"
          rounded="lg"
          hide-details
          :loading="searching"
          @keyup.enter="search"
        />
        <v-btn
          color="primary"
          rounded="lg"
          density="compact"
          class="font-weight-bold"
          style="border: 1.5px solid var(--border-color); height: 40px;"
          :loading="searching"
          @click="search"
        >
          Tìm
        </v-btn>
      </div>

      <!-- Multiple Candidates Disambiguation -->
      <div
        v-if="candidates.length > 1"
        class="pa-2 mb-2"
        style="border: 1.5px solid var(--border-color); border-radius: 8px; background: var(--surface-card);"
      >
        <div class="text-caption font-weight-bold text-warning mb-1">
          Tìm thấy nhiều khách hàng có cùng SĐT. Vui lòng chọn một khách hàng:
        </div>
        <v-radio-group v-model="selectedCandidateId" density="compact" hide-details>
          <v-radio
            v-for="c in candidates"
            :key="c.id"
            :value="c.id"
            :label="`${c.name} (${c.code}) - ${c.contactNumber || 'Không có SĐT'}`"
          />
        </v-radio-group>
        <v-btn
          size="x-small"
          color="primary"
          rounded="lg"
          class="mt-2 font-weight-bold"
          :disabled="!selectedCandidateId"
          @click="confirmCandidate"
        >
          Chọn khách hàng này
        </v-btn>
      </div>

      <!-- 0 Candidates Found: Offer Create New or Retail -->
      <div
        v-if="searched && candidates.length === 0"
        class="pa-2 mb-2 text-center"
        style="border: 1px dashed var(--border-color); border-radius: 8px; background: var(--surface-variant);"
      >
        <div class="text-caption text-grey mb-2">
          Không tìm thấy khách hàng nào với SĐT này trên KiotViet.
        </div>
        <div class="d-flex justify-center" style="gap: 8px;">
          <v-btn
            size="x-small"
            color="primary"
            variant="tonal"
            rounded="lg"
            @click="showCreateForm = true"
          >
            + Tạo khách mới trên KiotViet
          </v-btn>
          <v-btn
            size="x-small"
            variant="outlined"
            rounded="lg"
            @click="proceedAsRetail"
          >
            Xuất dạng khách lẻ
          </v-btn>
        </div>
      </div>

      <!-- Quick Create Form -->
      <div
        v-if="showCreateForm"
        class="pa-3 mb-2"
        style="border: 1.5px solid var(--border-color); border-radius: 8px; background: var(--surface-card);"
      >
        <div class="text-caption font-weight-bold mb-2">Tạo khách hàng mới trên KiotViet:</div>
        <v-text-field
          v-model="newCustomerName"
          label="Tên khách hàng"
          density="compact"
          variant="outlined"
          rounded="lg"
          hide-details
          class="mb-2"
        />
        <v-text-field
          v-model="newCustomerPhone"
          label="Số điện thoại"
          density="compact"
          variant="outlined"
          rounded="lg"
          hide-details
          class="mb-2"
        />
        <v-text-field
          v-model="newCustomerAddress"
          label="Địa chỉ (tùy chọn)"
          density="compact"
          variant="outlined"
          rounded="lg"
          hide-details
          class="mb-2"
        />
        <div class="d-flex justify-end" style="gap: 6px;">
          <v-btn size="x-small" variant="text" @click="showCreateForm = false">Hủy</v-btn>
          <v-btn
            size="x-small"
            color="primary"
            rounded="lg"
            class="font-weight-bold"
            :loading="creating"
            :disabled="!newCustomerName || !newCustomerPhone"
            @click="submitCreate"
          >
            Tạo & Chọn
          </v-btn>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useKiotviet, type KiotvietCustomerDto } from '@/composables/use-kiotviet';

const props = defineProps<{
  modelValue: string | null;
  phone?: string | null;
  name?: string | null;
  branchId?: number | string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [id: string | null];
  'customer-selected': [customer: KiotvietCustomerDto | null];
}>();

const { searchCustomers, createCustomer } = useKiotviet();

const searchPhone = ref(props.phone || '');
const searching = ref(false);
const searched = ref(false);
const candidates = ref<KiotvietCustomerDto[]>([]);
const selectedCandidateId = ref<string | null>(null);
const selectedCustomer = ref<KiotvietCustomerDto | null>(null);

const showCreateForm = ref(false);
const newCustomerName = ref(props.name || '');
const newCustomerPhone = ref(props.phone || '');
const newCustomerAddress = ref('');
const creating = ref(false);

watch(
  () => props.phone,
  (newPhone) => {
    if (newPhone && !selectedCustomer.value) {
      searchPhone.value = newPhone;
      newCustomerPhone.value = newPhone;
    }
  }
);

watch(
  () => props.name,
  (newName) => {
    if (newName) {
      newCustomerName.value = newName;
    }
  }
);

async function search() {
  const p = searchPhone.value.trim().replace(/\D/g, '');
  if (!p) return;

  searching.value = true;
  searched.value = true;
  candidates.value = [];
  selectedCandidateId.value = null;

  try {
    const results = await searchCustomers(p);
    candidates.value = results;
    if (results.length === 1) {
      // Auto-select single match
      selectCustomer(results[0]);
    }
  } catch (err) {
    console.error('Customer search error:', err);
  } finally {
    searching.value = false;
  }
}

function selectCustomer(c: KiotvietCustomerDto) {
  selectedCustomer.value = c;
  candidates.value = [];
  emit('update:modelValue', c.id);
  emit('customer-selected', c);
}

function confirmCandidate() {
  const found = candidates.value.find(c => c.id === selectedCandidateId.value);
  if (found) {
    selectCustomer(found);
  }
}

function clearSelected() {
  selectedCustomer.value = null;
  emit('update:modelValue', null);
  emit('customer-selected', null);
}

function proceedAsRetail() {
  clearSelected();
  searched.value = false;
}

async function submitCreate() {
  if (!newCustomerName.value || !newCustomerPhone.value) return;
  creating.value = true;
  try {
    const created = await createCustomer({
      name: newCustomerName.value.trim(),
      contactNumber: newCustomerPhone.value.trim(),
      branchId: Number(props.branchId || 0),
      address: newCustomerAddress.value.trim() || undefined,
    });
    if (created) {
      selectCustomer(created);
      showCreateForm.value = false;
    }
  } catch (err) {
    console.error('Customer creation error:', err);
  } finally {
    creating.value = false;
  }
}

onMounted(() => {
  if (props.phone && !props.modelValue) {
    search();
  }
});
</script>

<style scoped>
.kiotviet-customer-picker {
  width: 100%;
}

.font-mono {
  font-family: monospace;
}
</style>
