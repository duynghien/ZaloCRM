/**
 * KiotViet Invoice Reconciliation Service
 *
 * Implements admin reconciliation actions: link, refresh, and confirm-not-created.
 */

import { prisma } from '../../../shared/database/prisma-client.js';
import { getKiotvietConfig, KiotvietConflictError } from './kiotviet-settings-service.js';
import { getKiotvietInvoice } from './kiotviet-client.js';
import { RequestValidationError } from '../../../shared/http/request-schemas.js';
import type { KiotvietInvoiceSnapshot } from './kiotviet-types.js';

export interface ReconcileInvoiceParams {
  orgId: string;
  orderId: string;
  action: 'link' | 'refresh' | 'confirm-not-created';
  remoteInvoiceId?: string;
  reason?: string;
  actorId: string;
}

export async function reconcileInvoice(params: ReconcileInvoiceParams) {
  const { orgId, orderId, action, remoteInvoiceId, reason, actorId } = params;

  return await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, orgId },
      include: { kiotvietJob: true },
    });

    if (!order) {
      throw new KiotvietConflictError('Order not found', 'order_not_found');
    }

    const job = order.kiotvietJob;
    if (!job) {
      throw new KiotvietConflictError('Order has no KiotViet invoice job to reconcile', 'no_job');
    }

    const config = await getKiotvietConfig(orgId, tx);
    if (!config || !config.retailer) {
      throw new KiotvietConflictError('KiotViet integration not configured', 'not_configured');
    }

    const now = new Date();

    if (action === 'confirm-not-created') {
      if (!reason || reason.trim().length < 5) {
        throw new RequestValidationError('A detailed reason (minimum 5 characters) is required to confirm invoice was not created');
      }

      // Transition job to failed and order to failed, allowing re-confirmation
      await tx.kiotvietInvoiceJob.update({
        where: { id: job.id },
        data: {
          state: 'failed',
          errorCode: 'confirmed_not_created',
          errorMessage: reason.trim(),
          reconciliationStatus: 'confirmed_not_created',
          reconciledAt: now,
          reconciledByUserId: actorId,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });

      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          kiotvietSyncStatus: 'failed',
          kiotvietSyncError: `Confirmed not created: ${reason.trim()}`,
        },
      });

      await tx.activityLog.create({
        data: {
          orgId,
          userId: actorId,
          action: 'kiotviet_invoice_reconciled_not_created',
          entityType: 'order',
          entityId: orderId,
          details: { jobId: job.id, reason: reason.trim() },
        },
      });

      return { order: updatedOrder, action: 'confirm-not-created' };
    }

    if (action === 'link') {
      if (!remoteInvoiceId || !/^\d+$/.test(remoteInvoiceId.trim())) {
        throw new RequestValidationError('A valid numeric remoteInvoiceId is required to link an existing KiotViet invoice');
      }

      const remoteIdBigInt = BigInt(remoteInvoiceId.trim());

      // Check if already linked to another order/job globally for this retailer
      const existingJob = await tx.kiotvietInvoiceJob.findFirst({
        where: {
          retailer: config.retailer,
          remoteInvoiceId: remoteIdBigInt,
          id: { not: job.id },
        },
      });

      if (existingJob) {
        throw new KiotvietConflictError(
          `Remote invoice ID ${remoteInvoiceId} is already linked to another order (orderId: ${existingJob.orderId})`,
          'invoice_already_linked'
        );
      }

      // Fetch invoice from KiotViet to verify details
      const remoteInvoice = await getKiotvietInvoice(orgId, config, remoteInvoiceId.trim());
      if (!remoteInvoice || !remoteInvoice.id) {
        throw new KiotvietConflictError(
          `Invoice ID ${remoteInvoiceId} was not found on KiotViet`,
          'remote_invoice_not_found'
        );
      }

      const remoteCode = remoteInvoice.code || `HD${remoteInvoice.id}`;

      await tx.kiotvietInvoiceJob.update({
        where: { id: job.id },
        data: {
          state: 'succeeded',
          remoteInvoiceId: remoteIdBigInt,
          remoteInvoiceCode: remoteCode,
          remoteSnapshot: remoteInvoice as any,
          reconciliationStatus: 'matched',
          reconciledAt: now,
          reconciledByUserId: actorId,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });

      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          kiotvietSyncStatus: 'synced',
          kiotvietInvoiceId: remoteIdBigInt,
          kiotvietInvoiceCode: remoteCode,
          kiotvietSyncedAt: now,
          kiotvietSyncError: null,
        },
      });

      await tx.activityLog.create({
        data: {
          orgId,
          userId: actorId,
          action: 'kiotviet_invoice_reconciled_linked',
          entityType: 'order',
          entityId: orderId,
          details: { jobId: job.id, remoteInvoiceId, remoteCode, reason },
        },
      });

      return { order: updatedOrder, action: 'link', remoteInvoiceCode: remoteCode };
    }

    if (action === 'refresh') {
      if (!job.remoteInvoiceId) {
        throw new KiotvietConflictError('Cannot refresh an order without a linked remote invoice ID', 'no_remote_id');
      }

      const remoteInvoice = await getKiotvietInvoice(orgId, config, job.remoteInvoiceId.toString());
      const isCancelled = remoteInvoice?.status === 2 || remoteInvoice?.statusValue === 'Đã hủy';
      const statusLabel = isCancelled ? 'remote_cancelled' : 'matched';

      await tx.kiotvietInvoiceJob.update({
        where: { id: job.id },
        data: {
          remoteSnapshot: remoteInvoice as any,
          reconciliationStatus: statusLabel,
          reconciledAt: now,
          reconciledByUserId: actorId,
        },
      });

      await tx.activityLog.create({
        data: {
          orgId,
          userId: actorId,
          action: 'kiotviet_invoice_reconciled_refreshed',
          entityType: 'order',
          entityId: orderId,
          details: { jobId: job.id, status: statusLabel },
        },
      });

      return { order, action: 'refresh', status: statusLabel };
    }

    throw new RequestValidationError(`Unsupported reconciliation action: ${action}`);
  });
}
