/** Daily reminders retain organization-wide visibility, with validated recipients. */
import cron from 'node-cron';
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { emitOrganizationEvent } from '../../shared/realtime/socket-event-delivery.js';

let appointmentReminderTask: ReturnType<typeof cron.schedule> | undefined;
const activeRuns = new Set<Promise<void>>();

export async function runAppointmentReminders(io: Server, now = new Date()): Promise<void> {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const startOfDay = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 0, 0, 0);
  const endOfDay = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59, 999);

  const appointments = await prisma.appointment.findMany({
    where: {
      appointmentDate: { gte: startOfDay, lte: endOfDay },
      status: 'scheduled',
      reminderSent: false,
    },
    include: {
      contact: { select: { fullName: true, phone: true } },
      assignedUser: { select: { id: true, fullName: true } },
    },
  });

  for (const apt of appointments) {
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

    await prisma.appointment.update({
      where: { id: apt.id, orgId: apt.orgId },
      data: { reminderSent: true },
    });
  }

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
