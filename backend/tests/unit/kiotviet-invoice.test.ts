process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { calculateItemTotal, calculateOrderTotal } from '../../src/modules/orders/order-item-totals.js';
import {
  isOrderFinancialLocked,
  assertOrderNotLockedForFinancialChanges,
} from '../../src/modules/orders/order-invoice-lock.js';
import {
  validatePaymentFields,
  validateOrderItems,
} from '../../src/modules/orders/order-item-validation.js';
import { mapSnapshotToKiotvietInvoice } from '../../src/modules/integrations/kiotviet/kiotviet-invoice-mapper.js';
import { resolveCustomerIdForOrder } from '../../src/modules/integrations/kiotviet/kiotviet-customer-service.js';
import { reconcileInvoice } from '../../src/modules/integrations/kiotviet/kiotviet-invoice-reconciliation.js';
import * as kiotvietClient from '../../src/modules/integrations/kiotviet/kiotviet-client.js';
import * as kiotvietSettings from '../../src/modules/integrations/kiotviet/kiotviet-settings-service.js';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { RequestValidationError } from '../../src/shared/http/request-schemas.js';

vi.mock('../../src/shared/database/prisma-client.js', () => {
  const mockPrisma: any = {
    order: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    kiotvietInvoiceJob: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    kiotvietSyncState: {
      findUnique: vi.fn(),
    },
    kiotvietProduct: {
      findFirst: vi.fn(),
    },
    activityLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
  };
  return { prisma: mockPrisma };
});

vi.mock('../../src/modules/integrations/kiotviet/kiotviet-client.js', () => ({
  searchKiotvietCustomersByPhone: vi.fn(),
  getKiotvietInvoice: vi.fn(),
}));

vi.mock('../../src/modules/integrations/kiotviet/kiotviet-settings-service.js', async (importOriginal) => {
  const original = await importOriginal<typeof kiotvietSettings>();
  return {
    ...original,
    getKiotvietConfig: vi.fn(),
  };
});

describe('KiotViet Invoice & Order Module Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Order Item Totals & VND Rounding', () => {
    it('calculates item total with amount discount and rounds properly', () => {
      const result = calculateItemTotal(2, 10000, 'amount', 1000);
      expect(result.quantity).toBe(2);
      expect(result.price).toBe(10000);
      expect(result.discountAmount).toBe(1000);
      expect(result.subtotal).toBe(19000);
    });

    it('calculates item total with percent discount clamped to 100%', () => {
      const result = calculateItemTotal(1, 50000, 'percent', 10);
      expect(result.discountAmount).toBe(5000);
      expect(result.subtotal).toBe(45000);

      const capped = calculateItemTotal(1, 50000, 'percent', 150);
      expect(capped.discountAmount).toBe(50000);
      expect(capped.subtotal).toBe(0);
    });

    it('calculates order total from items', () => {
      const item1 = calculateItemTotal(2, 10000, 'amount', 1000);
      const item2 = calculateItemTotal(1, 50000, 'amount', 0);
      const total = calculateOrderTotal([item1, item2]);
      expect(total).toBe(69000);
    });
  });

  describe('Financial Locks', () => {
    it('isOrderFinancialLocked correctly identifies locked states', () => {
      expect(isOrderFinancialLocked('none')).toBe(false);
      expect(isOrderFinancialLocked('failed')).toBe(false);
      expect(isOrderFinancialLocked('pending')).toBe(true);
      expect(isOrderFinancialLocked('uncertain')).toBe(true);
      expect(isOrderFinancialLocked('synced')).toBe(true);
      expect(isOrderFinancialLocked({ kiotvietSyncStatus: 'failed', kiotvietInvoiceId: null })).toBe(false);
      expect(isOrderFinancialLocked({ kiotvietSyncStatus: 'failed', kiotvietInvoiceId: 12345n })).toBe(true);
      expect(isOrderFinancialLocked({ kiotvietSyncStatus: 'synced', kiotvietInvoiceId: null })).toBe(true);
    });

    it('assertOrderNotLockedForFinancialChanges allows modification when unlocked', () => {
      expect(() => assertOrderNotLockedForFinancialChanges('none', 'financial_update')).not.toThrow();
      expect(() => assertOrderNotLockedForFinancialChanges('failed', 'financial_update')).not.toThrow();
      expect(() => assertOrderNotLockedForFinancialChanges({ kiotvietSyncStatus: 'failed', kiotvietInvoiceId: null }, 'financial_update')).not.toThrow();
    });

    it('assertOrderNotLockedForFinancialChanges throws 409 conflict when locked', () => {
      expect(() => assertOrderNotLockedForFinancialChanges('pending', 'financial_update')).toThrow();
      expect(() => assertOrderNotLockedForFinancialChanges('uncertain', 'cancel')).toThrow();
      expect(() => assertOrderNotLockedForFinancialChanges('synced', 'delete')).toThrow();
      expect(() => assertOrderNotLockedForFinancialChanges({ kiotvietSyncStatus: 'failed', kiotvietInvoiceId: 123n }, 'cancel')).toThrow();
      expect(() => assertOrderNotLockedForFinancialChanges({ kiotvietSyncStatus: 'failed', kiotvietInvoiceId: 123n }, 'delete')).toThrow();
      expect(() => assertOrderNotLockedForFinancialChanges({ kiotvietSyncStatus: 'failed', kiotvietInvoiceId: 123n }, 'financial_update')).toThrow();
    });
  });

  describe('Payment Fields Validation', () => {
    it('validates payment fields when paidAmount is provided', () => {
      const res = validatePaymentFields(50000, 'Cash', '123', 100000);
      expect(res.paidAmount).toBe(50000);
      expect(res.paymentMethod).toBe('Cash');
      expect(res.paymentAccountId).toBe(BigInt(123));
    });

    it('rejects paidAmount > totalAmount', () => {
      expect(() => validatePaymentFields(150000, 'Cash', null, 100000))
        .toThrow(RequestValidationError);
    });

    it('rejects paidAmount < 0', () => {
      expect(() => validatePaymentFields(-10, 'Cash', null, 100000))
        .toThrow(RequestValidationError);
    });

    it('requires paymentMethod when paidAmount > 0', () => {
      expect(() => validatePaymentFields(50000, null, null, 100000))
        .toThrow(RequestValidationError);
    });
  });

  describe('KiotViet Invoice Mapper', () => {
    it('maps snapshot and config into KiotViet invoice payload', () => {
      const snapshot: any = {
        orderId: 'order-123',
        orderCode: 'DH0001',
        branchId: '10001',
        totalAmount: 150000,
        paidAmount: 100000,
        paymentMethod: 'Cash',
        paymentAccountId: '456',
        kiotvietCustomerId: '789',
        items: [
          {
            kiotvietProductId: '101',
            productCode: 'SP01',
            productName: 'Product 1',
            quantity: 2,
            price: 50000,
            discountAmount: 10000,
            subtotal: 90000,
            note: 'Gift wrap',
          },
          {
            kiotvietProductId: '102',
            productCode: 'SP02',
            productName: 'Product 2',
            quantity: 1,
            price: 60000,
            discountAmount: 0,
            subtotal: 60000,
          },
        ],
      };

      const config: any = {
        branchId: '10001',
        soldById: '99',
      };

      const payload = mapSnapshotToKiotvietInvoice(snapshot, config);
      expect(payload.branchId).toBe(10001);
      expect(payload.customerId).toBe(789);
      expect(payload.orderCode).toBe('DH0001');
      expect(payload.totalPayment).toBe(100000);
      expect(payload.soldById).toBe(99);
      expect(payload.status).toBe(1);
      expect(payload.invoiceDetails).toHaveLength(2);
      expect(payload.invoiceDetails[0]).toEqual({
        productId: 101,
        productCode: 'SP01',
        productName: 'Product 1',
        quantity: 2,
        price: 50000,
        discount: 10000,
        subTotal: 90000,
        note: 'Gift wrap',
      });
      expect(payload.payments).toEqual([
        {
          method: 'Cash',
          amount: 100000,
          accountId: 456,
        },
      ]);
    });

    it('distributes rounding discrepancy to the largest line item subTotal', () => {
      const snapshot: any = {
        orderId: 'order-frac-1',
        orderCode: 'DH0002',
        branchId: '10001',
        totalAmount: 100001,
        paidAmount: 50000,
        items: [
          {
            kiotvietProductId: '101',
            productCode: 'SP01',
            productName: 'Product 1',
            quantity: 1.25,
            price: 40000,
            discountAmount: 0,
            subtotal: 50000,
          },
          {
            kiotvietProductId: '102',
            productCode: 'SP02',
            productName: 'Product 2',
            quantity: 2.5,
            price: 20000,
            discountAmount: 0,
            subtotal: 50000,
          },
        ],
      };

      const config: any = { branchId: '10001' };
      const payload = mapSnapshotToKiotvietInvoice(snapshot, config);
      const totalLines = payload.invoiceDetails.reduce((sum, d) => sum + d.subTotal, 0);
      expect(totalLines).toBe(100001);
      expect(payload.invoiceDetails[0].subTotal).toBe(50001);
      expect(payload.totalPayment).toBe(50000);
    });
  });

  describe('Order Item Validation - Discount Bounds', () => {
    const mockTx: any = {
      kiotvietSyncState: {
        findUnique: vi.fn().mockResolvedValue({ retailer: 'r1', branchId: 'b1' }),
      },
      kiotvietProduct: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'p1',
          kiotvietId: '101',
          code: 'SP01',
          name: 'Product 1',
          unit: 'cái',
          price: 50000,
          isActive: true,
          allowsSale: true,
          productType: 'normal',
        }),
      },
    };

    it('rejects percent discount greater than 100%', async () => {
      const rawItems = [
        {
          productId: 'p1',
          quantity: 1,
          discountMode: 'percent',
          discountInput: 105,
        },
      ];

      await expect(
        validateOrderItems('org-1', rawItems, 'admin', mockTx)
      ).rejects.toThrow(RequestValidationError);
    });

    it('rejects negative discount', async () => {
      const rawItems = [
        {
          productId: 'p1',
          quantity: 1,
          discountMode: 'amount',
          discountInput: -1000,
        },
      ];

      await expect(
        validateOrderItems('org-1', rawItems, 'admin', mockTx)
      ).rejects.toThrow(RequestValidationError);
    });

    it('accepts valid percent discount (<= 100%)', async () => {
      const rawItems = [
        {
          productId: 'p1',
          quantity: 1,
          discountMode: 'percent',
          discountInput: 20,
        },
      ];

      const res = await validateOrderItems('org-1', rawItems, 'admin', mockTx);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].discountAmount).toBe(10000);
      expect(res.items[0].subtotal).toBe(40000);
    });
  });

  describe('Customer Disambiguation', () => {
    const config: any = { retailer: 'shop-1', branchId: '10001' };

    it('uses existing kiotvietCustomerId on order directly', async () => {
      const res = await resolveCustomerIdForOrder('org-1', config, { kiotvietCustomerId: BigInt(555) }, {});
      expect(res.customerId).toBe('555');
    });

    it('returns no_phone when contact has invalid or missing phone', async () => {
      const res = await resolveCustomerIdForOrder('org-1', config, {}, { phone: '12' });
      expect(res.customerId).toBeNull();
      expect(res.reason).toBe('no_phone');
    });

    it('resolves customer when exactly 1 match found in KiotViet', async () => {
      vi.mocked(kiotvietClient.searchKiotvietCustomersByPhone).mockResolvedValueOnce([
        { id: '123', name: 'Nguyen Van A', contactNumber: '0901234567' } as any,
      ]);

      const res = await resolveCustomerIdForOrder('org-1', config, {}, { phone: '0901234567' });
      expect(res.customerId).toBe('123');
      expect(res.customerName).toBe('Nguyen Van A');
    });

    it('returns needs_customer_selection when 0 or >1 matches found', async () => {
      vi.mocked(kiotvietClient.searchKiotvietCustomersByPhone).mockResolvedValueOnce([
        { id: '123', name: 'Nguyen Van A' } as any,
        { id: '456', name: 'Tran Van B' } as any,
      ]);

      const res = await resolveCustomerIdForOrder('org-1', config, {}, { phone: '0901234567' });
      expect(res.customerId).toBeNull();
      expect(res.reason).toBe('needs_customer_selection');
    });
  });

  describe('Invoice Reconciliation', () => {
    const orgId = 'org-1';
    const orderId = 'order-rec-1';
    const actorId = 'user-admin';

    it('links existing invoice and transitions job to succeeded', async () => {
      vi.mocked(kiotvietSettings.getKiotvietConfig).mockResolvedValueOnce({
        retailer: 'test-shop',
        branchId: '10001',
      } as any);

      (prisma.order.findFirst as any).mockResolvedValueOnce({
        id: orderId,
        orgId,
        kiotvietJob: { id: 'job-1', remoteInvoiceId: null, leaseVersion: 0 },
      });
      (prisma.kiotvietInvoiceJob.findFirst as any).mockResolvedValueOnce(null); // not already linked

      vi.mocked(kiotvietClient.getKiotvietInvoice).mockResolvedValueOnce({
        id: 9999,
        code: 'HD009999',
      } as any);

      (prisma.kiotvietInvoiceJob.updateMany as any).mockResolvedValueOnce({ count: 1 });

      (prisma.order.update as any).mockResolvedValueOnce({
        id: orderId,
        kiotvietSyncStatus: 'synced',
      });

      const result = await reconcileInvoice({
        orgId,
        orderId,
        action: 'link',
        remoteInvoiceId: '9999',
        reason: 'Manual match by admin',
        actorId,
      });

      expect(result.action).toBe('link');
      expect(result.remoteInvoiceCode).toBe('HD009999');
      expect(prisma.kiotvietInvoiceJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'job-1',
            orgId,
            state: { in: ['uncertain', 'failed'] },
          }),
          data: expect.objectContaining({
            state: 'succeeded',
            remoteInvoiceId: BigInt(9999),
            reconciliationStatus: 'matched',
          }),
        })
      );
    });

    it('confirm-not-created marks job failed and unlocks order', async () => {
      vi.mocked(kiotvietSettings.getKiotvietConfig).mockResolvedValueOnce({
        retailer: 'test-shop',
        branchId: '10001',
      } as any);

      (prisma.order.findFirst as any).mockResolvedValueOnce({
        id: orderId,
        orgId,
        kiotvietJob: { id: 'job-1', leaseVersion: 0 },
      });

      (prisma.kiotvietInvoiceJob.updateMany as any).mockResolvedValueOnce({ count: 1 });

      (prisma.order.update as any).mockResolvedValueOnce({
        id: orderId,
        kiotvietSyncStatus: 'failed',
      });

      const result = await reconcileInvoice({
        orgId,
        orderId,
        action: 'confirm-not-created',
        reason: 'Checked KiotViet portal and verified invoice does not exist',
        actorId,
      });

      expect(result.action).toBe('confirm-not-created');
      expect(prisma.kiotvietInvoiceJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'job-1',
            orgId,
            state: 'uncertain',
            remoteInvoiceId: null,
          }),
          data: expect.objectContaining({
            state: 'failed',
            reconciliationStatus: 'confirmed_not_created',
          }),
        })
      );
    });
  });
});
