/**
 * Composable for Order Management:
 * - CRUD operations for orders with item breakdown and payment tracking
 * - Stats and staff performance data
 * - Status helpers for labels and colors
 * - KiotViet invoice sync, polling, and reconciliation
 */
import { ref } from 'vue';
import { api } from '@/api/index';

export interface OrderItem {
  id?: string;
  productId?: string | null;
  kiotvietProductId: string;
  retailer?: string;
  branchId?: string;
  productCode: string;
  productName: string;
  unit?: string | null;
  quantity: number;
  price: number;
  discountMode: 'amount' | 'percent';
  discountInput: number;
  discountAmount: number;
  subtotal: number;
  note?: string | null;
  productType?: string;
}

export interface Order {
  id: string;
  orderCode: string;
  contactId: string;
  contact?: { id: string; fullName: string | null; phone: string | null };
  createdByUserId: string;
  createdBy?: { id: string; fullName: string };
  totalAmount: number;
  paidAmount?: number | null;
  paymentMethod?: string | null;
  paymentAccountId?: string | null;
  status: string;
  notes: string | null;
  conversationId: string | null;
  createdAt: string;
  updatedAt?: string;
  revision?: number;
  kiotvietInvoiceStatus?: 'none' | 'pending' | 'synced' | 'failed' | 'uncertain' | null;
  kiotvietInvoiceId?: string | null;
  kiotvietInvoiceCode?: string | null;
  kiotvietSyncedAt?: string | null;
  kiotvietSyncError?: string | null;
  kiotvietCustomerId?: string | null;
  editable?: boolean;
  canSync?: boolean;
  syncBlockReason?: string | null;
  items?: OrderItem[];
}

export interface OrderStats {
  totalOrders: number;
  completedOrders: number;
  totalRevenue: number;
  todayRevenue: number;
}

export const ORDER_STATUS_OPTIONS = [
  { text: 'Mới', value: 'new', color: 'info' },
  { text: 'Đã xác nhận', value: 'confirmed', color: 'primary' },
  { text: 'Đã thanh toán', value: 'paid', color: 'success' },
  { text: 'Đang giao', value: 'shipped', color: 'warning' },
  { text: 'Hoàn thành', value: 'completed', color: 'success' },
  { text: 'Đã huỷ', value: 'cancelled', color: 'error' },
];

export const KIOTVIET_SYNC_STATUSES = [
  { text: 'Chưa xuất', value: 'none', color: 'grey' },
  { text: 'Đang xử lý', value: 'pending', color: 'warning' },
  { text: 'Đã xuất HĐ', value: 'synced', color: 'success' },
  { text: 'Thất bại', value: 'failed', color: 'error' },
  { text: 'Cần đối soát', value: 'uncertain', color: 'error' },
];

export function useOrders() {
  const orders = ref<Order[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const saving = ref(false);
  const orderError = ref<string | null>(null);
  const stats = ref<any>(null);
  const staffStats = ref<any[]>([]);

  async function fetchOrders(params: Record<string, string> = {}) {
    loading.value = true;
    try {
      const res = await api.get('/orders', { params });
      orders.value = res.data.orders || [];
      total.value = res.data.total || 0;
    } catch (err) {
      console.error(err);
    } finally {
      loading.value = false;
    }
  }

  async function getOrder(id: string): Promise<Order | null> {
    try {
      const res = await api.get(`/orders/${id}`);
      return res.data.order;
    } catch (err) {
      console.error('Failed to fetch order detail:', err);
      return null;
    }
  }

  async function createOrder(data: Partial<Order>): Promise<Order> {
    saving.value = true;
    orderError.value = null;
    try {
      const res = await api.post('/orders', data);
      return res.data.order || res.data;
    } catch (err: any) {
      orderError.value = err?.response?.data?.message || err?.message || 'Lỗi khi tạo đơn hàng';
      throw err;
    } finally {
      saving.value = false;
    }
  }

  async function updateOrder(id: string, data: Partial<Order>): Promise<Order> {
    saving.value = true;
    orderError.value = null;
    try {
      const res = await api.put(`/orders/${id}`, data);
      return res.data.order || res.data;
    } catch (err: any) {
      orderError.value = err?.response?.data?.message || err?.message || 'Lỗi khi cập nhật đơn hàng';
      throw err;
    } finally {
      saving.value = false;
    }
  }

  async function deleteOrder(id: string): Promise<boolean> {
    try {
      await api.delete(`/orders/${id}`);
      return true;
    } catch (err: any) {
      orderError.value = err?.response?.data?.message || err?.message || 'Lỗi khi xoá đơn hàng';
      return false;
    }
  }

  async function syncKiotviet(orderId: string, customerId?: string): Promise<{ success: boolean; message?: string; job?: any }> {
    try {
      const res = await api.post(`/orders/${orderId}/sync-kiotviet`, { customerId });
      return res.data;
    } catch (err: any) {
      console.error('Failed to trigger KiotViet sync:', err);
      throw err;
    }
  }

  async function reconcileKiotviet(
    orderId: string,
    payload: { action: 'link' | 'refresh' | 'confirm-not-created'; remoteInvoiceId?: string; reason?: string }
  ): Promise<any> {
    try {
      const res = await api.post(`/orders/${orderId}/reconcile-kiotviet`, payload);
      return res.data;
    } catch (err: any) {
      console.error('Failed to reconcile KiotViet invoice:', err);
      throw err;
    }
  }

  async function fetchStats() {
    try {
      const res = await api.get('/orders/stats');
      stats.value = res.data;
    } catch {}
  }

  async function fetchStaffStats() {
    try {
      const res = await api.get('/orders/by-staff');
      staffStats.value = res.data.staffStats || [];
    } catch {}
  }

  async function fetchContactOrders(contactId: string): Promise<Order[]> {
    try {
      const res = await api.get(`/contacts/${contactId}/orders`);
      return res.data.orders || [];
    } catch {
      return [];
    }
  }

  function statusColor(s: string) {
    return ORDER_STATUS_OPTIONS.find(o => o.value === s)?.color || 'grey';
  }

  function statusLabel(s: string) {
    return ORDER_STATUS_OPTIONS.find(o => o.value === s)?.text || s;
  }

  function kiotvietStatusColor(s?: string | null) {
    if (!s || s === 'none') return 'grey';
    return KIOTVIET_SYNC_STATUSES.find(o => o.value === s)?.color || 'grey';
  }

  function kiotvietStatusLabel(s?: string | null) {
    if (!s || s === 'none') return 'Chưa xuất';
    return KIOTVIET_SYNC_STATUSES.find(o => o.value === s)?.text || s;
  }

  return {
    orders,
    total,
    loading,
    saving,
    orderError,
    stats,
    staffStats,
    fetchOrders,
    getOrder,
    createOrder,
    updateOrder,
    deleteOrder,
    syncKiotviet,
    reconcileKiotviet,
    fetchStats,
    fetchStaffStats,
    fetchContactOrders,
    statusColor,
    statusLabel,
    kiotvietStatusColor,
    kiotvietStatusLabel,
  };
}
