<template>
  <div class="order-items-selector">
    <div class="d-flex align-center justify-space-between mb-2">
      <span class="text-caption font-weight-bold neo-subtitle" style="font-size: 0.8rem;">
        DANH SÁCH SẢN PHẨM ({{ items.length }})
      </span>
      <span v-if="items.length > 0" class="text-caption font-weight-bold" style="color: var(--primary);">
        Tạm tính: {{ formatVND(totalAmount) }}
      </span>
    </div>

    <!-- Product Search Autocomplete -->
    <div v-if="!disabled" class="position-relative mb-3">
      <v-text-field
        v-model="searchQuery"
        placeholder="Tìm theo mã SKU, tên sản phẩm KiotViet..."
        density="compact"
        variant="outlined"
        rounded="lg"
        prepend-inner-icon="search-alt-1.svg"
        hide-details
        clearable
        :loading="searching"
        @input="onSearchInput"
        @focus="showDropdown = true"
      />

      <!-- Search Results Dropdown -->
      <div
        v-if="showDropdown && (searchResults.length > 0 || searching || searchError)"
        class="search-dropdown pa-2 mt-1 elevation-2"
      >
        <div v-if="searching" class="text-caption text-grey pa-2 text-center">
          Đang tìm kiếm...
        </div>
        <div v-else-if="searchError" class="text-caption text-error pa-2 text-center">
          {{ searchError }}
        </div>
        <div v-else-if="searchResults.length === 0" class="text-caption text-grey pa-2 text-center">
          Không tìm thấy sản phẩm phù hợp
        </div>
        <div
          v-for="p in searchResults"
          :key="p.id"
          class="product-result-item pa-2 d-flex align-center justify-space-between"
          :class="{ 'product-disabled': p.productType !== 'normal' || p.hasSerial || p.hasBatch }"
          @click="selectProduct(p)"
        >
          <div class="flex-grow-1 pr-2">
            <div class="d-flex align-center" style="gap: 6px;">
              <span class="font-mono text-caption font-weight-bold">{{ p.code }}</span>
              <v-chip
                v-if="p.productType !== 'normal' || p.hasSerial || p.hasBatch"
                size="x-small"
                color="warning"
                variant="flat"
              >
                Không hỗ trợ v1
              </v-chip>
            </div>
            <div class="text-body-2 text-truncate" style="max-width: 320px;">{{ p.name }}</div>
            <div class="text-caption text-grey">
              {{ p.unit || 'Cái' }} · Tồn: <strong>{{ p.onHand }}</strong>
            </div>
          </div>
          <div class="text-right flex-shrink-0">
            <div class="font-weight-bold text-body-2">{{ formatVND(p.price) }}</div>
            <v-btn
              size="x-small"
              color="primary"
              variant="tonal"
              :disabled="p.productType !== 'normal' || p.hasSerial || p.hasBatch"
            >
              + Thêm
            </v-btn>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-if="items.length === 0"
      class="text-center text-caption text-grey pa-4 mb-3"
      style="border: 1.5px dashed var(--border-color); border-radius: 8px; background: var(--surface-variant);"
    >
      Chưa có sản phẩm. Tìm kiếm sản phẩm KiotViet ở trên để thêm vào đơn.
    </div>

    <!-- Items Table -->
    <div v-else class="items-table mb-3">
      <div
        v-for="(item, idx) in items"
        :key="item.kiotvietProductId + '-' + idx"
        class="item-row pa-2 mb-2"
      >
        <div class="d-flex align-start justify-space-between mb-1">
          <div>
            <span class="font-mono text-caption font-weight-bold text-primary">{{ item.productCode }}</span>
            <span class="text-caption font-weight-bold ml-1">{{ item.productName }}</span>
            <span v-if="item.unit" class="text-caption text-grey ml-1">({{ item.unit }})</span>
          </div>
          <v-btn
            v-if="!disabled"
            icon
            size="x-small"
            variant="text"
            color="error"
            @click="removeItem(idx)"
          >
            <v-icon size="14">trash-xmark-alt.svg</v-icon>
          </v-btn>
        </div>

        <div class="d-flex flex-wrap align-center justify-space-between mt-1" style="gap: 8px;">
          <!-- Quantity Controls -->
          <div class="d-flex align-center" style="gap: 4px;">
            <span class="text-caption text-grey mr-1">SL:</span>
            <v-btn
              v-if="!disabled"
              size="x-small"
              icon
              variant="outlined"
              :disabled="item.quantity <= 1"
              @click="updateQuantity(idx, item.quantity - 1)"
            >
              -
            </v-btn>
            <input
              type="number"
              class="qty-input"
              :value="item.quantity"
              :disabled="disabled"
              min="1"
              @change="(e: any) => updateQuantity(idx, Number(e.target.value))"
            />
            <v-btn
              v-if="!disabled"
              size="x-small"
              icon
              variant="outlined"
              @click="updateQuantity(idx, item.quantity + 1)"
            >
              +
            </v-btn>
          </div>

          <!-- Price & Discount -->
          <div class="d-flex align-center flex-wrap" style="gap: 8px;">
            <!-- Price (Editable if Admin) -->
            <div class="d-flex align-center" style="gap: 4px;">
              <span class="text-caption text-grey">Đơn giá:</span>
              <input
                v-if="isAdmin && !disabled"
                type="number"
                class="price-input"
                :value="item.price"
                @change="(e: any) => updatePrice(idx, Number(e.target.value))"
              />
              <span v-else class="text-caption font-weight-bold">{{ formatVND(item.price) }}</span>
            </div>

            <!-- Discount (Admin only) -->
            <div v-if="isAdmin && !disabled" class="d-flex align-center" style="gap: 4px;">
              <span class="text-caption text-grey">CK:</span>
              <select
                class="discount-mode-select"
                :value="item.discountMode"
                @change="(e: any) => updateDiscountMode(idx, e.target.value)"
              >
                <option value="amount">đ</option>
                <option value="percent">%</option>
              </select>
              <input
                type="number"
                class="discount-input"
                :value="item.discountInput"
                min="0"
                @change="(e: any) => updateDiscountInput(idx, Number(e.target.value))"
              />
            </div>
            <div v-else-if="item.discountAmount > 0" class="text-caption text-error">
              -{{ formatVND(item.discountAmount) }}
            </div>
          </div>

          <!-- Line Subtotal -->
          <div class="font-weight-bold text-caption text-right ml-auto">
            Thành tiền: <span style="color: var(--primary);">{{ formatVND(item.subtotal) }}</span>
          </div>
        </div>

        <!-- Line Note -->
        <div v-if="!disabled" class="mt-1">
          <input
            type="text"
            class="note-input"
            placeholder="Ghi chú món / yêu cầu thêm..."
            :value="item.note || ''"
            @change="(e: any) => updateNote(idx, e.target.value)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { OrderItem } from '@/composables/use-orders';
import { useKiotviet, type KiotvietProductDto } from '@/composables/use-kiotviet';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{
  modelValue: OrderItem[];
  disabled?: boolean;
  branchId?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [items: OrderItem[]];
  'update:total': [total: number];
}>();

const authStore = useAuthStore();
const isAdmin = computed(() => authStore.isAdmin);

const { searchProducts } = useKiotviet();

const items = ref<OrderItem[]>([...props.modelValue]);
const searchQuery = ref('');
const searchResults = ref<KiotvietProductDto[]>([]);
const searching = ref(false);
const searchError = ref<string | null>(null);
const showDropdown = ref(false);
let searchDebounceTimer: any = null;

watch(
  () => props.modelValue,
  (newItems) => {
    items.value = [...newItems];
  },
  { deep: true }
);

const totalAmount = computed(() => {
  return items.value.reduce((sum, item) => sum + item.subtotal, 0);
});

function formatVND(n: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
}

function calculateItemSubtotal(
  quantity: number,
  price: number,
  discountMode: 'amount' | 'percent' = 'amount',
  discountInput = 0
): { discountAmount: number; subtotal: number } {
  const gross = quantity * price;
  let discountAmount = 0;
  if (discountMode === 'percent') {
    const clamped = Math.min(Math.max(0, discountInput), 100);
    discountAmount = Math.round((gross * clamped) / 100);
  } else {
    discountAmount = Math.min(Math.max(0, discountInput), gross);
  }
  const subtotal = Math.max(0, Math.round(gross - discountAmount));
  return { discountAmount, subtotal };
}

function emitChanges() {
  emit('update:modelValue', [...items.value]);
  emit('update:total', totalAmount.value);
}

function onSearchInput() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  const q = searchQuery.value.trim();
  if (!q) {
    searchResults.value = [];
    searching.value = false;
    return;
  }

  searchDebounceTimer = setTimeout(async () => {
    searching.value = true;
    searchError.value = null;
    try {
      searchResults.value = await searchProducts(q, props.branchId, 20);
      showDropdown.value = true;
    } catch (err: any) {
      if (err?.name !== 'CanceledError') {
        searchError.value = 'Lỗi tìm kiếm sản phẩm KiotViet';
      }
    } finally {
      searching.value = false;
    }
  }, 200);
}

function selectProduct(p: KiotvietProductDto) {
  if (p.productType !== 'normal' || p.hasSerial || p.hasBatch) {
    return;
  }

  // Check if product already exists in item list
  const existingIdx = items.value.findIndex(item => item.kiotvietProductId === p.kiotvietId);
  if (existingIdx !== -1) {
    updateQuantity(existingIdx, items.value[existingIdx].quantity + 1);
  } else {
    const price = Number(p.price);
    const { discountAmount, subtotal } = calculateItemSubtotal(1, price, 'amount', 0);
    items.value.push({
      productId: p.id,
      kiotvietProductId: p.kiotvietId,
      branchId: p.branchId,
      productCode: p.code,
      productName: p.name,
      unit: p.unit,
      quantity: 1,
      price,
      discountMode: 'amount',
      discountInput: 0,
      discountAmount,
      subtotal,
      productType: p.productType,
      note: null,
    });
    emitChanges();
  }

  searchQuery.value = '';
  searchResults.value = [];
  showDropdown.value = false;
}

function updateQuantity(idx: number, qty: number) {
  if (qty < 1) return;
  const item = items.value[idx];
  item.quantity = qty;
  const { discountAmount, subtotal } = calculateItemSubtotal(
    item.quantity,
    item.price,
    item.discountMode,
    item.discountInput
  );
  item.discountAmount = discountAmount;
  item.subtotal = subtotal;
  emitChanges();
}

function updatePrice(idx: number, price: number) {
  if (price < 0) return;
  const item = items.value[idx];
  item.price = price;
  const { discountAmount, subtotal } = calculateItemSubtotal(
    item.quantity,
    item.price,
    item.discountMode,
    item.discountInput
  );
  item.discountAmount = discountAmount;
  item.subtotal = subtotal;
  emitChanges();
}

function updateDiscountMode(idx: number, mode: 'amount' | 'percent') {
  const item = items.value[idx];
  item.discountMode = mode;
  const { discountAmount, subtotal } = calculateItemSubtotal(
    item.quantity,
    item.price,
    item.discountMode,
    item.discountInput
  );
  item.discountAmount = discountAmount;
  item.subtotal = subtotal;
  emitChanges();
}

function updateDiscountInput(idx: number, discountInput: number) {
  if (discountInput < 0) return;
  const item = items.value[idx];
  item.discountInput = discountInput;
  const { discountAmount, subtotal } = calculateItemSubtotal(
    item.quantity,
    item.price,
    item.discountMode,
    item.discountInput
  );
  item.discountAmount = discountAmount;
  item.subtotal = subtotal;
  emitChanges();
}

function updateNote(idx: number, note: string) {
  items.value[idx].note = note.trim() || null;
  emitChanges();
}

function removeItem(idx: number) {
  items.value.splice(idx, 1);
  emitChanges();
}
</script>

<style scoped>
.order-items-selector {
  width: 100%;
}

.search-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 100;
  max-height: 280px;
  overflow-y: auto;
  background: var(--surface-card, #ffffff);
  border: 1.5px solid var(--border-color);
  border-radius: 8px;
}

.product-result-item {
  border-radius: 6px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-color);
}

.product-result-item:last-child {
  border-bottom: none;
}

.product-result-item:hover:not(.product-disabled) {
  background: var(--surface-variant, #f5f5f5);
}

.product-disabled {
  opacity: 0.6;
  cursor: not-allowed;
  background: rgba(0, 0, 0, 0.03);
}

.item-row {
  border: 1.5px solid var(--border-color);
  border-radius: 8px;
  background: var(--surface-card, #ffffff);
}

.qty-input {
  width: 48px;
  text-align: center;
  border: 1.5px solid var(--border-color);
  border-radius: 6px;
  padding: 2px 4px;
  font-size: 0.8rem;
  font-weight: bold;
}

.price-input {
  width: 90px;
  border: 1.5px solid var(--border-color);
  border-radius: 6px;
  padding: 2px 4px;
  font-size: 0.8rem;
}

.discount-input {
  width: 60px;
  border: 1.5px solid var(--border-color);
  border-radius: 6px;
  padding: 2px 4px;
  font-size: 0.8rem;
}

.discount-mode-select {
  border: 1.5px solid var(--border-color);
  border-radius: 6px;
  padding: 2px 4px;
  font-size: 0.8rem;
  background: var(--surface-card);
}

.note-input {
  width: 100%;
  border: 1px dashed var(--border-color);
  border-radius: 6px;
  padding: 2px 6px;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.font-mono {
  font-family: monospace;
}
</style>
