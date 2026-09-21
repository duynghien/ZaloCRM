/**
 * KiotViet Invoice Dispatch Worker
 *
 * Durable background worker that claims queued invoice jobs, executes atomic preflight,
 * commits dispatching state before remote POST, and enforces the uncertain state machine.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { getKiotvietConfig } from './kiotviet-settings-service.js';
import { createKiotvietInvoice, KiotvietApiError } from './kiotviet-client.js';
import { mapSnapshotToKiotvietInvoice } from './kiotviet-invoice-mapper.js';
import { resolveCustomerIdForOrder } from './kiotviet-customer-service.js';
import type { KiotvietInvoiceSnapshot } from './kiotviet-types.js';

const LEASE_DURATION_MS = 2 * 60 * 1000; // 2 minutes
const WORKER_ID = `invoice-worker-${process.pid}-${randomUUID().slice(0, 8)}`;

let isRunning = false;
let pollingTimer: NodeJS.Timeout | null = null;
let currentAbortController: AbortController | null = null;

/**
 * Processes a single invoice job.
 */
async function processInvoiceJob(jobId: string): Promise<void> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);

  // 1. Atomic claim via CAS
  const claimed = await prisma.$transaction(async (tx) => {
    const job = await tx.kiotvietInvoiceJob.findFirst({
      where: {
        id: jobId,
        OR: [
          { state: 'queued' },
          { state: 'preparing', leaseExpiresAt: { lt: now } },
        ],
      },
    });

    if (!job) return null;

    return await tx.kiotvietInvoiceJob.update({
      where: { id: jobId },
      data: {
        state: 'preparing',
        leaseOwner: WORKER_ID,
        leaseExpiresAt,
        leaseVersion: { increment: 1 },
        attemptCount: { increment: 1 },
      },
    });
  });

  if (!claimed) return;

  const { orgId, orderId, configRevision } = claimed;
  let snapshot = claimed.snapshot as unknown as KiotvietInvoiceSnapshot;

  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  try {
    // 2. Fetch config and verify revision fence
    const config = await getKiotvietConfig(orgId);
    if (!config || config.configRevision !== configRevision) {
      await prisma.$transaction(async (tx) => {
        await tx.kiotvietInvoiceJob.update({
          where: { id: jobId },
          data: {
            state: 'failed',
            errorCode: 'config_changed',
            errorMessage: 'Configuration revision changed before dispatch; please review and re-confirm order',
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        await tx.order.update({
          where: { id: orderId },
          data: {
            kiotvietSyncStatus: 'failed',
            kiotvietSyncError: 'config_changed',
          },
        });
      });
      return;
    }

    // 3. Customer resolution pre-gate: if missing, attempt automated phone match
    if (!snapshot.kiotvietCustomerId && snapshot.customerPhone) {
      const resolution = await resolveCustomerIdForOrder(
        orgId,
        config,
        { kiotvietCustomerId: null },
        { phone: snapshot.customerPhone, fullName: snapshot.customerName }
      );

      if (resolution.customerId) {
        snapshot = {
          ...snapshot,
          kiotvietCustomerId: resolution.customerId,
          customerName: resolution.customerName ?? snapshot.customerName,
        };
        await prisma.kiotvietInvoiceJob.update({
          where: { id: jobId },
          data: { snapshot: snapshot as any },
        });
        // Also persist resolved customerId to order
        await prisma.order.update({
          where: { id: orderId },
          data: { kiotvietCustomerId: BigInt(resolution.customerId) },
        });
      } else {
        // Disambiguation required: fail job and block sync
        const reason = resolution.reason || 'needs_customer_selection';
        await prisma.$transaction(async (tx) => {
          await tx.kiotvietInvoiceJob.update({
            where: { id: jobId },
            data: {
              state: 'failed',
              errorCode: reason,
              errorMessage: 'Khách hàng chưa được xác định trên KiotViet. Vui lòng chọn hoặc tạo khách trên giao diện.',
              leaseOwner: null,
              leaseExpiresAt: null,
            },
          });
          await tx.order.update({
            where: { id: orderId },
            data: {
              kiotvietSyncStatus: 'failed',
              kiotvietSyncError: reason,
            },
          });
        });
        return;
      }
    }

    // 4. Map payload
    const payload = mapSnapshotToKiotvietInvoice(snapshot, config);

    // 5. Commit dispatching state BEFORE remote POST
    await prisma.kiotvietInvoiceJob.update({
      where: { id: jobId },
      data: {
        state: 'dispatching',
        requestStartedAt: new Date(),
      },
    });

    // 6. Remote POST to KiotViet /invoices
    let response: { id: number; code: string };
    try {
      response = await createKiotvietInvoice(orgId, config, payload, signal);
    } catch (err: any) {
      // Known rejection (e.g. 400 Bad Request with proof no invoice created)
      if (err instanceof KiotvietApiError && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 408) {
        await prisma.$transaction(async (tx) => {
          await tx.kiotvietInvoiceJob.update({
            where: { id: jobId },
            data: {
              state: 'failed',
              errorCode: 'vendor_rejected',
              errorMessage: err.message.slice(0, 500),
              leaseOwner: null,
              leaseExpiresAt: null,
            },
          });
          await tx.order.update({
            where: { id: orderId },
            data: {
              kiotvietSyncStatus: 'failed',
              kiotvietSyncError: err.message.slice(0, 500),
            },
          });
        });
        return;
      }

      // Uncertain outcome (5xx, timeout, network error, socket reset after dispatch)
      logger.error(`[kiotviet-invoice-worker] Uncertain invoice dispatch for job ${jobId}:`, err);
      await prisma.$transaction(async (tx) => {
        await tx.kiotvietInvoiceJob.update({
          where: { id: jobId },
          data: {
            state: 'uncertain',
            errorCode: 'uncertain_dispatch',
            errorMessage: err?.message ? String(err.message).slice(0, 500) : 'Uncertain dispatch outcome',
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        await tx.order.update({
          where: { id: orderId },
          data: {
            kiotvietSyncStatus: 'uncertain',
            kiotvietSyncError: 'Uncertain dispatch outcome. Admin reconciliation required.',
          },
        });
      });
      return;
    }

    // 7. Success: commit succeeded state and update order
    const remoteIdBigInt = BigInt(response.id);
    await prisma.$transaction(async (tx) => {
      await tx.kiotvietInvoiceJob.update({
        where: { id: jobId },
        data: {
          state: 'succeeded',
          remoteInvoiceId: remoteIdBigInt,
          remoteInvoiceCode: response.code,
          errorMessage: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });

      // CAS separation: update order where kiotvietSyncStatus == 'pending'
      await tx.order.updateMany({
        where: {
          id: orderId,
          kiotvietSyncStatus: 'pending',
        },
        data: {
          kiotvietSyncStatus: 'synced',
          kiotvietInvoiceId: remoteIdBigInt,
          kiotvietInvoiceCode: response.code,
          kiotvietSyncedAt: new Date(),
          kiotvietSyncError: null,
        },
      });

      await tx.activityLog.create({
        data: {
          orgId,
          action: 'kiotviet_invoice_synced',
          entityType: 'order',
          entityId: orderId,
          details: {
            jobId,
            remoteInvoiceId: response.id,
            remoteInvoiceCode: response.code,
          },
        },
      });
    });

    logger.info(`[kiotviet-invoice-worker] Successfully created KiotViet invoice ${response.code} (ID: ${response.id}) for order ${orderId}`);
  } catch (err: any) {
    logger.error(`[kiotviet-invoice-worker] Unexpected error processing job ${jobId}:`, err);
  } finally {
    currentAbortController = null;
  }
}

/**
 * Worker tick: checks for queued jobs and executes them.
 */
export async function tickInvoiceWorker(): Promise<void> {
  if (!isRunning) return;

  try {
    const jobs = await prisma.kiotvietInvoiceJob.findMany({
      where: {
        OR: [
          { state: 'queued' },
          { state: 'preparing', leaseExpiresAt: { lt: new Date() } },
        ],
      },
      select: { id: true },
      take: 5,
    });

    for (const job of jobs) {
      if (!isRunning) break;
      await processInvoiceJob(job.id);
    }
  } catch (err) {
    logger.error('[kiotviet-invoice-worker] Error during worker tick:', err);
  }
}

/**
 * Starts the invoice worker.
 */
export function startInvoiceWorker(): void {
  if (isRunning) return;
  isRunning = true;
  logger.info('[kiotviet-invoice-worker] Starting invoice worker');

  // Recover stale leases
  prisma.kiotvietInvoiceJob.updateMany({
    where: {
      state: 'preparing',
      leaseExpiresAt: { lt: new Date() },
    },
    data: {
      state: 'queued',
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  }).catch(err => logger.error('[kiotviet-invoice-worker] Error recovering stale leases:', err));

  const scheduleNext = () => {
    if (!isRunning) return;
    pollingTimer = setTimeout(async () => {
      await tickInvoiceWorker();
      scheduleNext();
    }, 2000);
  };

  scheduleNext();
}

/**
 * Stops and drains the invoice worker cleanly.
 */
export async function stopInvoiceWorker(): Promise<void> {
  isRunning = false;
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }

  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }

  logger.info('[kiotviet-invoice-worker] Invoice worker stopped');
}
