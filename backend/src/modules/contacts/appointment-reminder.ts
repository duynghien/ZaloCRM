/** Daily reminders retain organization-wide visibility, with validated recipients. */
import cron from 'node-cron';
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { emitOrganizationEvent, emitUserEvent } from '../../shared/realtime/socket-event-delivery.js';
import { createNotification } from '../notifications/notification-service.js';
import { withCronLock, CRON_LOCKS } from '../../shared/utils/lock-registry.js';

let appointmentReminderTask: ReturnType<typeof cron.schedule> | undefined;
const activeRuns = new Set<Promise<void>>();

export async function runAppointmentReminders(io: Server, now = new Date()): Promise<void> {
  await withCronLock(CRON_LOCKS.APPOINTMENT_REMINDER, async (tx) => {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const endOfTomorrow = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59, 999);

    const appointments = await tx.appointment.findMany({
      where: {
        appointmentDate: { gte: startOfToday, lte: endOfTomorrow },
        status: 'scheduled',
        reminderSent: false,
      },
      include: {
        contact: { select: { fullName: true, phone: true } },
        assignedUser: { select: { id: true, fullName: true } },
      },
    });

    for (const apt of appointments) {
      const isTomorrow = apt.appointmentDate >= new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 0, 0, 0);
      const dayLabel = isTomorrow ? 'Ngày mai' : 'Hôm nay';

      const notification = await createNotification({
        orgId: apt.orgId,
        userId: apt.assignedUserId,
        type: 'info',
        category: 'appointment',
        title: `[${dayLabel}] Lịch hẹn: ${apt.contact?.fullName || 'KH'}`,
        detail: `${apt.appointmentTime || ''} - ${apt.notes || apt.type || 'Tái khám'}`,
        actionUrl: '/appointments',
        priority: isTomorrow ? 'low' : 'medium',
        entityType: 'appointment',
        entityId: apt.id,
        dedupKey: `apt_${apt.id}_${isTomorrow ? 'tomorrow' : 'today'}`,
      });

      await emitOrganizationEvent(io, apt.orgId, 'appointment:reminder', {
        appointmentId: apt.id,
        contactName: apt.contact.fullName,
        contactPhone: apt.contact.phone,
        date: apt.appointmentDate,
        time: apt.appointmentTime,
        type: apt.type,
        assignedUserId: apt.assignedUserId,
        assignedUserName: apt.assignedUser?.fullName,
      });

      if (apt.assignedUserId) {
        await emitUserEvent(io, apt.assignedUserId, 'notification:new', notification);
      } else {
        await emitOrganizationEvent(io, apt.orgId, 'notification:new', notification);
      }

      await tx.appointment.update({
        where: { id: apt.id, orgId: apt.orgId },
        data: { reminderSent: true },
      });
    }
  });
}

export function startAppointmentReminder(io: Server): void {
  appointmentReminderTask?.stop();
  appointmentReminderTask = cron.schedule('0 1 * * *', () => {
    const run = runAppointmentReminders(io)
      .catch(() => logger.error('[reminder] Reminder delivery failed'))
      .finally(() => activeRuns.delete(run));
    activeRuns.add(run);
    return run;
  });
  logger.info('[reminder] Appointment reminder cron started (daily 01:00 UTC)');
}

export async function stopAppointmentReminder(): Promise<void> {
  appointmentReminderTask?.stop();
  appointmentReminderTask = undefined;
  await Promise.allSettled(activeRuns);
}
