/**
 * scope-guard.ts — Scope-based authorization guard for public API routes.
 * Enforces least-privilege access using scopes attached to the API key.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';

export const ALL_VALID_SCOPES = [
  '*',
  'contacts:read',
  'contacts:write',
  'messages:read',
  'messages:write',
  'orders:read',
  'orders:write',
  'appointments:read',
  'appointments:write',
  'zalo_accounts:read',
];

export const DEFAULT_LEAST_PRIVILEGE_SCOPES = ['contacts:read', 'orders:read'];

export function requireApiKeyScope(requiredScope: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const scopes = (request as any).apiKeyScopes as string[] | undefined;
    if (!scopes || (!scopes.includes('*') && !scopes.includes(requiredScope))) {
      return reply.status(403).send({
        error: 'Insufficient API key permissions',
        requiredScope,
      });
    }
  };
}

export function hasApiKeyScope(request: FastifyRequest, requiredScope: string): boolean {
  const scopes = (request as any).apiKeyScopes as string[] | undefined;
  if (!scopes) return false;
  return scopes.includes('*') || scopes.includes(requiredScope);
}
