<template>
  <div class="api-key-table">
    <div class="d-flex justify-space-between align-center mb-4">
      <div>
        <h3 class="text-subtitle-1 font-weight-bold" style="font-family: 'Space Grotesk', sans-serif;">
          DANH SÁCH KHÓA API
        </h3>
        <p class="text-caption text-medium-emphasis mb-0">Quản lý các khóa bảo mật dùng để kết nối ZaloCRM Public REST API</p>
      </div>
      <v-btn
        color="primary"
        rounded="lg"
        elevation="0"
        prepend-icon="mdi-key-plus"
        @click="$emit('create')"
      >
        Tạo Khóa Mới
      </v-btn>
    </div>

    <v-table density="comfortable" class="neo-table">
      <thead>
          <tr>
            <th>TÊN KHÓA</th>
            <th>TIỀN TỐ (PREFIX)</th>
            <th>QUYỀN HẠN (SCOPES)</th>
            <th>GIỚI HẠN</th>
            <th>HẠN DÙNG</th>
            <th>TRẠNG THÁI</th>
            <th class="text-right">THAO TÁC</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="7" class="text-center py-6 text-medium-emphasis">
              <v-progress-circular indeterminate size="24" class="mr-2" /> Đang tải danh sách khóa...
            </td>
          </tr>
          <tr v-else-if="keys.length === 0">
            <td colspan="7" class="text-center py-6 text-medium-emphasis">
              Chưa có khóa API nào. Bấm "Tạo Khóa Mới" để bắt đầu tích hợp.
            </td>
          </tr>
          <tr v-for="key in keys" :key="key.id">
            <td class="font-weight-medium">{{ key.name }}</td>
            <td>
              <code class="neo-code">{{ key.keyPrefix }}••••</code>
              <v-btn icon="mdi-content-copy" size="x-small" variant="text" class="ml-1" @click="copyText(key.keyPrefix)" />
            </td>
            <td>
              <div class="d-flex flex-wrap gap-1">
                <v-chip
                  v-for="scope in (key.scopes || []).slice(0, 3)"
                  :key="scope"
                  size="x-small"
                  variant="outlined"
                  class="font-mono text-caption"
                >
                  {{ scope }}
                </v-chip>
                <v-chip v-if="(key.scopes || []).length > 3" size="x-small" variant="text">
                  +{{ key.scopes.length - 3 }}
                </v-chip>
              </div>
            </td>
            <td>{{ key.rateLimit }}/phút</td>
            <td class="text-caption">
              {{ key.expiresAt ? new Date(key.expiresAt).toLocaleDateString('vi-VN') : 'Vĩnh viễn' }}
            </td>
            <td>
              <v-chip
                size="small"
                :color="key.revokedAt ? 'error' : key.isActive ? 'success' : 'warning'"
                variant="flat"
                class="font-weight-bold"
              >
                {{ key.revokedAt ? 'Đã thu hồi' : key.isActive ? 'Hoạt động' : 'Tạm tắt' }}
              </v-chip>
            </td>
            <td class="text-right">
              <v-btn
                v-if="!key.revokedAt"
                :icon="key.isActive ? 'mdi-pause' : 'mdi-play'"
                size="small"
                variant="text"
                :title="key.isActive ? 'Tạm tắt' : 'Bật lại'"
                @click="toggleActive(key)"
              />
              <v-btn
                v-if="!key.revokedAt"
                icon="mdi-delete-outline"
                size="small"
                variant="text"
                color="error"
                title="Thu hồi khóa"
                @click="confirmRevoke(key)"
              />
            </td>
          </tr>
        </tbody>
      </v-table>

    <!-- Revoke Confirmation Dialog -->
    <v-dialog v-model="revokeDialog" max-width="450">
      <v-card elevation="0" class="neo-card pa-4">
        <v-card-title class="text-subtitle-1 font-weight-bold text-error">
          <v-icon icon="mdi-alert" class="mr-2" /> XÁC NHẬN THU HỒI KHÓA API
        </v-card-title>
        <v-card-text>
          Bạn có chắc chắn muốn thu hồi khóa <strong>{{ selectedKey?.name }}</strong>?
          Hành động này sẽ vô hiệu hóa khóa vĩnh viễn và không thể khôi phục lại.
        </v-card-text>
        <v-card-actions class="justify-end">
          <v-btn variant="text" rounded="lg" @click="revokeDialog = false">Hủy</v-btn>
          <v-btn color="error" rounded="lg" elevation="0" :loading="revoking" @click="executeRevoke">Thu Hồi Vĩnh Viễn</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { api } from '@/api';

const props = defineProps<{
  keys: any[];
  loading: boolean;
}>();

const emit = defineEmits<{
  (e: 'create'): void;
  (e: 'refresh'): void;
  (e: 'snack', text: string, color?: string): void;
}>();

const revokeDialog = ref(false);
const selectedKey = ref<any>(null);
const revoking = ref(false);

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
  emit('snack', 'Đã sao chép tiền tố khóa');
}

async function toggleActive(key: any) {
  try {
    await api.put(`/settings/api-keys/${key.id}`, { isActive: !key.isActive });
    emit('snack', key.isActive ? 'Đã tạm tắt khóa' : 'Đã kích hoạt khóa');
    emit('refresh');
  } catch {
    emit('snack', 'Thao tác thất bại', 'error');
  }
}

function confirmRevoke(key: any) {
  selectedKey.value = key;
  revokeDialog.value = true;
}

async function executeRevoke() {
  if (!selectedKey.value) return;
  revoking.value = true;
  try {
    await api.delete(`/settings/api-keys/${selectedKey.value.id}`);
    emit('snack', 'Đã thu hồi khóa API');
    revokeDialog.value = false;
    emit('refresh');
  } catch {
    emit('snack', 'Thu hồi khóa thất bại', 'error');
  } finally {
    revoking.value = false;
  }
}
</script>

<style scoped>
.neo-card {
  border: 1.5px solid var(--border-color);
  border-radius: 8px;
}
.neo-code {
  font-family: monospace;
  background: var(--surface-variant);
  padding: 2px 6px;
  border-radius: 4px;
}
.gap-1 {
  gap: 4px;
}
</style>
