<template>
  <div>
    <!-- Page Header CQA Style -->
    <div class="d-flex flex-wrap align-center justify-space-between mb-4" style="gap: 12px;">
      <div>
        <h1 class="neo-page-title mb-1" style="font-size: 1.75rem;">
          KÊNH <span class="neo-title-accent">ZALO CHAT</span>
        </h1>
        <p class="text-caption neo-subtitle" style="color: var(--text-muted);">
          QUẢN LÝ KẾT NỐI VÀ ĐỒNG BỘ CÁC TÀI KHOẢN ZALO CÁ NHÂN.
        </p>
      </div>

      <v-btn
        v-if="authStore.isAdmin"
        color="primary"
        rounded="lg"
        prepend-icon="plus-large.svg"
        class="font-weight-bold text-white px-4"
        style="border: 1.5px solid var(--border-color); font-family: 'Space Grotesk', sans-serif; height: 38px;"
        @click="showAddDialog = true"
      >
        KẾT NỐI TÀI KHOẢN
      </v-btn>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <!-- Empty State: Centered 12px card -->
    <div v-if="!loading && accounts.length === 0" class="d-flex justify-center my-8">
      <v-card class="text-center pa-8 empty-state-card" elevation="0" style="max-width: 520px; border: 1.5px solid var(--border-color); border-radius: 12px;">
        <div
          class="mx-auto mb-4 d-flex align-center justify-center neo-icon-box"
          style="width: 64px; height: 64px; background: #0068FF; color: #FFFFFF; border: 1.5px solid var(--border-color); border-radius: 8px;"
        >
          <v-icon size="36" color="#FFFFFF">zalo.svg</v-icon>
        </div>
        <h2 class="neo-page-title mb-2" style="font-size: 1.25rem;">
          CHƯA CÓ KÊNH ZALO NÀO
        </h2>
        <p class="text-body-2 text-muted mb-6">
          Kết nối tài khoản Zalo cá nhân đầu tiên để kích hoạt đồng bộ tin nhắn, quản lý khách hàng và gửi báo cáo tự động.
        </p>
        <v-btn
          v-if="authStore.isAdmin"
          color="primary"
          size="large"
          rounded="lg"
          class="font-weight-bold px-6"
          style="border: 1.5px solid var(--border-color); font-family: 'Space Grotesk', sans-serif;"
          @click="showAddDialog = true"
        >
          <v-icon start>plus-large.svg</v-icon>
          + KẾT NỐI TÀI KHOẢN ĐẦU TIÊN
        </v-btn>
      </v-card>
    </div>

    <!-- 2-Column Channel Cards Grid -->
    <v-row v-else-if="accounts.length > 0">
      <v-col
        v-for="acc in accounts"
        :key="acc.id"
        cols="12"
        md="6"
      >
        <ZaloAccountCard
          :account="acc"
          :syncing="syncing === acc.id"
          :is-admin="authStore.isAdmin"
          @sync="syncContacts"
          @login="loginAccount"
          @reconnect="reconnectAccount"
          @access="openAccess"
          @edit="openEdit"
          @delete="confirmDelete"
        />
      </v-col>
    </v-row>

    <!-- Add account dialog -->
    <ZaloAccountAddDialog
      v-if="authStore.isAdmin"
      v-model="showAddDialog"
      :loading="adding"
      @add="handleAddAccount"
    />

    <!-- QR Code dialog -->
    <v-dialog v-model="showQRDialog" max-width="420" persistent>
      <v-card class="text-center pa-4" style="border: 1.5px solid var(--border-color); border-radius: 12px;">
        <v-card-title class="font-weight-bold neo-subtitle" style="font-size: 0.9rem;">QUÉT QR ĐĂNG NHẬP ZALO</v-card-title>
        <v-card-text>
          <div v-if="qrImage" class="mb-4">
            <img :src="'data:image/png;base64,' + qrImage" alt="QR Code" style="max-width: 280px; border: 1.5px solid var(--border-color); border-radius: 8px;" />
          </div>
          <div v-else-if="qrScanned" class="mb-4">
            <v-icon icon="check.svg" size="64" color="success" />
            <p class="text-h6 mt-2 font-weight-bold">Đã quét! Xác nhận trên điện thoại...</p>
            <p v-if="scannedName" class="text-body-2">{{ scannedName }}</p>
          </div>
          <div v-else class="mb-4">
            <v-progress-circular indeterminate color="primary" size="64" />
            <p class="mt-2 font-weight-bold">Đang tạo QR code...</p>
          </div>
          <v-alert v-if="qrError" type="error" density="compact" class="mt-2">{{ qrError }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn rounded="lg" @click="cancelQR">Đóng</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete confirm dialog -->
    <v-dialog v-model="showDeleteDialog" max-width="420">
      <v-card class="pa-2" style="border: 1.5px solid var(--border-color); border-radius: 12px;">
        <v-card-title class="font-weight-bold neo-subtitle" style="font-size: 0.9rem;">XÁC NHẬN XÓA KÊNH</v-card-title>
        <v-card-text>Bạn có chắc muốn xóa tài khoản "{{ deleteTarget?.displayName || deleteTarget?.id }}"?</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn rounded="lg" @click="showDeleteDialog = false">Hủy</v-btn>
          <v-btn color="error" rounded="lg" class="font-weight-bold" style="border: 1.5px solid var(--border-color);" :loading="deleting" @click="handleDeleteAccount">Xóa</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Access control dialog -->
    <ZaloAccessDialog
      v-model="showAccessDialog"
      :account-id="accessTarget?.id ?? ''"
      :account-name="accessTarget?.displayName ?? accessTarget?.id ?? ''"
    />

    <!-- Edit Brand & Color dialog (Admin only) -->
    <ZaloAccountEditDialog
      v-if="authStore.isAdmin"
      v-model="showEditDialog"
      :account="editTarget"
      @save="handleSaveEdit"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useZaloAccounts, type ZaloAccount } from '@/composables/use-zalo-accounts';
import { useAuthStore } from '@/stores/auth';
import ZaloAccessDialog from '@/components/settings/ZaloAccessDialog.vue';
import ZaloAccountCard from '@/components/zalo/ZaloAccountCard.vue';
import ZaloAccountAddDialog from '@/components/zalo/zalo-account-add-dialog.vue';
import ZaloAccountEditDialog from '@/components/zalo/ZaloAccountEditDialog.vue';
import { api } from '@/api/index';

const {
  accounts, loading, adding, deleting,
  showQRDialog, qrImage, qrScanned, scannedName, qrError,
  fetchAccounts, addAccount, updateAccount, loginAccount, reconnectAccount, deleteAccount,
  cancelQR, setupSocket,
} = useZaloAccounts();

const authStore = useAuthStore();

const showAddDialog = ref(false);
const showEditDialog = ref(false);
const syncing = ref<string | null>(null);
const showDeleteDialog = ref(false);
const showAccessDialog = ref(false);
const deleteTarget = ref<ZaloAccount | null>(null);
const accessTarget = ref<ZaloAccount | null>(null);
const editTarget = ref<ZaloAccount | null>(null);

async function syncContacts(accountId: string) {
  syncing.value = accountId;
  try {
    const res = await api.post(`/zalo-accounts/${accountId}/sync-contacts`);
    alert(`Đồng bộ thành công: ${res.data.created} mới, ${res.data.updated} cập nhật`);
  } catch (err: any) {
    alert('Đồng bộ thất bại: ' + (err.response?.data?.error || err.message));
  } finally {
    syncing.value = null;
  }
}

async function handleAddAccount(payload: { name: string; branch: string; color: string }) {
  const ok = await addAccount(
    payload.name || undefined,
    payload.branch || undefined,
    payload.color || undefined,
  );
  if (ok) {
    showAddDialog.value = false;
  }
}

function openEdit(account: ZaloAccount) {
  if (!authStore.isAdmin) return;
  editTarget.value = account;
  showEditDialog.value = true;
}

async function handleSaveEdit(payload: { id: string; displayName?: string | null; branchTag?: string | null; colorTag?: string | null }) {
  const ok = await updateAccount(payload.id, {
    displayName: payload.displayName,
    branchTag: payload.branchTag,
    colorTag: payload.colorTag,
  });
  if (ok) {
    showEditDialog.value = false;
    editTarget.value = null;
  }
}

function confirmDelete(account: ZaloAccount) {
  deleteTarget.value = account;
  showDeleteDialog.value = true;
}

function openAccess(account: ZaloAccount) {
  accessTarget.value = account;
  showAccessDialog.value = true;
}

async function handleDeleteAccount() {
  if (!deleteTarget.value) return;
  const ok = await deleteAccount(deleteTarget.value);
  if (ok) {
    showDeleteDialog.value = false;
    deleteTarget.value = null;
  }
}

onMounted(() => {
  fetchAccounts();
  setupSocket();
});
</script>
