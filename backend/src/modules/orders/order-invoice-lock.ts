/**
 * Order Invoice Locking Policy
 *
 * Enforces financial field immutability and cancellation/deletion locks
 * when an order's KiotViet invoice sync status is pending, uncertain, or synced.
 */

import { KiotvietConflictError } from '../integrations/kiotviet/kiotviet-settings-service.js';

export const LOCKED_SYNC_STATUSES = ['pending', 'uncertain', 'synced'] as const;

export function isOrderFinancialLocked(syncStatus: string): boolean {
  return LOCKED_SYNC_STATUSES.includes(syncStatus as any);
}

/**
 * Asserts that financial modifications or cancellation are permitted for the given order.
 * Throws KiotvietConflictError (409) if the order is locked.
 */
export function assertOrderNotLockedForFinancialChanges(
  syncStatus: string,
  attemptedAction: 'financial_update' | 'cancel' | 'delete'
): void {
  if (isOrderFinancialLocked(syncStatus)) {
    const actionDesc =
      attemptedAction === 'cancel'
        ? 'cancel order'
        : attemptedAction === 'delete'
        ? 'delete order'
        : 'modify financial fields or items';

    throw new KiotvietConflictError(
      `Cannot ${actionDesc} while KiotViet invoice is in '${syncStatus}' state. Please reconcile or adjust directly on KiotViet.`,
      'order_locked_by_kiotviet'
    );
  }
}
