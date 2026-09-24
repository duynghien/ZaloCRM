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
import { zaloPool } from '../../zalo/zalo-pool.js';
import { emitManagerEvent } from '../../../shared/realtime/socket-event-delivery.js';
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
  const claimResult = await prisma.kiotvietInvoiceJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { state: 'queued' },
        { state: 'preparing', leaseExpiresAt: { lt: now } },
      ],
    },
    data: {
      state: 'preparing',
      leaseOwner: WORKER_ID,
      leaseExpiresAt,
      leaseVersion: { increment: 1 },
      attemptCount: { increment: 1 },
    },
  });

  if (claimResult.count !== 1) return;

  const claimed = await prisma.kiotvietInvoiceJob.findFirst({
    where: {
      id: jobId,
      leaseOwner: WORKER_ID,
    },
  });

  if (!claimed) return;

  let currentLeaseVersion = claimed.leaseVersion;
  const { orgId, orderId, configRevision } = claimed;
  let snapshot = claimed.snapshot as unknown as KiotvietInvoiceSnapshot;

  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  try {
    // 2. Fetch config and verify revision fence
    const config = await getKiotvietConfig(orgId);
    if (!config || config.configRevision !== configRevision) {
      await prisma.$transaction(async (tx) => {
        const updateRes = await tx.kiotvietInvoiceJob.updateMany({
          where: {
            id: jobId,
            leaseOwner: WORKER_ID,
            leaseVersion: currentLeaseVersion,
          },
          data: {
            state: 'failed',
            errorCode: 'config_changed',
            errorMessage: 'Configuration revision changed before dispatch; please review and re-confirm order',
            leaseOwner: null,
            leaseExpiresAt: null,
            leaseVersion: { increment: 1 },
          },
        });
        if (updateRes.count === 1) {
          await tx.order.update({
            where: { id: orderId },
            data: {
              kiotvietSyncStatus: 'failed',
              kiotvietSyncError: 'config_changed',
            },
          });
        }
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
        const updateRes = await prisma.kiotvietInvoiceJob.updateMany({
          where: {
            id: jobId,
            leaseOwner: WORKER_ID,
            leaseVersion: currentLeaseVersion,
          },
          data: {
            snapshot: snapshot as any,
            leaseVersion: { increment: 1 },
          },
        });
        if (updateRes.count !== 1) {
          logger.warn(`[kiotviet-invoice-worker] Lost lease while updating snapshot for job ${jobId}`);
          return;
        }
        currentLeaseVersion += 1;
        // Also persist resolved customerId to order
        await prisma.order.update({
          where: { id: orderId },
          data: { kiotvietCustomerId: BigInt(resolution.customerId) },
        });
      } else {
        // Disambiguation required: fail job and block sync
        const reason = resolution.reason || 'needs_customer_selection';
        await prisma.$transaction(async (tx) => {
          const updateRes = await tx.kiotvietInvoiceJob.updateMany({
            where: {
              id: jobId,
              leaseOwner: WORKER_ID,
              leaseVersion: currentLeaseVersion,
            },
            data: {
              state: 'failed',
              errorCode: reason,
              errorMessage: 'Khách hàng chưa được xác định trên KiotViet. Vui lòng chọn hoặc tạo khách trên giao diện.',
              leaseOwner: null,
              leaseExpiresAt: null,
              leaseVersion: { increment: 1 },
            },
          });
          if (updateRes.count === 1) {
            await tx.order.update({
              where: { id: orderId },
              data: {
                kiotvietSyncStatus: 'failed',
                kiotvietSyncError: reason,
              },
            });
          }
        });
        return;
      }
    }

    // 4. Map payload
    const payload = mapSnapshotToKiotvietInvoice(snapshot, config);

    // 5. Commit dispatching state BEFORE remote POST
    const dispatchClaim = await prisma.kiotvietInvoiceJob.updateMany({
      where: {
        id: jobId,
        leaseOwner: WORKER_ID,
        leaseVersion: currentLeaseVersion,
        state: 'preparing',
      },
      data: {
        state: 'dispatching',
        requestStartedAt: new Date(),
        leaseVersion: { increment: 1 },
      },
    });

    if (dispatchClaim.count !== 1) {
      logger.warn(`[kiotviet-invoice-worker] Failed to transition job ${jobId} to dispatching: lease lost or version mismatch`);
      return;
    }
    currentLeaseVersion += 1;

    // 6. Remote POST to KiotViet /invoices
    let response: { id: number; code: string };
    try {
      response = await createKiotvietInvoice(orgId, config, payload, signal);
    } catch (err: any) {
      // Known rejection (e.g. 400 Bad Request with proof no invoice created)
      if (err instanceof KiotvietApiError && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 408) {
        await prisma.$transaction(async (tx) => {
          const updateRes = await tx.kiotvietInvoiceJob.updateMany({
            where: {
              id: jobId,
              leaseOwner: WORKER_ID,
              leaseVersion: currentLeaseVersion,
            },
            data: {
              state: 'failed',
              errorCode: 'vendor_rejected',
              errorMessage: err.message.slice(0, 500),
              leaseOwner: null,
              leaseExpiresAt: null,
              leaseVersion: { increment: 1 },
            },
          });
          if (updateRes.count === 1) {
            await tx.order.update({
              where: { id: orderId },
              data: {
                kiotvietSyncStatus: 'failed',
                kiotvietSyncError: err.message.slice(0, 500),
              },
            });
          }
        });
        return;
      }

      // Uncertain outcome (5xx, timeout, network error, socket reset after dispatch)
      logger.error(`[kiotviet-invoice-worker] Uncertain invoice dispatch for job ${jobId}:`, err);
      await prisma.$transaction(async (tx) => {
        const updateRes = await tx.kiotvietInvoiceJob.updateMany({
          where: {
            id: jobId,
            leaseOwner: WORKER_ID,
            leaseVersion: currentLeaseVersion,
          },
          data: {
            state: 'uncertain',
            errorCode: 'uncertain_dispatch',
            errorMessage: err?.message ? String(err.message).slice(0, 500) : 'Uncertain dispatch outcome',
            leaseOwner: null,
            leaseExpiresAt: null,
            leaseVersion: { increment: 1 },
          },
        });
        if (updateRes.count === 1) {
          await tx.order.update({
            where: { id: orderId },
            data: {
              kiotvietSyncStatus: 'uncertain',
              kiotvietSyncError: 'Uncertain dispatch outcome. Admin reconciliation required.',
            },
          });
        }
      });

      const io = zaloPool.getIO();
      if (io) {
        await emitManagerEvent(io, orgId, 'kiotviet:invoice_uncertain', {
          jobId,
          orderId,
          orgId,
          reason: 'uncertain_dispatch',
          message: 'Hóa đơn KiotViet kết thúc không xác định khi gửi. Cần đối soát thủ công.',
        }).catch((e) => {
          logger.warn(`[kiotviet-invoice-worker] Failed to emit kiotviet:invoice_uncertain for job ${jobId}:`, e);
        });
      }
      return;
    }

    // 7. Success: commit succeeded state and update order
    const remoteIdBigInt = BigInt(response.id);
    await prisma.$transaction(async (tx) => {
      const fencedUpdate = await tx.kiotvietInvoiceJob.updateMany({
        where: {
          id: jobId,
          leaseOwner: WORKER_ID,
          leaseVersion: currentLeaseVersion,
          state: 'dispatching',
        },
        data: {
          state: 'succeeded',
          remoteInvoiceId: remoteIdBigInt,
          remoteInvoiceCode: response.code,
          errorMessage: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          leaseVersion: { increment: 1 },
        },
      });

      if (fencedUpdate.count === 1) {
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

        logger.info(`[kiotviet-invoice-worker] Successfully created KiotViet invoice ${response.code} (ID: ${response.id}) for order ${orderId}`);
      } else {
        // Late response handling: if job was moved to 'uncertain' by stale dispatch recovery
        const lateUpdate = await tx.kiotvietInvoiceJob.updateMany({
          where: {
            id: jobId,
            state: 'uncertain',
          },
          data: {
            remoteInvoiceId: remoteIdBigInt,
            remoteInvoiceCode: response.code,
            errorMessage: 'Late HTTP response received after stale dispatch recovery; invoice confirmed created on KiotViet',
          },
        });

        if (lateUpdate.count === 1) {
          await tx.order.updateMany({
            where: { id: orderId },
            data: {
              kiotvietInvoiceId: remoteIdBigInt,
              kiotvietInvoiceCode: response.code,
              kiotvietSyncError: 'Late invoice confirmation received. KiotViet invoice code: ' + response.code,
            },
          });
          logger.warn(`[kiotviet-invoice-worker] Late response recorded for uncertain job ${jobId} (KiotViet Code: ${response.code})`);
        } else {
          const reconciledAt = new Date();
          const lateReconciled = await tx.kiotvietInvoiceJob.updateMany({
            where: {
              id: jobId,
              state: 'failed',
              reconciliationStatus: 'confirmed_not_created',
              remoteInvoiceId: null,
            },
            data: {
              state: 'succeeded',
              remoteInvoiceId: remoteIdBigInt,
              remoteInvoiceCode: response.code,
              reconciliationStatus: 'matched',
              reconciledAt,
              errorCode: null,
              errorMessage: null,
              leaseOwner: null,
              leaseExpiresAt: null,
              leaseVersion: { increment: 1 },
            },
          });

          if (lateReconciled.count === 1) {
            const orderUpdated = await tx.order.updateMany({
              where: { id: orderId, kiotvietSyncStatus: 'failed' },
              data: {
                kiotvietSyncStatus: 'synced',
                kiotvietInvoiceId: remoteIdBigInt,
                kiotvietInvoiceCode: response.code,
                kiotvietSyncedAt: reconciledAt,
                kiotvietSyncError: null,
              },
            });
            if (orderUpdated.count !== 1) {
              throw new Error('Late invoice order projection conflict');
            }
            logger.error(
              { jobId, orderId, remoteInvoiceCode: response.code },
              '[kiotviet-invoice-worker] reconciliation_late_remote_match: Late response received for job marked confirmed_not_created'
            );
          } else {
            logger.error(`[kiotviet-invoice-worker] Lease fencing failed and job ${jobId} not uncertain or confirmed_not_created. Response discarded.`);
          }
        }
      }
    });
  } catch (err: any) {
    logger.error(`[kiotviet-invoice-worker] Unexpected error processing job ${jobId}:`, err);
  } finally {
    currentAbortController = null;
  }
}

export const DISPATCH_STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Recovers stale jobs in dispatching state that have exceeded the dispatch stale threshold.
 */
export async function recoverStaleDispatchedJobs(thresholdMs = DISPATCH_STALE_THRESHOLD_MS): Promise<void> {
  const staleThreshold = new Date(Date.now() - thresholdMs);
  const staleJobs = await prisma.kiotvietInvoiceJob.findMany({
    where: {
      state: 'dispatching',
      requestStartedAt: { lt: staleThreshold },
    },
    select: {
      id: true,
      orgId: true,
      orderId: true,
    },
  });

  if (staleJobs.length === 0) return;

  for (const job of staleJobs) {
    try {
      let recovered = false;
      await prisma.$transaction(async (tx) => {
        const updated = await tx.kiotvietInvoiceJob.updateMany({
          where: {
            id: job.id,
            state: 'dispatching',
            requestStartedAt: { lt: staleThreshold },
          },
          data: {
            state: 'uncertain',
            errorCode: 'dispatch_timeout',
            errorMessage: 'Invoice dispatch timed out in dispatching state. Manual admin reconciliation required.',
            leaseOwner: null,
            leaseExpiresAt: null,
            leaseVersion: { increment: 1 },
          },
        });

        if (updated.count > 0) {
          recovered = true;
          await tx.order.updateMany({
            where: { id: job.orderId },
            data: {
              kiotvietSyncStatus: 'uncertain',
              kiotvietSyncError: 'Invoice dispatch timed out in dispatching state. Admin reconciliation required.',
            },
          });
        }
      });

      if (recovered) {
        logger.warn(`[kiotviet-invoice-worker] Recovered stale dispatched job ${job.id} to uncertain`);

        const io = zaloPool.getIO();
        if (io) {
          await emitManagerEvent(io, job.orgId, 'kiotviet:invoice_uncertain', {
            jobId: job.id,
            orderId: job.orderId,
            orgId: job.orgId,
            reason: 'dispatch_timeout',
            message: 'Hóa đơn KiotViet bị gián đoạn trong lúc gửi. Cần đối soát thủ công.',
          }).catch((err) => {
            logger.warn(`[kiotviet-invoice-worker] Failed to emit kiotviet:invoice_uncertain for job ${job.id}:`, err);
          });
        }
      }
    } catch (err) {
      logger.error(`[kiotviet-invoice-worker] Failed to recover stale job ${job.id}:`, err);
    }
  }
}

/**
 * Worker tick: checks for queued jobs and executes them.
 */
export async function tickInvoiceWorker(): Promise<void> {
  if (!isRunning) return;

  try {
    await recoverStaleDispatchedJobs();

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

  // Recover stale dispatching jobs
  recoverStaleDispatchedJobs().catch(err => logger.error('[kiotviet-invoice-worker] Error recovering stale dispatching jobs:', err));

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
