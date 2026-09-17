import { closeReportAdmission } from './modules/ai-reports/report-admission.js';
/** Production lifecycle: HTTP, scheduled work, SDK listeners and fatal shutdown. */
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { createApp } from './app-factory.js';
import { config } from './config/index.js';
import { prisma } from './shared/database/prisma-client.js';
import { logger } from './shared/utils/logger.js';
import { zaloPool } from './modules/zalo/zalo-pool.js';
import { startAppointmentReminder, stopAppointmentReminder } from './modules/contacts/appointment-reminder.js';
import { startZaloHealthCheck, stopZaloHealthCheck } from './modules/zalo/zalo-health-check.js';
import { startReportCronJobs, stopReportCronJobs } from './modules/ai-reports/report-cron.js';
import { startReportJobWorker, stopReportJobWorker } from './modules/ai-reports/report-job-worker.js';
import { decryptData } from './shared/utils/crypto.js';
import { validateConfiguredGeminiModel } from './modules/ai-reports/ai-client.js';
import { chatTurnDebouncer } from './modules/chat/copilot/chat-turn-debouncer.js';
import { startOrphanCleanupTask, stopOrphanCleanupTask } from './modules/attachments/orphan-cleanup-task.js';

let application: FastifyInstance | undefined;
let shutdownPromise: Promise<void> | undefined;

async function shutdown(exitCode: number, cause: string): Promise<void> {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    logger.error(`[lifecycle] Shutting down after ${cause}`);
    const forceExit = setTimeout(() => process.exit(1), 65_000);
    forceExit.unref();

    try {
      closeReportAdmission();
      chatTurnDebouncer.cleanup();
      await Promise.all([
        stopReportCronJobs(),
        stopReportJobWorker(),
        stopAppointmentReminder(),
        stopOrphanCleanupTask(),
      ]);
      await stopZaloHealthCheck();
      zaloPool.disconnectAll();
      await zaloPool.drain();
      await application?.close();
      await prisma.$disconnect();
    } catch (error) {
      logger.error('[lifecycle] Graceful shutdown failed:', error);
      exitCode = 1;
    } finally {
      clearTimeout(forceExit);
      process.exit(exitCode);
    }
  })();

  return shutdownPromise;
}

async function bootstrap() {
  const app = await createApp();
  application = app;
  zaloPool.setIO(app.io);
  // ── Start ─────────────────────────────────────────────────────────────────

  try {
    if (config.aiPrimaryProvider === 'gemini') {
      await validateConfiguredGeminiModel();
    } else {
      logger.info(`[lifecycle] AI Primary Provider configured as: ${config.aiPrimaryProvider}`);
    }
    await app.listen({ port: config.port, host: config.host });
    logger.info(`Zalo CRM running on http://${config.host}:${config.port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    startAppointmentReminder(app.io);
    startZaloHealthCheck();
    startReportCronJobs();
    startReportJobWorker();
    startOrphanCleanupTask();
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }

  // Reconnect Zalo accounts that have saved sessions (staggered to avoid rate limits)
  try {
    const accounts = await prisma.zaloAccount.findMany({
      where: { sessionData: { not: Prisma.JsonNull } },
      select: { id: true, sessionData: true },
    });
    logger.info(`Attempting reconnect for ${accounts.length} Zalo account(s)`);
    for (const account of accounts) {
      const session = decryptData<{
        cookie: any;
        imei: string;
        userAgent: string;
      }>(account.sessionData, config.encryptionKey);

      if (session?.imei) {
        // Stagger reconnects: 10 seconds between each account to avoid rate limits
        await new Promise((r) => setTimeout(r, 10_000));
        zaloPool.reconnect(account.id, session).catch((err) => {
          logger.warn(`Auto-reconnect failed for account ${account.id}:`, err);
        });
      }
    }
  } catch (err) {
    logger.error('Failed to load accounts for reconnect:', err);
  }
}

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  void shutdown(1, 'uncaught exception');
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
  void shutdown(1, 'unhandled rejection');
});
process.once('SIGTERM', () => { void shutdown(0, 'SIGTERM'); });
process.once('SIGINT', () => { void shutdown(0, 'SIGINT'); });

bootstrap();
