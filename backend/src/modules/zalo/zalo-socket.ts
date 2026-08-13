/**
 * Zalo Socket.IO event handlers.
 * Manages room subscriptions for org-level and per-account events.
 */
import type { Server, Socket } from 'socket.io';
import { logger } from '../../shared/utils/logger.js';

export function registerZaloSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    const user = socket.data.user;

    // Automatically ensure user is in their org room
    if (user?.orgId) {
      socket.join(`org:${user.orgId}`);
    }

    // Client org:join check (ensures user only joins their own org room)
    socket.on('org:join', (data: { orgId: string }) => {
      if (!user || user.orgId !== data?.orgId) return;
      socket.join(`org:${user.orgId}`);
      logger.debug(`Socket ${socket.id} joined org:${user.orgId}`);
    });

    // Subscribe to QR/status updates for a specific Zalo account
    socket.on('zalo:subscribe', (data: { accountId: string }) => {
      if (!user || !data?.accountId) return;
      socket.join(`account:${data.accountId}`);
      logger.debug(`Socket ${socket.id} joined account:${data.accountId}`);
    });

    // Unsubscribe from a specific account room
    socket.on('zalo:unsubscribe', (data: { accountId: string }) => {
      if (!data?.accountId) return;
      socket.leave(`account:${data.accountId}`);
      logger.debug(`Socket ${socket.id} left account:${data.accountId}`);
    });
  });
}
