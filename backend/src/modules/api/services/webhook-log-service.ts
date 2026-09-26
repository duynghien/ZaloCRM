/**
 * webhook-log-service.ts — Query outbox delivery history, statistics, and DLQ retry management.
 * Enforces tenant scoping and scrubs secret credentials from log outputs.
 */
import { prisma } from '../../../shared/database/prisma-client.js';
import { boundedPositiveInt, boundedString } from '../../../shared/http/request-bounds.js';

export interface WebhookLogFilter {
  status?: string;
  subscriptionId?: string;
}

export interface PaginationOptions {
  page?: string | number;
  limit?: string | number;
}

export async function getWebhookLogs(
  orgId: string,
  filter: WebhookLogFilter = {},
  pagination: PaginationOptions = {}
) {
  const pageNum = boundedPositiveInt(pagination.page, 1, 10_000);
  const limitNum = boundedPositiveInt(pagination.limit, 20, 100);

  const where: any = { orgId };
  if (filter.status) {
    where.status = boundedString(filter.status, 30);
  }
  if (filter.subscriptionId) {
    where.subscriptionId = boundedString(filter.subscriptionId, 128);
  }

  const [logs, total] = await Promise.all([
    prisma.webhookOutbox.findMany({
      where,
      select: {
        id: true,
        orgId: true,
        subscriptionId: true,
        destinationUrl: true,
        eventType: true,
        payload: true,
        status: true,
        attemptCount: true,
        nextAttemptAt: true,
        responseStatus: true,
        lastError: true,
        deliveredAt: true,
        createdAt: true,
        updatedAt: true,
        subscription: {
          select: {
            id: true,
            name: true,
            targetUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    }),
    prisma.webhookOutbox.count({ where }),
  ]);

  const totalPages = Math.ceil(total / limitNum) || 1;
  return {
    logs,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
    },
  };
}

export async function retryWebhookOutboxItem(orgId: string, outboxId: string): Promise<boolean> {
  // Scoped to orgId to prevent cross-tenant IDOR attacks
  const existing = await prisma.webhookOutbox.findFirst({
    where: { id: outboxId, orgId },
    select: { id: true, status: true },
  });

  if (!existing) {
    return false;
  }

  // Reset attempt count, clear errors/leases, and immediately schedule for retry
  await prisma.webhookOutbox.update({
    where: { id: outboxId },
    data: {
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: new Date(),
      lastError: null,
      responseStatus: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    },
  });

  return true;
}

export async function getWebhookStats(orgId: string) {
  const counts = await prisma.webhookOutbox.groupBy({
    by: ['status'],
    where: { orgId },
    _count: true,
  });

  const stats: Record<string, number> = {
    pending: 0,
    paused: 0,
    dispatching: 0,
    delivered: 0,
    failed: 0,
  };

  for (const c of counts) {
    stats[c.status] = c._count;
  }

  return stats;
}
