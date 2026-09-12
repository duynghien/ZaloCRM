/** QR subscription intent is distinct from transport room membership. */
import type { Server, Socket } from 'socket.io';
import { hasZaloAccess } from './zalo-access-middleware.js';
import { beginAccountOperation, currentSocketIdentity, invalidateAccountOperations, socketSessionIsCurrent } from '../../shared/realtime/socket-authorization.js';
import { logger } from '../../shared/utils/logger.js';

const subscriptions = new WeakMap<Socket, Map<string, object>>();
const pending = new WeakMap<Socket, Map<string, object>>();
type Ack = (result: { ok: boolean; error?: string }) => void;

export function accountSubscription(socket: Socket, accountId: string): object | undefined {
  return subscriptions.get(socket)?.get(accountId);
}

function cancelSubscription(socket: Socket, accountId: string): void {
  pending.get(socket)?.delete(accountId);
  subscriptions.get(socket)?.delete(accountId);
  void socket.leave(`account:${accountId}`);
}

export async function pruneSocketAccountRooms(socket: Socket): Promise<void> {
  for (const accountId of [...(subscriptions.get(socket)?.keys() ?? [])]) {
    const intent = accountSubscription(socket, accountId);
    try {
      const user = await currentSocketIdentity(socket);
      if (await hasZaloAccess(user, accountId, 'admin')) continue;
    } catch {
      logger.warn('[realtime] Subscription validation failed');
    }
    if (accountSubscription(socket, accountId) === intent) cancelSubscription(socket, accountId);
  }
}

/** The synchronous invalidation is the mutation-success barrier for pending reads. */
export async function pruneSocketsForZaloAccount(io: Server, accountId: string): Promise<void> {
  invalidateAccountOperations(accountId);
  await Promise.all([...io.sockets.sockets.values()].map((socket) => pruneSocketAccountRooms(socket)));
}

export function registerZaloSocketHandlers(io: Server): void {
  io.on('connection', (socket) => {
    socket.on('org:join', (data: { orgId?: string }) => {
      if (socketSessionIsCurrent(socket) && data?.orgId === socket.data.user.orgId) void socket.join(`org:${data.orgId}`);
    });
    socket.on('zalo:subscribe', async (data: { accountId?: string }, ack?: Ack) => {
      const respond = (result: { ok: boolean; error?: string }) => { if (typeof ack === 'function') ack(result); };
      const accountId = data?.accountId;
      if (typeof accountId !== 'string' || !accountId || accountId.length > 128) return respond({ ok: false, error: 'Account ID required' });
      const intent = {};
      const requests = pending.get(socket) ?? new Map<string, object>();
      requests.set(accountId, intent);
      pending.set(socket, requests);
      const operation = beginAccountOperation(accountId);
      try {
        const user = await currentSocketIdentity(socket);
        const allowed = await hasZaloAccess(user, accountId, 'admin');
        if (!allowed || !operation.valid || !socketSessionIsCurrent(socket) || requests.get(accountId) !== intent) {
          return respond({ ok: false, error: 'Forbidden or subscription cancelled' });
        }
        // The default in-process adapter joins synchronously; no await between guard and commit.
        void socket.join(`account:${accountId}`);
        const active = subscriptions.get(socket) ?? new Map<string, object>();
        active.set(accountId, intent);
        subscriptions.set(socket, active);
        respond({ ok: true });
      } catch {
        logger.warn('[realtime] Subscription denied after validation failure');
        respond({ ok: false, error: 'Forbidden' });
      } finally {
        if (requests.get(accountId) === intent) requests.delete(accountId);
        operation.release();
      }
    });
    socket.on('zalo:unsubscribe', (data: { accountId?: string }, ack?: Ack) => {
      if (typeof data?.accountId === 'string') cancelSubscription(socket, data.accountId);
      if (typeof ack === 'function') ack({ ok: true });
    });
    socket.on('disconnect', () => { subscriptions.delete(socket); pending.delete(socket); });
  });
}
