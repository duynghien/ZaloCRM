/**
 * KiotViet Invoice Service
 *
 * Handles atomic order snapshotting, eligibility validation, and durable invoice job enqueueing.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/database/prisma-client.js';
import { getKiotvietConfig, KiotvietConflictError } from './kiotviet-settings-service.js';
import { isOrderFinancialLocked } from '../../orders/order-invoice-lock.js';
import type { KiotvietInvoiceSnapshot, KiotvietSnapshotItem } from './kiotviet-types.js';

export const ELIGIBLE_ORDER_STATUSES = ['confirmed', 'paid', 'shipped', 'completed'];

export interface EnqueueInvoiceParams {
  orderId: string;
  orgId: string;
  mode: 'automatic' | 'manual';
  expectedRevision?: number;
  actorId?: string;
}

export function computeSnapshotHash(snapshot: KiotvietInvoiceSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

/**
 * Validates eligibility and enqueues an invoice job within an existing transaction.
 */
export async function enqueueInvoiceTx(tx: Prisma.TransactionClient, params: EnqueueInvoiceParams) {
  const { orderId, orgId, mode, expectedRevision, actorId } = params;

  // 1. Fetch order with items and contact
  const order = await tx.order.findFirst({
    where: { id: orderId, orgId },
    include: {
      items: true,
      contact: true,
      kiotvietJob: true,
    },
  });

    if (!order) {
      throw new KiotvietConflictError('Order not found', 'order_not_found');
    }

    // 2. Check existing job state
    if (order.kiotvietSyncStatus === 'synced') {
      return { order, jobId: order.kiotvietJob?.id ?? null, alreadySynced: true };
    }

    if (order.kiotvietSyncStatus === 'pending' && order.kiotvietJob) {
      return { order, jobId: order.kiotvietJob.id, alreadyPending: true };
    }

    if (order.kiotvietSyncStatus === 'uncertain') {
      throw new KiotvietConflictError(
        'Order invoice sync outcome is uncertain. Admin reconciliation is required before retrying.',
        'reconcile_required'
      );
    }

    // 3. Verify revision fence if provided
    if (expectedRevision !== undefined && expectedRevision !== null && order.revision !== expectedRevision) {
      throw new KiotvietConflictError(
        `Order revision mismatch: expected ${expectedRevision}, got ${order.revision}`,
        'order_revision_mismatch'
      );
    }

    // 4. Check eligibility
    if (!ELIGIBLE_ORDER_STATUSES.includes(order.status)) {
      throw new KiotvietConflictError(
        `Order status '${order.status}' is not eligible for KiotViet invoice sync (must be confirmed, paid, shipped, or completed)`,
        'order_not_eligible'
      );
    }

    if (!order.items || order.items.length === 0) {
      throw new KiotvietConflictError(
        'Order must contain at least one product item before creating a KiotViet invoice',
        'items_required'
      );
    }

    // 5. Fetch execution config
    const config = await getKiotvietConfig(orgId, tx);
    if (!config || !config.retailer || !config.branchId) {
      throw new KiotvietConflictError('KiotViet integration is not configured', 'not_configured');
    }

    if (mode === 'automatic' && !config.autoSync) {
      return { order, jobId: null, autoSyncDisabled: true };
    }

    // 6. Build immutable snapshot
    const snapshotItems: KiotvietSnapshotItem[] = order.items.map(item => ({
      kiotvietProductId: item.kiotvietProductId.toString(),
      productCode: item.productCode,
      productName: item.productName,
      unit: item.unit,
      quantity: Number(item.quantity),
      price: Number(item.price),
      discountMode: item.discountMode,
      discountInput: Number(item.discountInput),
      discountAmount: Number(item.discountAmount),
      subtotal: Number(item.subtotal),
      note: item.note,
    }));

    const snapshot: KiotvietInvoiceSnapshot = {
      orderId: order.id,
      orderCode: order.orderCode,
      orgId: order.orgId,
      retailer: config.retailer,
      branchId: config.branchId,
      kiotvietCustomerId: order.kiotvietCustomerId ? order.kiotvietCustomerId.toString() : null,
      customerName: order.contact?.fullName ?? null,
      customerPhone: order.contact?.phone ?? null,
      customerAddress: null,
      items: snapshotItems,
      totalAmount: order.totalAmount,
      paidAmount: order.paidAmount ? Number(order.paidAmount) : null,
      paymentMethod: order.paymentMethod,
      paymentAccountId: order.paymentAccountId ? order.paymentAccountId.toString() : null,
      configRevision: config.configRevision,
    };

    const snapshotHash = computeSnapshotHash(snapshot);
    const branchIdBigInt = BigInt(config.branchId);

    // 7. Upsert KiotvietInvoiceJob
    const job = await tx.kiotvietInvoiceJob.upsert({
      where: { orgId_orderId: { orgId, orderId } },
      create: {
        id: randomUUID(),
        orgId,
        orderId,
        orderRevision: order.revision,
        configRevision: config.configRevision,
        retailer: config.retailer,
        branchId: branchIdBigInt,
        snapshot: snapshot as any,
        snapshotHash,
        state: 'queued',
        attemptCount: 0,
      },
      update: {
        orderRevision: order.revision,
        configRevision: config.configRevision,
        retailer: config.retailer,
        branchId: branchIdBigInt,
        snapshot: snapshot as any,
        snapshotHash,
        state: 'queued',
        attemptCount: 0,
        errorCode: null,
        errorMessage: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });

    // 8. Update Order status projection
    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: {
        kiotvietSyncStatus: 'pending',
        kiotvietSyncError: null,
      },
    });

    // 9. Audit log
    await tx.activityLog.create({
      data: {
        orgId,
        userId: actorId ?? order.createdByUserId,
        action: 'kiotviet_invoice_enqueued',
        entityType: 'order',
        entityId: order.id,
        details: {
          jobId: job.id,
          mode,
          orderCode: order.orderCode,
          configRevision: config.configRevision,
        },
      },
    });

    return { order: updatedOrder, jobId: job.id };
}

/**
 * Convenience wrapper that runs enqueueInvoiceTx in its own transaction.
 */
export async function enqueueInvoice(params: EnqueueInvoiceParams) {
  return await prisma.$transaction(async (tx) => enqueueInvoiceTx(tx, params));
}
