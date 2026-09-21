import cron from 'node-cron';
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { createNotification } from '../notifications/notification-service.js';
import { emitOrganizationEvent } from '../../shared/realtime/socket-event-delivery.js';
import { withCronLock, CRON_LOCKS } from '../../shared/utils/lock-registry.js';

let task: ReturnType<typeof cron.schedule> | undefined;
const activeRuns = new Set<Promise<void>>();

export async function runSlaCheck(io: Server): Promise<void> {
  await withCronLock(CRON_LOCKS.CHAT_SLA_MONITOR, async (tx) => {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

    const unrepliedConversations = await tx.conversation.findMany({
      where: {
        isReplied: false,
        lastMessageAt: { lt: thirtyMinsAgo },
      },
      include: {
        zaloAccount: { select: { displayName: true } },
        contact: { select: { fullName: true } },
      },
    });

    let createdCount = 0;

    for (const conv of unrepliedConversations) {
      try {
        const notification = await createNotification({
          orgId: conv.orgId,
          userId: null,
          type: 'warning',
          category: 'chat_sla',
          title: 'Tin nhắn chưa phản hồi quá 30 phút',
          detail: `KH ${conv.contact?.fullName || 'Không rõ'} qua ${conv.zaloAccount?.displayName || 'Zalo'}`,
          actionUrl: `/chat?conversation=${conv.id}`,
          priority: 'high',
          entityType: 'conversation',
          entityId: conv.id,
          dedupKey: `sla_${conv.id}`,
        });

        await emitOrganizationEvent(io, conv.orgId, 'notification:new', notification);
        createdCount++;
      } catch (err) {
        logger.error(`[chat-sla] Failed to create SLA notification for conversation ${conv.id}:`, err);
      }
    }

    logger.info(`[chat-sla] Checked ${unrepliedConversations.length} conversations, created ${createdCount} SLA notifications`);
  });
}

export function startChatSlaMonitor(io: Server): void {
  task?.stop();
  task = cron.schedule('*/5 * * * *', () => {
    const run = runSlaCheck(io)
      .catch((err) => logger.error('[chat-sla] SLA check failed', err))
      .finally(() => activeRuns.delete(run));
    activeRuns.add(run);
    return run;
  });
  logger.info('[chat-sla] Chat SLA monitor cron started (every 5 minutes)');
}

export async function stopChatSlaMonitor(): Promise<void> {
  task?.stop();
  task = undefined;
  await Promise.allSettled(activeRuns);
}
