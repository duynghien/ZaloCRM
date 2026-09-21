/**
 * KiotViet Product Catalog Sync Worker
 *
 * Manages durable background product catalog synchronization, lease acquisition,
 * incremental/full traversal, and branch-scoped inventory mapping.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { getKiotvietConfig } from './kiotviet-settings-service.js';
import { getKiotvietProductsPage } from './kiotviet-client.js';
import { KiotvietConflictError } from './kiotviet-settings-service.js';
import type { KiotvietCatalogRunMode } from './kiotviet-types.js';

const LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const WORKER_ID = `catalog-worker-${process.pid}-${randomUUID().slice(0, 8)}`;
const PAGE_SIZE = 100;
const MAX_PAGES = 500; // Safety upper bound: 50,000 products

let isRunning = false;
let pollingTimer: NodeJS.Timeout | null = null;
let currentAbortController: AbortController | null = null;

/**
 * Enqueues a catalog sync run. Returns 202-ready payload with durable runId.
 */
export async function enqueueCatalogSync(
  orgId: string,
  mode: KiotvietCatalogRunMode
): Promise<{ runId: string; status: string }> {
  return await prisma.$transaction(async (tx) => {
    const state = await tx.kiotvietSyncState.findUnique({
      where: { orgId },
    });

    if (!state?.retailer || !state.branchId) {
      throw new KiotvietConflictError(
        'KiotViet integration must be configured with retailer and branch before syncing catalog',
        'not_configured'
      );
    }

    // Check for running / queued conflict
    if (state.status === 'queued' || state.status === 'running') {
      if (state.runMode === mode && state.runId) {
        // Idempotent duplicate: return existing runId
        return { runId: state.runId, status: state.status };
      }
      throw new KiotvietConflictError(
        `A catalog sync is already ${state.status} in mode '${state.runMode}'`,
        'sync_in_progress'
      );
    }

    const runId = randomUUID();
    await tx.kiotvietSyncState.update({
      where: { orgId },
      data: {
        status: 'queued',
        runId,
        runMode: mode,
        attemptCount: 0,
        nextAttemptAt: new Date(),
        error: null,
      },
    });

    return { runId, status: 'queued' };
  });
}

/**
 * Process a single catalog sync job for an organization.
 */
async function processCatalogJob(orgId: string): Promise<void> {
  // 1. Atomic lease claim
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);

  const claimedCount = await prisma.kiotvietSyncState.updateMany({
    where: {
      orgId,
      runId: { not: null },
      OR: [
        { status: 'queued' },
        { status: 'running', leaseExpiresAt: { lt: now } },
      ],
    },
    data: {
      status: 'running',
      leaseOwner: WORKER_ID,
      leaseExpiresAt,
      leaseVersion: { increment: 1 },
    },
  });

  if (claimedCount.count !== 1) return;

  const claimed = await prisma.kiotvietSyncState.findUnique({
    where: { orgId },
  });

  if (!claimed || claimed.leaseOwner !== WORKER_ID) return;

  const runId = claimed.runId!;
  const mode = claimed.runMode as KiotvietCatalogRunMode;
  const configRevision = claimed.configRevision;
  const configuredBranchId = claimed.branchId!;
  const retailer = claimed.retailer!;

  logger.info(`[kiotviet-catalog] Starting ${mode} catalog sync for org ${orgId}, runId: ${runId}`);

  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  try {
    const config = await getKiotvietConfig(orgId);
    if (!config || !config.retailer || !config.branchId) {
      throw new Error('KiotViet configuration is invalid or missing');
    }

    let currentItem = 0;
    let pageCount = 0;
    let totalProducts = 0;
    let processedCount = 0;
    const runStartTime = new Date();

    let lastModifiedFrom: string | undefined;
    if (mode === 'incremental' && claimed.catalogCursor) {
      // 5-minute overlap watermark
      const overlapMs = 5 * 60 * 1000;
      lastModifiedFrom = new Date(claimed.catalogCursor.getTime() - overlapMs).toISOString();
    }

    while (pageCount < MAX_PAGES) {
      if (signal.aborted) throw new Error('Catalog sync cancelled');

      // Verify lease and config revision before each page request
      const liveState = await prisma.kiotvietSyncState.findUnique({
        where: { orgId },
        select: { leaseOwner: true, leaseVersion: true, configRevision: true },
      });

      if (
        liveState?.leaseOwner !== WORKER_ID ||
        liveState.leaseVersion !== claimed.leaseVersion ||
        liveState.configRevision !== configRevision
      ) {
        throw new Error('Lost lease or config revision changed during catalog sync');
      }

      const pageResult = await getKiotvietProductsPage(orgId, config, {
        pageSize: PAGE_SIZE,
        currentItem,
        lastModifiedFrom,
        includeInventory: true,
        signal,
      });

      totalProducts = pageResult.total;
      const products = pageResult.data || [];
      if (products.length === 0) break;

      // Upsert batch in transaction
      await prisma.$transaction(async (tx) => {
        for (const item of products) {
          const kiotvietId = BigInt(item.id);
          const code = String(item.code || '').trim();
          const name = String(item.name || '').trim();
          const unit = item.unit ? String(item.unit).trim() : null;
          const price = item.basePrice ?? 0;
          const isActive = item.isActive !== false;
          const allowsSale = item.allowsSale !== false;
          const productType = item.productType || 'normal';
          const hasSerial = Boolean(item.hasSerial);
          const hasBatch = Boolean(item.hasBatch);
          const hasVariants = Boolean(item.hasVariants);
          const isMaster = Boolean(item.isMaster);

          // Find branch stock
          let onHand: number | null = null;
          if (Array.isArray(item.inventories)) {
            const branchInv = item.inventories.find((inv: any) => String(inv.branchId) === String(configuredBranchId));
            if (branchInv && typeof branchInv.onHand === 'number') {
              onHand = branchInv.onHand;
            }
          }

          await tx.kiotvietProduct.upsert({
            where: {
              orgId_retailer_branchId_kiotvietId: {
                orgId,
                retailer,
                branchId: configuredBranchId,
                kiotvietId,
              },
            },
            create: {
              orgId,
              retailer,
              branchId: configuredBranchId,
              kiotvietId,
              code,
              name,
              unit,
              price,
              onHand,
              isActive,
              allowsSale,
              productType,
              hasSerial,
              hasBatch,
              hasVariants,
              isMaster,
              lastSeenRunId: runId,
              stockCheckedAt: new Date(),
            },
            update: {
              code,
              name,
              unit,
              price,
              onHand,
              isActive,
              allowsSale,
              productType,
              hasSerial,
              hasBatch,
              hasVariants,
              isMaster,
              lastSeenRunId: runId,
              stockCheckedAt: new Date(),
            },
          });
        }

        processedCount += products.length;
        await tx.kiotvietSyncState.update({
          where: { orgId },
          data: {
            processedCount,
            totalProducts,
          },
        });
      });

      currentItem += products.length;
      pageCount++;
      if (currentItem >= totalProducts || products.length < PAGE_SIZE) {
        break;
      }
    }

    // Full sync sweep: mark unvisited products in partition as inactive/unavailable
    if (mode === 'full') {
      await prisma.kiotvietProduct.updateMany({
        where: {
          orgId,
          retailer,
          branchId: configuredBranchId,
          lastSeenRunId: { not: runId },
        },
        data: {
          isActive: false,
          allowsSale: false,
        },
      });
    }

    // Final successful commit
    await prisma.kiotvietSyncState.update({
      where: { orgId },
      data: {
        status: 'succeeded',
        catalogReady: true,
        lastSuccessfulAt: runStartTime,
        lastSuccessfulRunId: runId,
        catalogCursor: runStartTime,
        error: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });

    logger.info(`[kiotviet-catalog] Completed ${mode} catalog sync for org ${orgId}: ${processedCount}/${totalProducts} products processed`);
  } catch (err: any) {
    logger.error(`[kiotviet-catalog] Error during sync for org ${orgId}:`, err);
    await prisma.kiotvietSyncState.update({
      where: { orgId },
      data: {
        status: 'failed',
        error: err?.message ? String(err.message).slice(0, 500) : 'Catalog sync failed',
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    }).catch(() => {});
  } finally {
    currentAbortController = null;
  }
}

/**
 * Worker poll tick: searches for pending or expired catalog sync jobs.
 */
export async function tickCatalogWorker(): Promise<void> {
  if (!isRunning) return;

  try {
    const pendingStates = await prisma.kiotvietSyncState.findMany({
      where: {
        OR: [
          { status: 'queued' },
          { status: 'running', leaseExpiresAt: { lt: new Date() } },
        ],
      },
      select: { orgId: true },
      take: 5,
    });

    for (const item of pendingStates) {
      if (!isRunning) break;
      await processCatalogJob(item.orgId);
    }
  } catch (err) {
    logger.error('[kiotviet-catalog] Error during worker tick:', err);
  }
}

/**
 * Starts the catalog worker polling loop.
 */
export function startCatalogWorker(): void {
  if (isRunning) return;
  isRunning = true;
  logger.info('[kiotviet-catalog] Starting catalog worker');

  // Recover any stale leases from previous crashes
  prisma.kiotvietSyncState.updateMany({
    where: {
      status: 'running',
      leaseExpiresAt: { lt: new Date() },
    },
    data: {
      status: 'queued',
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  }).catch(err => logger.error('[kiotviet-catalog] Error recovering stale leases:', err));

  const scheduleNext = () => {
    if (!isRunning) return;
    pollingTimer = setTimeout(async () => {
      await tickCatalogWorker();
      scheduleNext();
    }, 2000); // Poll every 2 seconds
  };

  scheduleNext();
}

/**
 * Stops and drains the catalog worker cleanly before server shutdown.
 */
export async function stopCatalogWorker(): Promise<void> {
  isRunning = false;
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }

  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }

  logger.info('[kiotviet-catalog] Catalog worker stopped');
}
