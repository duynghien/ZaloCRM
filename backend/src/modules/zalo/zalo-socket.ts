/**
 * Zalo Socket.IO event handlers.
 * Manages room subscriptions for org-level and per-account events.
 */
import type { Server, Socket } from 'socket.io';
import { logger } from '../../shared/utils/logger.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { hasZaloAccess } from './zalo-access-middleware.js';

type SocketUser = { id: string; orgId: string; role: string };

// Keep the requested account subscriptions server-side. Socket.IO's room list
// is transport state, so it is not a suitable source of authorization intent:
// only the successful subscribe handler can add an account to this collection.
const accountSubscriptions = new WeakMap<Socket, Set<string>>();

function currentSocketUser(socket: Socket): SocketUser | null {
  const user = socket.data.user as Partial<SocketUser> | undefined;
  if (!user?.id || !user.orgId || !user.role) return null;
  return { id: user.id, orgId: user.orgId, role: user.role };
}

export async function pruneSocketAccountRooms(socket: Socket): Promise<void> {
  const user = currentSocketUser(socket);
  if (!user) return;

  const subscribedAccountIds = accountSubscriptions.get(socket);
  if (!subscribedAccountIds?.size) return;

  for (const accountId of [...subscribedAccountIds]) {
    if (!(await hasZaloAccess(user, accountId, 'read'))) {
      socket.leave(`account:${accountId}`);
      subscribedAccountIds.delete(accountId);
      socket.emit('zalo:error', { accountId, error: 'Forbidden' });
    }
  }
}

/** Promptly reconcile every current subscriber after an ACL mutation. */
export async function pruneSocketsForZaloAccount(io: Server, accountId: string): Promise<void> {
  await Promise.all(
    [...io.sockets.sockets.values()]
      .filter((socket) => accountSubscriptions.get(socket)?.has(accountId))
      .map((socket) => pruneSocketAccountRooms(socket)),
  );
}

export function registerZaloSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    // Automatically ensure user is in their org room
    const connectedUser = currentSocketUser(socket);
    if (connectedUser?.orgId) {
      socket.join(`org:${connectedUser.orgId}`);
    }

    // Client org:join check (ensures user only joins their own org room)
    socket.on('org:join', (data: { orgId: string }) => {
      const user = currentSocketUser(socket);
      if (!user || user.orgId !== data?.orgId) return;
      socket.join(`org:${user.orgId}`);
      logger.debug(`Socket ${socket.id} joined org:${user.orgId}`);
    });

    // Subscribe to QR/status updates for a specific Zalo account
    socket.on('zalo:subscribe', async (data: { accountId: string }) => {
      const user = currentSocketUser(socket);
      if (!user || !data?.accountId) return socket.emit('zalo:error', { accountId: data?.accountId, error: 'Account ID required' });
      const currentUser = await prisma.user.findFirst({
        where: { id: user.id, orgId: user.orgId, isActive: true },
        select: { id: true, orgId: true, role: true },
      });
      if (!currentUser || !(await hasZaloAccess(currentUser, data.accountId, 'read'))) {
        return socket.emit('zalo:error', { accountId: data.accountId, error: 'Forbidden' });
      }
      socket.join(`account:${data.accountId}`);
      const subscriptions = accountSubscriptions.get(socket) ?? new Set<string>();
      subscriptions.add(data.accountId);
      accountSubscriptions.set(socket, subscriptions);
      logger.debug(`Socket ${socket.id} joined account:${data.accountId}`);
    });

    // Unsubscribe from a specific account room
    socket.on('zalo:unsubscribe', async (data: { accountId: string }) => {
      const user = currentSocketUser(socket);
      if (!user || !data?.accountId) return socket.emit('zalo:error', { accountId: data?.accountId, error: 'Account ID required' });
      const currentUser = await prisma.user.findFirst({
        where: { id: user.id, orgId: user.orgId, isActive: true },
        select: { id: true, orgId: true, role: true },
      });
      if (!currentUser || !(await hasZaloAccess(currentUser, data.accountId, 'read'))) {
        return socket.emit('zalo:error', { accountId: data.accountId, error: 'Forbidden' });
      }
      socket.leave(`account:${data.accountId}`);
      accountSubscriptions.get(socket)?.delete(data.accountId);
      logger.debug(`Socket ${socket.id} left account:${data.accountId}`);
    });
  });
}
