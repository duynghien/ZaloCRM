/**
 * zalo-session-manager.ts — Manages Zalo account session lifecycle:
 * - Periodic 1-hour heartbeat keep-alive (with ±60s jitter).
 * - Safe cookie synchronization from CookieJar to encrypted DB storage.
 * - Error classification for fatal auth vs transient network errors.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { config } from '../../config/index.js';
import { encryptData, decryptData } from '../../shared/utils/crypto.js';
import type { ZaloCredentials } from './zalo-pool.js';

const heartbeatTimers = new Map<string, NodeJS.Timeout>();

/**
 * Check whether an error is a fatal authentication error (session expired, invalid credentials, HTTP 401/403).
 * Returns false for generic SDK errors like "Đăng nhập thất bại" and transient network errors.
 */
export function isFatalAuthError(err: unknown): boolean {
  if (!err) return false;
  const errorObj = err as { name?: string; message?: string; code?: string | number };
  const name = errorObj.name;
  const msg = (errorObj.message || String(err)).toLowerCase();
  const code = errorObj.code;

  // Generic SDK message "Đăng nhập thất bại" indicates transient/network/gateway error
  if (msg.includes('đăng nhập thất bại')) {
    return false;
  }

  // Network timeouts / connection resets are not fatal auth errors
  if (
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('network') ||
    msg.includes('enotfound')
  ) {
    return false;
  }

  // HTTP 401/403 status
  if (code === 401 || code === 403 || msg.includes('401') || msg.includes('403')) {
    return true;
  }

  // Known fatal session / authentication patterns
  if (
    msg.includes('session expired') ||
    msg.includes('invalid session') ||
    msg.includes('session revoked') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden')
  ) {
    return true;
  }

  // zca-js error class check: exports as ZaloApiError, runtime name is ZcaApiError
  const isZcaError = name === 'ZcaApiError' || name === 'ZaloApiError';
  const numCode = Number(code);
  if (isZcaError && (numCode === -100 || numCode === -101 || numCode === 1001 || numCode === 1002)) {
    return true;
  }

  return false;
}

/**
 * Synchronize the latest cookies from the active API session into the database.
 * Validates that cookies exist and are non-empty before updating, and preserves imei & userAgent.
 */
export async function syncAccountCredentials(accountId: string, api: any): Promise<void> {
  if (!api) return;

  const cookies =
    api.getCookie?.()?.toJSON?.()?.cookies ||
    api.getContext?.()?.cookie?.toJSON?.()?.cookies;

  if (!Array.isArray(cookies) || cookies.length === 0) {
    logger.warn(`[zalo-session:${accountId}] Invalid or empty cookies from CookieJar, skipping sync`);
    return;
  }

  const context = api.getContext?.();
  let imei = context?.imei;
  let userAgent = context?.userAgent;

  // Fallback: If imei or userAgent is missing in context, retrieve from DB with decryption
  if (!imei || !userAgent) {
    const acc = await prisma.zaloAccount.findUnique({
      where: { id: accountId },
      select: { sessionData: true },
    });
    if (acc?.sessionData) {
      const existing = decryptData<ZaloCredentials>(acc.sessionData, config.encryptionKey);
      if (existing) {
        if (!imei) imei = existing.imei;
        if (!userAgent) userAgent = existing.userAgent;
      }
    }
  }

  if (!imei) {
    logger.warn(`[zalo-session:${accountId}] Missing IMEI, skipping credential sync`);
    return;
  }

  const credentials: ZaloCredentials = {
    cookie: cookies,
    imei,
    userAgent: userAgent || '',
  };

  const encrypted = encryptData(credentials, config.encryptionKey);
  await prisma.zaloAccount.update({
    where: { id: accountId },
    data: { sessionData: encrypted as any },
  });
  logger.info(`[zalo-session:${accountId}] Successfully synced updated session credentials`);
}

/**
 * Start recursive setTimeout heartbeat for an account.
 * Runs keepAlive every baseIntervalMs (default: 1 hour) ± 60s jitter.
 */
export function startAccountHeartbeat(
  accountId: string,
  api: any,
  baseIntervalMs = 3600_000,
  onFatalAuth?: (accountId: string, err: unknown) => void,
): void {
  stopAccountHeartbeat(accountId);

  function scheduleNextHeartbeat() {
    // Recompute jitter each tick: ±60s for standard intervals (>= 1 min)
    const jitter = baseIntervalMs >= 60_000 ? Math.random() * 120_000 - 60_000 : 0;
    const interval = Math.max(1, baseIntervalMs + jitter);

    const timer = setTimeout(async () => {
      try {
        await api.keepAlive();
        if (heartbeatTimers.get(accountId) !== timer) return;
        await syncAccountCredentials(accountId, api);
        if (heartbeatTimers.get(accountId) !== timer) return;
        scheduleNextHeartbeat();
      } catch (err: unknown) {
        if (heartbeatTimers.get(accountId) !== timer) return;
        if (isFatalAuthError(err)) {
          logger.error(`[zalo-session:${accountId}] Fatal auth error during keepAlive:`, err);
          stopAccountHeartbeat(accountId);
          if (onFatalAuth) {
            onFatalAuth(accountId, err);
          }
        } else {
          logger.warn(`[zalo-session:${accountId}] Transient error during keepAlive:`, err);
          scheduleNextHeartbeat();
        }
      }
    }, interval);

    timer.unref();
    heartbeatTimers.set(accountId, timer);
  }

  scheduleNextHeartbeat();
}

/**
 * Stop heartbeat timer for a specific account.
 */
export function stopAccountHeartbeat(accountId: string): void {
  const timer = heartbeatTimers.get(accountId);
  if (timer) {
    clearTimeout(timer);
    heartbeatTimers.delete(accountId);
  }
}

/**
 * Stop all active heartbeat timers across all accounts.
 */
export function stopAllHeartbeats(): void {
  for (const timer of heartbeatTimers.values()) {
    clearTimeout(timer);
  }
  heartbeatTimers.clear();
}

/**
 * Check whether an account currently has an active heartbeat timer.
 */
export function isHeartbeatActive(accountId: string): boolean {
  return heartbeatTimers.has(accountId);
}
