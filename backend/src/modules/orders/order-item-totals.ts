import { Prisma } from '@prisma/client';

export interface CalculatedItemTotal {
  quantity: number;
  price: number;
  discountMode: 'amount' | 'percent';
  discountInput: number;
  discountAmount: number;
  subtotal: number;
}

/**
 * Calculates discount amount and subtotal for an order item using VND rounding rules.
 */
export function calculateItemTotal(
  quantity: number,
  price: number,
  discountMode: 'amount' | 'percent' = 'amount',
  discountInput = 0
): CalculatedItemTotal {
  const gross = quantity * price;

  let discountAmount = 0;
  if (discountMode === 'percent') {
    const clampedPercent = Math.min(Math.max(0, discountInput), 100);
    discountAmount = Math.round((gross * clampedPercent) / 100);
  } else {
    discountAmount = Math.min(Math.max(0, discountInput), gross);
  }

  const subtotal = Math.max(0, Math.round(gross - discountAmount));

  return {
    quantity,
    price,
    discountMode,
    discountInput,
    discountAmount,
    subtotal,
  };
}

/**
 * Calculates sum of all item subtotals.
 */
export function calculateOrderTotal(items: CalculatedItemTotal[]): number {
  return items.reduce((sum, item) => sum + item.subtotal, 0);
}
