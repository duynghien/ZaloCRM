import type { Socket } from 'socket.io';
import { validateSessionUser, type AuthIdentity } from '../../modules/auth/auth-service.js';

export type AccountOperation = { valid: boolean; release: () => void };
const operations = new Map<string, Set<AccountOperation>>();
let generation = 0;

/** Only in-flight operations are retained; invalidation never caches positive grants. */
export function beginAccountOperation(accountId: string): AccountOperation {
  const active = operations.get(accountId) ?? new Set<AccountOperation>();
  const operation = { valid: true, release: () => {
    active.delete(operation);
    if (!active.size) operations.delete(accountId);
  } };
  active.add(operation);
  operations.set(accountId, active);
  return operation;
}

export function invalidateAccountOperations(accountId: string): number {
  for (const operation of operations.get(accountId) ?? []) operation.valid = false;
  return ++generation;
}

export function socketSessionIsCurrent(socket: Socket): boolean {
  return socket.connected && !socket.data.sessionInvalidated &&
    typeof socket.data.accessExpiresAt === 'number' && Date.now() < socket.data.accessExpiresAt;
}

export async function currentSocketIdentity(socket: Socket): Promise<AuthIdentity> {
  if (!socketSessionIsCurrent(socket)) throw new Error('Session expired');
  const identity = await validateSessionUser(socket.data.sessionId, socket.data.user.id);
  if (!socketSessionIsCurrent(socket)) throw new Error('Session revoked');
  const oldOrg = socket.data.user.orgId;
  socket.data.user = { ...identity, sessionId: socket.data.sessionId };
  if (oldOrg !== identity.orgId) {
    await socket.leave(`org:${oldOrg}`);
    await socket.join(`org:${identity.orgId}`);
  }
  if (!socketSessionIsCurrent(socket)) throw new Error('Session revoked');
  return identity;
}
