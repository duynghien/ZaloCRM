/**
 * zalo-health-check.ts — Cron-based health monitor for Zalo account connections.
 * Runs every 5 minutes to detect disconnected accounts and auto-reconnect them.
 * Also runs a daily session refresh at 04:00 UTC to keep cookies fresh.
 */
import cron from 'node-cron';
import { Prisma } from '@prisma/client';
import { zaloPool } from './zalo-pool.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

let zaloHealthTasks: ReturnType<typeof cron.schedule>[] = [];
let shutdownController = new AbortController();
const activeRuns = new Set<Promise<void>>();

function isStopping(): boolean {
  return shutdownController.signal.aborted;
}

function waitOrStop(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    shutdownController.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function track(run: () => Promise<void>): Promise<void> {
  const promise = run().finally(() => activeRuns.delete(promise));
  activeRuns.add(promise);
  return promise;
}

async function runConnectionCheck(): Promise<void> {
  try {
    const accounts = await prisma.zaloAccount.findMany({
      where: { sessionData: { not: Prisma.JsonNull } },
      select: { id: true, displayName: true, sessionData: true },
    });

    for (const acc of accounts) {
      if (isStopping()) return;
      const status = zaloPool.getStatus(acc.id);
      if (status !== 'connected' && status !== 'connecting' && status !== 'qr_pending') {
        const session = acc.sessionData as any;
        if (session?.imei) {
          logger.info(`[health-check] Reconnecting ${acc.displayName || acc.id}...`);
          await zaloPool.reconnect(acc.id, session);
        }
      }
    }
  } catch (err) {
    if (!isStopping()) logger.error('[health-check] Error during health check:', err);
  }
}

async function runDailySessionRefresh(): Promise<void> {
  logger.info('[health-check] Daily session refresh starting...');
  try {
    const accounts = await prisma.zaloAccount.findMany({
      where: { sessionData: { not: Prisma.JsonNull } },
      select: { id: true, sessionData: true },
    });

    for (const acc of accounts) {
      if (isStopping()) return;
      const session = acc.sessionData as any;
      if (session?.imei) {
        zaloPool.disconnect(acc.id);
        await waitOrStop(5000);
        if (isStopping()) return;
        await zaloPool.reconnect(acc.id, session);
      }
      await waitOrStop(10_000);
    }
  } catch (err) {
    if (!isStopping()) logger.error('[health-check] Error during daily refresh:', err);
  }
}

export function startZaloHealthCheck(): void {
  for (const task of zaloHealthTasks) task.stop();
  zaloHealthTasks = [];
  shutdownController = new AbortController();
  // Every 5 minutes: check all accounts with saved sessions
  zaloHealthTasks.push(cron.schedule('*/5 * * * *', () => track(runConnectionCheck)));

  // Daily at 04:00 UTC (11:00 AM VN): refresh all sessions to keep cookies alive
  zaloHealthTasks.push(cron.schedule('0 4 * * *', () => track(runDailySessionRefresh)));

  logger.info('[health-check] Zalo health check started (every 5 min + daily refresh at 04:00 UTC)');
}

export async function stopZaloHealthCheck(): Promise<void> {
  shutdownController.abort();
  for (const task of zaloHealthTasks) task.stop();
  zaloHealthTasks = [];
  await Promise.allSettled(activeRuns);
}
