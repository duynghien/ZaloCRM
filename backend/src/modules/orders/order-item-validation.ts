/**
 * Order Item & Payment Validation
 *
 * Enforces role-based pricing, normal-goods-only eligibility, discount bounds,
 * and independent payment validation.
 */

import { RequestValidationError } from '../../shared/http/request-schemas.js';
import { calculateItemTotal } from './order-item-totals.js';
import { prisma } from '../../shared/database/prisma-client.js';

type PrismaClientOrTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma;

export interface NormalizedOrderItem {
  productId: string | null;
  kiotvietProductId: bigint;
  retailer: string;
  branchId: bigint;
  productCode: string;
  productName: string;
  unit: string | null;
  quantity: number;
  price: number;
  discountMode: 'amount' | 'percent';
  discountInput: number;
  discountAmount: number;
  subtotal: number;
  note: string | null;
}

export interface ValidatedOrderItemsResult {
  items: NormalizedOrderItem[];
  totalAmount: number;
}

/**
 * Validates item inputs, verifies against local KiotViet catalog, and computes subtotals.
 */
export async function validateOrderItems(
  orgId: string,
  rawItems: unknown[],
  userRole: string,
  tx: PrismaClientOrTx = prisma
): Promise<ValidatedOrderItemsResult> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { items: [], totalAmount: 0 };
  }

  if (rawItems.length > 100) {
    throw new RequestValidationError('Order cannot have more than 100 items');
  }

  // Fetch current active sync state to verify branch and retailer partition
  const syncState = await tx.kiotvietSyncState.findUnique({
    where: { orgId },
  });

  if (!syncState?.retailer || !syncState.branchId) {
    throw new RequestValidationError('KiotViet catalog is not configured for this organization');
  }

  const { retailer, branchId } = syncState;
  const isPrivileged = ['owner', 'admin'].includes(userRole);
  const normalizedItems: NormalizedOrderItem[] = [];

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i] as Record<string, any>;
    if (!raw || typeof raw !== 'object') {
      throw new RequestValidationError(`Item at index ${i} is invalid`);
    }

    const productId = typeof raw.productId === 'string' ? raw.productId : null;
    const rawKiotvietProductId = raw.kiotvietProductId ? String(raw.kiotvietProductId) : null;

    if (!productId && !rawKiotvietProductId) {
      throw new RequestValidationError(`Item at index ${i} must specify productId or kiotvietProductId`);
    }

    // Resolve product in catalog
    const product = await tx.kiotvietProduct.findFirst({
      where: {
        orgId,
        retailer,
        branchId,
        ...(productId ? { id: productId } : {}),
        ...(rawKiotvietProductId ? { kiotvietId: BigInt(rawKiotvietProductId) } : {}),
      },
    });

    if (!product) {
      throw new RequestValidationError(`Product at index ${i} not found in active KiotViet catalog partition`);
    }

    if (!product.isActive || !product.allowsSale) {
      throw new RequestValidationError(`Product '${product.code}' (${product.name}) is inactive or unavailable for sale`);
    }

    // Enforce normal-goods-only scope v1
    if (product.productType !== 'normal' || product.hasSerial || product.hasBatch) {
      throw new RequestValidationError(
        `Product '${product.code}' (${product.name}) is a serial/batch/combo product. Only normal goods are supported in v1.`
      );
    }

    // Quantity validation
    const quantity = Number(raw.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
      throw new RequestValidationError(`Item '${product.code}' quantity must be between 0 and 1,000,000`);
    }
    // Up to 3 decimal places
    if (Math.round(quantity * 1000) !== quantity * 1000) {
      throw new RequestValidationError(`Item '${product.code}' quantity cannot exceed 3 decimal places`);
    }

    // Pricing & discount validation based on role
    const catalogPrice = Number(product.price);
    let price = catalogPrice;
    let discountMode: 'amount' | 'percent' = 'amount';
    let discountInput = 0;

    if (isPrivileged) {
      if (raw.price !== undefined && raw.price !== null) {
        const p = Number(raw.price);
        if (!Number.isFinite(p) || p < 0 || p > 100_000_000_000) {
          throw new RequestValidationError(`Item '${product.code}' price must be between 0 and 100,000,000,000`);
        }
        price = p;
      }
      if (raw.discountMode === 'percent' || raw.discountMode === 'amount') {
        discountMode = raw.discountMode;
      }
      if (raw.discountInput !== undefined && raw.discountInput !== null) {
        const d = Number(raw.discountInput);
        if (!Number.isFinite(d) || d < 0) {
          throw new RequestValidationError(`Item '${product.code}' discount must be >= 0`);
        }
        discountInput = d;
      }
    } else {
      // Member is not allowed to override catalog price or apply discounts
      price = catalogPrice;
      discountMode = 'amount';
      discountInput = 0;
    }

    const note = raw.note ? String(raw.note).slice(0, 1000) : null;
    const totals = calculateItemTotal(quantity, price, discountMode, discountInput);

    normalizedItems.push({
      productId: product.id,
      kiotvietProductId: product.kiotvietId,
      retailer,
      branchId,
      productCode: product.code,
      productName: product.name,
      unit: product.unit,
      quantity: totals.quantity,
      price: totals.price,
      discountMode: totals.discountMode,
      discountInput: totals.discountInput,
      discountAmount: totals.discountAmount,
      subtotal: totals.subtotal,
      note,
    });
  }

  const totalAmount = normalizedItems.reduce((sum, item) => sum + item.subtotal, 0);
  if (totalAmount > 100_000_000_000) {
    throw new RequestValidationError('Order total cannot exceed 100,000,000,000 VND');
  }

  return {
    items: normalizedItems,
    totalAmount,
  };
}

/**
 * Validates payment inputs independently of order status.
 */
export function validatePaymentFields(
  paidAmount: number | null | undefined,
  paymentMethod: string | null | undefined,
  paymentAccountId: string | null | undefined,
  totalAmount: number
): {
  paidAmount: number | null;
  paymentMethod: string | null;
  paymentAccountId: bigint | null;
} {
  let normalizedPaid: number | null = null;
  let normalizedMethod: string | null = null;
  let normalizedAccountId: bigint | null = null;

  if (paidAmount !== undefined && paidAmount !== null) {
    const num = Number(paidAmount);
    if (!Number.isFinite(num) || num < 0 || num > totalAmount) {
      throw new RequestValidationError(`paidAmount must be between 0 and totalAmount (${totalAmount})`);
    }
    normalizedPaid = Math.round(num);

    if (normalizedPaid > 0) {
      if (!paymentMethod || !['Cash', 'Transfer', 'Card'].includes(paymentMethod)) {
        throw new RequestValidationError("paymentMethod is required when paidAmount > 0 (must be 'Cash', 'Transfer', or 'Card')");
      }
      normalizedMethod = paymentMethod;
    } else {
      normalizedMethod = paymentMethod && ['Cash', 'Transfer', 'Card'].includes(paymentMethod) ? paymentMethod : null;
    }
  }

  if (paymentAccountId) {
    normalizedAccountId = BigInt(paymentAccountId);
  }

  return {
    paidAmount: normalizedPaid,
    paymentMethod: normalizedMethod,
    paymentAccountId: normalizedAccountId,
  };
}
