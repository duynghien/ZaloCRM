/**
 * Composable for Zalo account management logic:
 * - CRUD operations via REST API
 * - Real-time QR login flow via Socket.IO
 */
import { ref, onUnmounted } from 'vue';
import { api } from '@/api/index';
import type { Socket } from 'socket.io-client';
import { getSharedSocket } from '../services/socket-service';
import { subscribeQR } from './zalo-qr-subscription';

export interface ZaloAccount {
  id: string;
  displayName: string | null;
  zaloUid: string | null;
  avatarUrl?: string | null;
  status: string;
  liveStatus?: string;
  branchTag?: string | null;
  colorTag?: string | null;
  unreadCount?: number;
  phone: string | null;
  sessionData: any;
  ownerUserId: string;
  createdAt: string;
}

export function useZaloAccounts() {
  const accounts = ref<ZaloAccount[]>([]);
  const loading = ref(false);
  const adding = ref(false);
  const deleting = ref(false);

  // QR dialog state
  const showQRDialog = ref(false);
  const qrImage = ref('');
  const qrScanned = ref(false);
  const scannedName = ref('');
  const qrError = ref('');
  const currentLoginAccountId = ref('');

  let loginGeneration = 0;
  let loginRequested = false;
  let socket: Socket | null = null;

  function statusColor(status: string) {
    switch (status) {
      case 'connected': return 'success';
      case 'qr_pending': case 'connecting': return 'warning';
      default: return 'error';
    }
  }

  function statusText(status: string) {
    switch (status) {
      case 'connected': return 'Đã kết nối';
      case 'qr_pending': return 'Chờ QR';
      case 'connecting': return 'Đang kết nối...';
      default: return 'Ngắt kết nối';
    }
  }

  async function fetchAccounts() {
    loading.value = true;
    try {
      const res = await api.get('/zalo-accounts');
      accounts.value = res.data;
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    } finally {
      loading.value = false;
    }
  }

  async function addAccount(displayName?: string, branchTag?: string, colorTag?: string) {
    adding.value = true;
    try {
      await api.post('/zalo-accounts', {
        displayName: displayName || undefined,
        branchTag: branchTag || undefined,
        colorTag: colorTag || undefined,
      });
      await fetchAccounts();
      return true;
    } catch (err: any) {
      console.error('Failed to add account:', err);
      return false;
    } finally {
      adding.value = false;
    }
  }

  async function updateAccount(id: string, data: { displayName?: string | null; branchTag?: string | null; colorTag?: string | null }) {
    try {
      await api.patch(`/zalo-accounts/${id}`, data);
      await fetchAccounts();
      return true;
    } catch (err: any) {
      console.error('Failed to update account:', err);
      return false;
    }
  }

  async function loginAccount(accountId: string) {
    cancelQR();
    currentLoginAccountId.value = accountId;
    qrImage.value = '';
    qrScanned.value = false;
    scannedName.value = '';
    qrError.value = '';
    showQRDialog.value = true;
    loginRequested = false;
    setupSocket();
    await restoreLoginIntent();
  }

  async function restoreLoginIntent() {
    const accountId = currentLoginAccountId.value;
    if (!socket || !showQRDialog.value || !accountId) return;
    const generation = ++loginGeneration;
    const activeSocket = socket;
    const current = () => generation === loginGeneration && socket === activeSocket
      && showQRDialog.value && currentLoginAccountId.value === accountId;
    try {
      if (!await subscribeQR(activeSocket, accountId, current) || !current()) return;
      if (loginRequested) return;
      loginRequested = true;
      await api.post(`/zalo-accounts/${accountId}/login`);
    } catch (err: any) {
      if (current()) {
        qrError.value = err.response?.data?.error || err.message || 'Không thể bắt đầu đăng nhập';
        qrImage.value = '';
      }
    }
  }

  async function reconnectAccount(accountId: string) {
    try {
      await api.post(`/zalo-accounts/${accountId}/reconnect`);
      await fetchAccounts();
    } catch (err: any) {
      console.error('Reconnect failed:', err);
    }
  }

  async function deleteAccount(account: ZaloAccount) {
    deleting.value = true;
    try {
      await api.delete(`/zalo-accounts/${account.id}`);
      await fetchAccounts();
      return true;
    } catch (err: any) {
      console.error('Delete failed:', err);
      return false;
    } finally {
      deleting.value = false;
    }
  }

  function cancelQR() {
    const accountId = currentLoginAccountId.value;
    loginGeneration++;
    loginRequested = false;
    showQRDialog.value = false;
    currentLoginAccountId.value = '';
    qrImage.value = '';
    if (accountId && socket?.connected) socket.emit('zalo:unsubscribe', { accountId });
  }

  function onConnect() {
    void restoreLoginIntent();
  }

  function onDisconnect() {
    loginGeneration++;
  }

  function onZaloQr(data: { accountId: string; qrImage: string }) {
    if (data.accountId === currentLoginAccountId.value) qrImage.value = data.qrImage;
  }

  function onZaloScanned(data: { accountId: string; displayName: string }) {
    if (data.accountId === currentLoginAccountId.value) {
      qrImage.value = '';
      qrScanned.value = true;
      scannedName.value = data.displayName;
    }
  }

  function onZaloConnected(data: { accountId: string }) {
    if (data.accountId === currentLoginAccountId.value) cancelQR();
    fetchAccounts();
  }

  function onZaloDisconnected(_data: { accountId: string }) {
    fetchAccounts();
  }

  function onZaloError(data: { accountId: string; error: string }) {
    if (data.accountId === currentLoginAccountId.value) qrError.value = data.error;
    fetchAccounts();
  }

  function onZaloQrExpired(data: { accountId: string }) {
    if (data.accountId === currentLoginAccountId.value) {
      qrImage.value = '';
      qrError.value = 'QR đã hết hạn, đang tạo lại...';
    }
  }

  function onZaloReconnectFailed(_data: { accountId: string }) {
    fetchAccounts();
  }

  function onZaloStatusChanged(data: { accountId: string; status: string }) {
    const target = accounts.value.find((a) => a.id === data.accountId);
    if (target) {
      target.status = data.status;
      target.liveStatus = data.status;
    }
  }

  function attachSocketListeners() {
    if (!socket) return;
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('zalo:qr', onZaloQr);
    socket.on('zalo:scanned', onZaloScanned);
    socket.on('zalo:connected', onZaloConnected);
    socket.on('zalo:disconnected', onZaloDisconnected);
    socket.on('zalo:error', onZaloError);
    socket.on('zalo:qr-expired', onZaloQrExpired);
    socket.on('zalo:reconnect-failed', onZaloReconnectFailed);
    socket.on('zalo:status-changed', onZaloStatusChanged);
  }

  function detachSocketListeners() {
    if (!socket) return;
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
    socket.off('zalo:qr', onZaloQr);
    socket.off('zalo:scanned', onZaloScanned);
    socket.off('zalo:connected', onZaloConnected);
    socket.off('zalo:disconnected', onZaloDisconnected);
    socket.off('zalo:error', onZaloError);
    socket.off('zalo:qr-expired', onZaloQrExpired);
    socket.off('zalo:reconnect-failed', onZaloReconnectFailed);
    socket.off('zalo:status-changed', onZaloStatusChanged);
  }

  function setupSocket() {
    socket = getSharedSocket();
    if (!socket) return;
    if (!socket.connected) socket.connect();

    detachSocketListeners();
    attachSocketListeners();
  }

  onUnmounted(() => {
    cancelQR();
    detachSocketListeners();
    socket = null;
  });

  return {
    accounts, loading, adding, deleting,
    showQRDialog, qrImage, qrScanned, scannedName, qrError,
    statusColor, statusText,
    fetchAccounts, addAccount, updateAccount, loginAccount, reconnectAccount, deleteAccount,
    cancelQR, setupSocket,
  };
}
