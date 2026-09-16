/**
 * Composable for Zalo account management logic:
 * - CRUD operations via REST API
 * - Real-time QR login flow via Socket.IO
 */
import { ref, onUnmounted } from 'vue';
import { api, getAccessToken, isSocketAuthenticationFailure, refreshAccessToken } from '@/api/index';
import { io, Socket } from 'socket.io-client';
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
  let socketRefreshAttempted = false;
  let lastSocketRefresh = 0;
  let removeTokenListener: (() => void) | null = null;

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

  function setupSocket() {
    if (socket) {
      if (!socket.active && !socket.connected) socket.connect();
      return;
    }

    socket = io({
      auth: (callback) => callback({ token: getAccessToken() }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
    });

    const onTokenChanged = (event: Event) => {
      const nextToken = (event as CustomEvent<string>).detail || '';
      if (!socket) return;
      if (!nextToken) {
        cancelQR();
        socket.removeAllListeners();
        socket.disconnect();
        socket = null;
        socketRefreshAttempted = false;
        if (removeTokenListener) {
          removeTokenListener();
          removeTokenListener = null;
        }
        return;
      }
      socket.auth = { token: nextToken };
      socketRefreshAttempted = false;
      if (socket.connected) {
        socket.disconnect().connect();
      } else {
        socket.connect();
      }
    };
    window.addEventListener('zalo-crm:access-token-changed', onTokenChanged as EventListener);
    if (removeTokenListener) removeTokenListener();
    removeTokenListener = () => window.removeEventListener('zalo-crm:access-token-changed', onTokenChanged as EventListener);

    socket.on('disconnect', async (reason) => {
      // Server-enforced token expiry is not retried by Socket.IO. Refresh once per
      // disconnect burst; a rejected refresh follows the REST logout policy.
      if (reason !== 'io server disconnect' || !socket || !getAccessToken()) return;
      const now = Date.now();
      if (lastSocketRefresh && now - lastSocketRefresh < 5000) return;
      lastSocketRefresh = now;
      const disconnectedSocket = socket;
      try {
        await refreshAccessToken();
        if (socket === disconnectedSocket) socket.connect();
      } catch {
        // A later explicit token change may reconnect after a transient failure.
      }
    });

    socket.on('connect_error', async (error) => {
      const unauthorized = isSocketAuthenticationFailure(error.message);
      if (!unauthorized || socketRefreshAttempted || !socket) return;

      const now = Date.now();
      if (lastSocketRefresh && now - lastSocketRefresh < 5000) return;
      lastSocketRefresh = now;
      socketRefreshAttempted = true;
      try {
        await refreshAccessToken();
        socket?.connect();
      } catch {
        // The API layer redirects only when the refresh cookie was rejected.
      }
    });

    socket.on('connect', () => { void restoreLoginIntent(); });
    socket.on('disconnect', () => { loginGeneration++; });

    socket.on('zalo:qr', (data: { accountId: string; qrImage: string }) => {
      if (data.accountId === currentLoginAccountId.value) qrImage.value = data.qrImage;
    });

    socket.on('zalo:scanned', (data: { accountId: string; displayName: string }) => {
      if (data.accountId === currentLoginAccountId.value) {
        qrImage.value = '';
        qrScanned.value = true;
        scannedName.value = data.displayName;
      }
    });

    socket.on('zalo:connected', (data: { accountId: string }) => {
      if (data.accountId === currentLoginAccountId.value) cancelQR();
      fetchAccounts();
    });

    socket.on('zalo:disconnected', (_data: { accountId: string }) => { fetchAccounts(); });

    socket.on('zalo:error', (data: { accountId: string; error: string }) => {
      if (data.accountId === currentLoginAccountId.value) qrError.value = data.error;
      fetchAccounts();
    });

    socket.on('zalo:qr-expired', (data: { accountId: string }) => {
      if (data.accountId === currentLoginAccountId.value) {
        qrImage.value = '';
        qrError.value = 'QR đã hết hạn, đang tạo lại...';
      }
    });

    socket.on('zalo:reconnect-failed', (_data: { accountId: string }) => { fetchAccounts(); });
    socket.on('zalo:status-changed', (data: { accountId: string; status: string }) => {
      const target = accounts.value.find((a) => a.id === data.accountId);
      if (target) {
        target.status = data.status;
        target.liveStatus = data.status;
      }
    });
  }

  onUnmounted(() => {
    cancelQR();
    socket?.removeAllListeners();
    socket?.disconnect();
    socket = null;
    socketRefreshAttempted = false;
    if (removeTokenListener) {
      removeTokenListener();
      removeTokenListener = null;
    }
  });

  return {
    accounts, loading, adding, deleting,
    showQRDialog, qrImage, qrScanned, scannedName, qrError,
    statusColor, statusText,
    fetchAccounts, addAccount, updateAccount, loginAccount, reconnectAccount, deleteAccount,
    cancelQR, setupSocket,
  };
}
