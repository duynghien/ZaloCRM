/**
 * KiotViet Customer Resolution Service
 *
 * Implements customer matching by normalized phone number with human-in-the-loop fallback.
 * Invariant: Never guesses or auto-upserts customer when ambiguous.
 */

import { searchKiotvietCustomersByPhone } from './kiotviet-client.js';
import type { KiotvietConfig } from './kiotviet-types.js';

export interface CustomerResolutionResult {
  customerId: string | null;
  customerName?: string;
  reason?: 'needs_customer_selection' | 'no_phone' | 'vendor_error';
}

export async function resolveCustomerIdForOrder(
  orgId: string,
  config: KiotvietConfig,
  order: { kiotvietCustomerId?: bigint | null },
  contact: { phone?: string | null; fullName?: string | null }
): Promise<CustomerResolutionResult> {
  // 1. If already explicitly linked/saved on the order, use it
  if (order.kiotvietCustomerId) {
    return { customerId: order.kiotvietCustomerId.toString() };
  }

  // 2. Normalize contact phone number
  const rawPhone = contact.phone ? contact.phone.trim() : '';
  const normalizedPhone = rawPhone.replace(/\D/g, '');

  if (!normalizedPhone || normalizedPhone.length < 3) {
    return { customerId: null, reason: 'no_phone' };
  }

  // 3. Search KiotViet customers by phone
  try {
    const customers = await searchKiotvietCustomersByPhone(orgId, config, normalizedPhone);

    if (customers.length === 1) {
      return {
        customerId: customers[0].id,
        customerName: customers[0].name,
      };
    }

    // 0 or >1 matches: requires explicit staff selection on UI
    return {
      customerId: null,
      reason: 'needs_customer_selection',
    };
  } catch {
    return {
      customerId: null,
      reason: 'vendor_error',
    };
  }
}
