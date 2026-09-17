import type { Server, Socket } from 'socket.io';
import { prisma } from '../database/prisma-client.js';
import { logger } from '../utils/logger.js';
import { hasZaloAccess } from '../../modules/zalo/zalo-access-middleware.js';
import { accountSubscription } from '../../modules/zalo/zalo-socket.js';
import { beginAccountOperation, currentSocketIdentity, socketSessionIsCurrent } from './socket-authorization.js';

export const ACCOUNT_EVENT_QUEUE_LIMIT = 100;
const qrEvents = new Set(['zalo:qr', 'zalo:qr-expired', 'zalo:scanned']);
const chatRequiredEvents = new Set(['chat:copilot_suggestion']);
type Queue = { tail: Promise<void>; size: number; dirty: boolean; signal?: Promise<void>; generation: number; reason: string; latestQr?: { event: string; payload: unknown } };
const queues = new WeakMap<Server, Map<string, Queue>>();
let recoveryGeneration = 0;
const closedServers = new WeakSet<Server>();
const recoveryTimers = new WeakMap<Server, Map<ReturnType<typeof setTimeout>, () => void>>();

export function closeSocketEventDelivery(io: Server): void {
  closedServers.add(io);
  for (const [timer, resolve] of recoveryTimers.get(io) ?? []) { clearTimeout(timer); resolve(); }
  recoveryTimers.delete(io);
  queues.delete(io);
}

function recoveryDelay(io: Server): Promise<void> {
  if (closedServers.has(io)) return Promise.resolve();
  return new Promise((resolve) => {
    const timers = recoveryTimers.get(io) ?? new Map();
    const timer = setTimeout(() => { timers.delete(timer); resolve(); }, 250);
    timer.unref();
    timers.set(timer, resolve);
    recoveryTimers.set(io, timers);
  });
}

async function deliverAccount(io: Server, accountId: string, event: string, payload: unknown): Promise<boolean> {
  const delivered = new Set<Socket>();
  const intents = new Map<Socket, object | undefined>();
  const candidatesSeen = new Set<Socket>();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (closedServers.has(io)) return true;
    const operation = beginAccountOperation(accountId);
    try {
      const account = await prisma.zaloAccount.findUnique({ where: { id: accountId }, select: { orgId: true } });
      if (account) {
        for (const id of io.sockets.adapter.rooms.get(`org:${account.orgId}`) ?? []) {
          const socket = io.sockets.sockets.get(id);
          if (socket) candidatesSeen.add(socket);
        }
      }
      if (!operation.valid) continue;
      if (!account) return true;
      // Rooms select candidates; retries read current DB permissions and skip completed recipients.
      const candidates = io.sockets.adapter.rooms.get(`org:${account.orgId}`) ?? new Set<string>();
      const sockets = [...candidates].map((id) => io.sockets.sockets.get(id)).filter((socket): socket is Socket => !!socket);
      await Promise.all(sockets.map(async (socket) => {
        candidatesSeen.add(socket);
        if (delivered.has(socket)) return;
        if (!intents.has(socket)) intents.set(socket, accountSubscription(socket, accountId));
        const intent = intents.get(socket);
        if (qrEvents.has(event) && (!intent || accountSubscription(socket, accountId) !== intent)) return;
        try {
          const user = await currentSocketIdentity(socket);
          const requiredLevel = qrEvents.has(event) ? 'admin' : (chatRequiredEvents.has(event) ? 'chat' : 'read');
          if (!(await hasZaloAccess(user, accountId, requiredLevel))) return;
          if (closedServers.has(io) || !operation.valid || !socketSessionIsCurrent(socket)) return;
          if (qrEvents.has(event) && accountSubscription(socket, accountId) !== intent) return;
          socket.emit(event, payload);
          delivered.add(socket);
        } catch {
          logger.warn('[realtime] Account event denied after recipient validation failure');
        }
      }));
      if (operation.valid) return true;
    } catch {
      logger.warn('[realtime] Account event denied after account lookup failure');
      return true;
    } finally { operation.release(); }
  }
  if (event === 'realtime:resync-required') {
    // Repeated concurrent mutations cannot authorize a control packet reliably. A transport
    // reconnect triggers the same REST recovery without sending any stale authorized data.
    for (const socket of candidatesSeen) if (!delivered.has(socket) && socket.connected) socket.conn.close();
  }
  return false;
}

function signalRecovery(io: Server, accountId: string, queue: Queue): Promise<void> {
  if (queue.signal) return queue.signal;
  queue.signal = recoveryDelay(io).then(() => deliverAccount(io, accountId, 'realtime:resync-required', {
    reason: queue.reason, generation: queue.generation,
  })).then(() => undefined).finally(() => { queue.signal = undefined; });
  return queue.signal;
}

/** Serialize each account, bound retained payloads, and coalesce recovery outside the queue. */
export function emitAccountEvent(io: Server, accountId: string, event: string, payload: unknown): Promise<void> {
  let accounts = queues.get(io);
  if (!accounts) { accounts = new Map(); queues.set(io, accounts); }
  let queue = accounts.get(accountId);
  if (!queue) {
    queue = { tail: Promise.resolve(), size: 0, dirty: false, generation: 0, reason: 'queue-overflow' };
    accounts.set(accountId, queue);
  }
  const active = queue;
  if (active.size >= ACCOUNT_EVENT_QUEUE_LIMIT) {
    if (qrEvents.has(event)) active.latestQr = { event, payload };
    if (!active.dirty) {
      active.dirty = true;
      active.generation = ++recoveryGeneration;
      logger.warn('[realtime] Account queue overflow; REST resynchronization required');
      void signalRecovery(io, accountId, active);
    }
    return Promise.resolve();
  }
  // A newer normally queued QR lifecycle event supersedes an older overflow snapshot.
  if (qrEvents.has(event)) active.latestQr = undefined;
  active.size++;
  const done = active.tail.then(async () => {
    if (!(await deliverAccount(io, accountId, event, payload))) {
      active.dirty = true;
      active.reason = 'authorization-changed';
      active.generation = ++recoveryGeneration;
    }
  });
  active.tail = done.finally(async () => {
    active.size--;
    if (active.size) return;
    const latestQr = active.latestQr;
    active.latestQr = undefined;
    if (latestQr && !(await deliverAccount(io, accountId, latestQr.event, latestQr.payload))) {
      active.dirty = true;
      active.reason = 'authorization-changed';
    }
    if (active.dirty) {
      // Wait for an early signal before sending a final one: queued data is now settled.
      await active.signal;
      active.generation = ++recoveryGeneration;
      await signalRecovery(io, accountId, active);
    }
    if (!active.size && accounts.get(accountId) === active) accounts.delete(accountId);
  });
  return active.tail;
}

export async function emitOrganizationEvent(io: Server, orgId: string, event: string, payload: unknown): Promise<void> {
  const candidates = io.sockets.adapter.rooms.get(`org:${orgId}`) ?? new Set<string>();
  await Promise.all([...candidates].map(async (id) => {
    const socket = io.sockets.sockets.get(id);
    if (!socket) return;
    try {
      const user = await currentSocketIdentity(socket);
      if (user.orgId === orgId && socketSessionIsCurrent(socket)) socket.emit(event, payload);
    } catch { logger.warn('[realtime] Organization event denied after recipient validation failure'); }
  }));
}

export async function emitManagerEvent(io: Server, orgId: string, event: string, payload: unknown): Promise<void> {
  const candidates = io.sockets.adapter.rooms.get(`org:${orgId}`) ?? new Set<string>();
  await Promise.all([...candidates].map(async (id) => {
    const socket = io.sockets.sockets.get(id);
    if (!socket) return;
    try {
      const user = await currentSocketIdentity(socket);
      if (user.orgId === orgId && (user.role === 'owner' || user.role === 'admin') && socketSessionIsCurrent(socket)) {
        socket.emit(event, payload);
      }
    } catch {
      logger.warn('[realtime] Manager event denied after recipient validation failure');
    }
  }));
}

