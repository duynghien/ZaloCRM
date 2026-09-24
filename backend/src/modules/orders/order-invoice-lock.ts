/**
 * Order Invoice Locking Policy
 *
 * Enforces financial field immutability and cancellation/deletion locks
 * when an order's KiotViet invoice sync status is pending, uncertain, or synced,
 * or whenever a remote KiotViet invoice ID is present.
 */

import { KiotvietConflictError } from '../integrations/kiotviet/kiotviet-settings-service.js';

export const LOCKED_SYNC_STATUSES = ['pending', 'uncertain', 'synced'] as const;

export type OrderFinancialLockSubject =
  | string
  | { kiotvietSyncStatus?: string | null; kiotvietInvoiceId?: bigint | number | null };

export function isOrderFinancialLocked(subject: OrderFinancialLockSubject): boolean {
  if (typeof subject === 'object' && subject !== null) {
    return (
      subject.kiotvietInvoiceId != null ||
      LOCKED_SYNC_STATUSES.includes((subject.kiotvietSyncStatus ?? '') as any)
    );
  }
  return LOCKED_SYNC_STATUSES.includes(subject as any);
}

/**
 * Asserts that financial modifications, cancellation, or deletion are permitted for the given order.
 * Throws KiotvietConflictError (409) if the order is locked.
 */
export function assertOrderNotLockedForFinancialChanges(
  subject: OrderFinancialLockSubject,
  attemptedAction: 'financial_update' | 'cancel' | 'delete'
): void {
  if (!isOrderFinancialLocked(subject)) return;

  const statusStr =
    typeof subject === 'object' && subject !== null
      ? subject.kiotvietInvoiceId != null
        ? 'synced'
        : subject.kiotvietSyncStatus ?? 'unknown'
      : subject;

  const actionDesc =
    attemptedAction === 'cancel'
      ? 'cancel order'
      : attemptedAction === 'delete'
      ? 'delete order'
      : 'modify financial fields or items';

  throw new KiotvietConflictError(
    `Cannot ${actionDesc} while KiotViet invoice is in '${statusStr}' state. Please reconcile or adjust directly on KiotViet.`,
    'order_locked_by_kiotviet'
  );
}
