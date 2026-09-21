import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useOrders } from '../src/composables/use-orders';
import { useContacts } from '../src/composables/use-contacts';
import { api } from '../src/api/index';

describe('KiotViet Order Flow & Locking', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('useOrders', () => {
    it('creates order with items, payments, and customer ID', async () => {
      const mockCreatedOrder = {
        id: 'ord-1',
        orderCode: 'DH001',
        contactId: 'c-1',
        totalAmount: 100000,
        paidAmount: 50000,
        paymentMethod: 'Transfer',
        status: 'confirmed',
        kiotvietInvoiceStatus: 'none',
        items: [
          {
            kiotvietProductId: '101',
            productCode: 'SP01',
            productName: 'Item 1',
            quantity: 1,
            price: 100000,
            discountMode: 'amount',
            discountInput: 0,
            discountAmount: 0,
            subtotal: 100000,
          },
        ],
      };

      vi.spyOn(api, 'post').mockResolvedValueOnce({
        data: { order: mockCreatedOrder },
      });

      const { createOrder } = useOrders();
      const res = await createOrder({
        contactId: 'c-1',
        totalAmount: 100000,
        paidAmount: 50000,
        paymentMethod: 'Transfer',
        status: 'confirmed',
        items: mockCreatedOrder.items as any,
      });

      expect(res.orderCode).toBe('DH001');
      expect(res.paidAmount).toBe(50000);
      expect(api.post).toHaveBeenCalledWith('/orders', expect.objectContaining({
        totalAmount: 100000,
        paidAmount: 50000,
        paymentMethod: 'Transfer',
      }));
    });

    it('triggers KiotViet sync and reconciles invoice', async () => {
      vi.spyOn(api, 'post')
        .mockResolvedValueOnce({ data: { success: true, job: { id: 'job-1' } } })
        .mockResolvedValueOnce({ data: { success: true, action: 'link' } });

      const { syncKiotviet, reconcileKiotviet } = useOrders();

      const syncRes = await syncKiotviet('ord-1', 'cust-123');
      expect(syncRes.success).toBe(true);
      expect(api.post).toHaveBeenCalledWith('/orders/ord-1/sync-kiotviet', { customerId: 'cust-123' });

      const recRes = await reconcileKiotviet('ord-1', {
        action: 'link',
        remoteInvoiceId: '9999',
      });
      expect(recRes.success).toBe(true);
      expect(api.post).toHaveBeenCalledWith('/orders/ord-1/reconcile-kiotviet', {
        action: 'link',
        remoteInvoiceId: '9999',
      });
    });

    it('provides status colors and labels for KiotViet invoice states', () => {
      const { kiotvietStatusColor, kiotvietStatusLabel } = useOrders();

      expect(kiotvietStatusLabel('none')).toBe('Chưa xuất');
      expect(kiotvietStatusColor('none')).toBe('grey');

      expect(kiotvietStatusLabel('pending')).toBe('Đang xử lý');
      expect(kiotvietStatusColor('pending')).toBe('warning');

      expect(kiotvietStatusLabel('synced')).toBe('Đã xuất HĐ');
      expect(kiotvietStatusColor('synced')).toBe('success');

      expect(kiotvietStatusLabel('uncertain')).toBe('Cần đối soát');
      expect(kiotvietStatusColor('uncertain')).toBe('error');

      expect(kiotvietStatusLabel('failed')).toBe('Thất bại');
      expect(kiotvietStatusColor('failed')).toBe('error');
    });
  });

  describe('useContacts 409 Conflict Handling', () => {
    it('captures 409 error message when deleting a contact with active/synced invoice jobs', async () => {
      vi.spyOn(api, 'delete').mockRejectedValueOnce({
        response: {
          status: 409,
          data: {
            code: 'contact_has_active_invoices',
            message: 'Cannot delete contact with active, uncertain, or synced KiotViet invoice jobs',
          },
        },
      });

      const { deleteContact, contactError } = useContacts();
      const success = await deleteContact('c-locked');

      expect(success).toBe(false);
      expect(contactError.value).toContain('Cannot delete contact with active, uncertain, or synced KiotViet invoice jobs');
    });
  });
});
