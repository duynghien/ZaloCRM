import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export interface CreateNotificationData {
  orgId: string;
  userId?: string | null;
  targetRole?: string | null;  // 'owner' | 'admin' | 'manager'
  entityType?: string | null;  // 'conversation' | 'zalo_account' | 'appointment'
  entityId?: string | null;
  dedupKey?: string | null;
  type: string;                // 'info' | 'warning' | 'error' | 'success' | 'ai_alert'
  category: string;            // 'appointment' | 'chat_sla' | 'zalo_account' | 'copilot' | 'system'
  title: string;
  detail: string;
  actionUrl?: string | null;
  priority?: string;           // 'low' | 'medium' | 'high' | 'urgent'
  metadata?: any;
}

export interface GetNotificationsOptions {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
  category?: string;
}

const ROLE_LEVELS: Record<string, number> = { owner: 3, admin: 2, manager: 1, member: 0 };

export function hasRoleAccess(userRole: string, requiredRole: string | null): boolean {
  if (!requiredRole) return true; // null targetRole = visible to all
  return (ROLE_LEVELS[userRole] ?? 0) >= (ROLE_LEVELS[requiredRole] ?? 0);
}

function buildRoleFilter(userRole: string): object[] {
  const level = ROLE_LEVELS[userRole] ?? 0;
  const filters: object[] = [{ targetRole: null }];
  if (level >= 1) filters.push({ targetRole: 'manager' });
  if (level >= 2) filters.push({ targetRole: 'admin' });
  if (level >= 3) filters.push({ targetRole: 'owner' });
  return filters;
}

export class NotificationService {
  private static cleanupInterval: NodeJS.Timeout | null = null;
  private static activeCleanups = new Set<Promise<any>>();

  static async createNotification(data: CreateNotificationData) {
    if (data.dedupKey) {
      return prisma.notification.upsert({
        where: {
          orgId_dedupKey: {
            orgId: data.orgId,
            dedupKey: data.dedupKey,
          },
        },
        update: {
          title: data.title,
          detail: data.detail,
          priority: data.priority ?? 'medium',
          metadata: data.metadata ?? undefined,
          actionUrl: data.actionUrl ?? null,
        },
        create: {
          orgId: data.orgId,
          userId: data.userId ?? null,
          targetRole: data.targetRole ?? null,
          entityType: data.entityType ?? null,
          entityId: data.entityId ?? null,
          dedupKey: data.dedupKey,
          type: data.type,
          category: data.category,
          title: data.title,
          detail: data.detail,
          actionUrl: data.actionUrl ?? null,
          priority: data.priority ?? 'medium',
          metadata: data.metadata ?? undefined,
        },
      });
    }

    return prisma.notification.create({
      data: {
        orgId: data.orgId,
        userId: data.userId ?? null,
        targetRole: data.targetRole ?? null,
        entityType: data.entityType ?? null,
        entityId: data.entityId ?? null,
        type: data.type,
        category: data.category,
        title: data.title,
        detail: data.detail,
        actionUrl: data.actionUrl ?? null,
        priority: data.priority ?? 'medium',
        metadata: data.metadata ?? undefined,
      },
    });
  }

  static async getNotifications(orgId: string, userId: string, userRole: string, options: GetNotificationsOptions) {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.max(1, Math.min(100, options.limit ?? 20));
    const skip = (page - 1) * limit;

    const baseWhere: any = {
      orgId,
      OR: [
        { userId },
        { userId: null },
      ],
      AND: [
        {
          OR: buildRoleFilter(userRole),
        },
      ],
    };

    if (options.category) {
      baseWhere.category = options.category;
    }

    const where: any = { ...baseWhere };
    if (options.unreadOnly) {
      where.isRead = false;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: {
          ...baseWhere,
          isRead: false,
        },
      }),
    ]);

    return { notifications, total, unreadCount, page, limit };
  }

  static async markAsRead(id: string, orgId: string, userId: string, userRole: string) {
    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.orgId !== orgId) {
      return null;
    }

    if (notification.userId !== userId && notification.userId !== null && !['owner', 'admin'].includes(userRole)) {
      return null;
    }

    return prisma.notification.update({
      where: { id },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  static async markAllAsRead(orgId: string, userId: string) {
    const result = await prisma.notification.updateMany({
      where: {
        orgId,
        userId, // only mark personal notifications as read
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return { count: result.count };
  }

  static async resolveByEntity(orgId: string, entityType: string, entityId: string) {
    const result = await prisma.notification.updateMany({
      where: {
        orgId,
        entityType,
        entityId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return result.count;
  }

  static async deleteNotification(id: string, orgId: string, userId: string, userRole: string) {
    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.orgId !== orgId) {
      return false;
    }

    if (notification.userId !== userId && !['owner', 'admin'].includes(userRole)) {
      return false;
    }

    await prisma.notification.delete({ where: { id } });
    return true;
  }

  static async cleanupOldNotifications(days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    try {
      const result = await prisma.notification.deleteMany({
        where: {
          createdAt: {
            lt: cutoff,
          },
        },
      });

      logger.info(`Cleaned up ${result.count} old notifications`);
      return result.count;
    } catch (error) {
      logger.error('Failed to cleanup old notifications', { error });
      return 0;
    }
  }

  static startNotificationCleanupTask() {
    if (this.cleanupInterval) return;

    logger.info('Starting notification cleanup task');
    
    // Run once a day
    this.cleanupInterval = setInterval(() => {
      const promise = this.cleanupOldNotifications(30)
        .catch(err => logger.error('Error in scheduled notification cleanup', { error: err }))
        .finally(() => {
          this.activeCleanups.delete(promise);
        });
      
      this.activeCleanups.add(promise);
    }, 24 * 60 * 60 * 1000);

    this.cleanupInterval.unref();
  }

  static async stopNotificationCleanupTask() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('Stopped notification cleanup task');
    }

    if (this.activeCleanups.size > 0) {
      logger.info(`Waiting for ${this.activeCleanups.size} active cleanup tasks to finish...`);
      await Promise.allSettled(this.activeCleanups);
      logger.info('All active cleanup tasks finished');
    }
  }
}

export const createNotification = NotificationService.createNotification.bind(NotificationService);
export const getNotifications = NotificationService.getNotifications.bind(NotificationService);
export const markAsRead = NotificationService.markAsRead.bind(NotificationService);
export const markAllAsRead = NotificationService.markAllAsRead.bind(NotificationService);
export const resolveByEntity = NotificationService.resolveByEntity.bind(NotificationService);
export const deleteNotification = NotificationService.deleteNotification.bind(NotificationService);
export const cleanupOldNotifications = NotificationService.cleanupOldNotifications.bind(NotificationService);
export const startNotificationCleanupTask = NotificationService.startNotificationCleanupTask.bind(NotificationService);
export const stopNotificationCleanupTask = NotificationService.stopNotificationCleanupTask.bind(NotificationService);

