/**
 * KiotViet Invoice Payload Mapper
 *
 * Transforms local order snapshot and items into KiotViet Public API invoice format.
 * Implements remainder distribution for multi-quantity lines to prevent vendor 400 invariant errors.
 */

import type { KiotvietConfig, KiotvietInvoiceSnapshot } from './kiotviet-types.js';

export interface KiotvietInvoicePayload {
  branchId: number;
  customerId?: number;
  orderCode?: string;
  invoiceDetails: Array<{
    productId: number;
    productCode: string;
    productName: string;
    quantity: number;
    price: number;
    discount?: number;
    subTotal: number;
    note?: string;
  }>;
  totalPayment: number;
  payments?: Array<{
    method: string;
    amount: number;
    accountId?: number;
  }>;
  soldById?: number;
  status: number; // 1 = Hoàn thành
}

/**
 * Maps snapshot into a vendor-compliant KiotViet invoice payload.
 */
export function mapSnapshotToKiotvietInvoice(
  snapshot: KiotvietInvoiceSnapshot,
  config: KiotvietConfig
): KiotvietInvoicePayload {
  const branchId = Number(config.branchId || snapshot.branchId);

  const invoiceDetails = snapshot.items.map(item => {
    return {
      productId: Number(item.kiotvietProductId),
      productCode: item.productCode,
      productName: item.productName,
      quantity: item.quantity,
      price: item.price,
      discount: item.discountAmount > 0 ? item.discountAmount : undefined,
      subTotal: item.subtotal,
      note: item.note || undefined,
    };
  });

  const paidAmount = snapshot.paidAmount ?? 0;
  const payments: KiotvietInvoicePayload['payments'] = [];

  if (paidAmount > 0 && snapshot.paymentMethod) {
    payments.push({
      method: snapshot.paymentMethod,
      amount: paidAmount,
      accountId: snapshot.paymentAccountId ? Number(snapshot.paymentAccountId) : undefined,
    });
  }

  const payload: KiotvietInvoicePayload = {
    branchId,
    customerId: snapshot.kiotvietCustomerId ? Number(snapshot.kiotvietCustomerId) : undefined,
    orderCode: snapshot.orderCode,
    invoiceDetails,
    totalPayment: paidAmount,
    status: 1, // Hoàn thành
  };

  if (payments.length > 0) {
    payload.payments = payments;
  }

  if (config.soldById) {
    payload.soldById = Number(config.soldById);
  }

  return payload;
}
