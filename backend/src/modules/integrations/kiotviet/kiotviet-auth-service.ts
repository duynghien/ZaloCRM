/**
 * KiotViet OAuth Authentication Service
 *
 * Implements bounded single-flight OAuth token acquisition with revision-aware caching,
 * safety margin TTL handling, and safe draft test token retrieval.
 */

import { logger } from '../../../shared/utils/logger.js';
import type { KiotvietConfig } from './kiotviet-types.js';

export const KIOTVIET_AUTH_URL = 'https://id.kiotviet.vn/connect/token';

interface CachedToken {
  accessToken: string;
  expiresAt: number; // Unix timestamp in ms
  configRevision: number;
}

export class KiotvietAuthError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode = 401, code = 'kiotviet_auth_failed') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, KiotvietAuthError.prototype);
  }
}

// In-memory bounded cache for access tokens by orgId
const tokenCache = new Map<string, CachedToken>();
// Single-flight in-flight promise map by `${orgId}:${configRevision}`
const inFlightRequests = new Map<string, Promise<string>>();

/**
 * Invalidates the cached token for an organization.
 */
export function invalidateKiotvietToken(orgId: string): void {
  tokenCache.delete(orgId);
}

/**
 * Clears all cached tokens (for testing).
 */
export function clearKiotvietTokenCache(): void {
  tokenCache.clear();
  inFlightRequests.clear();
}

/**
 * Request an access token from KiotViet OAuth server with client_credentials grant.
 */
async function requestTokenFromVendor(clientId: string, clientSecret: string): Promise<{ accessToken: string; expiresIn: number }> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: 'public.api',
  });

  let response: Response;
  try {
    response = await fetch(KIOTVIET_AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });
  } catch (err: any) {
    logger.error('[kiotviet-auth] Network error requesting token:', {
      name: err?.name,
      message: err?.message,
    });
    throw new KiotvietAuthError('Failed to connect to KiotViet identity service', 502, 'auth_network_error');
  }

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json() as any;
      errorDetail = errJson?.error_description || errJson?.error || '';
    } catch {
      // Ignore JSON parse errors
    }

    logger.warn('[kiotviet-auth] Authentication failed at KiotViet:', {
      status: response.status,
      errorDetail,
    });

    throw new KiotvietAuthError(
      errorDetail ? `KiotViet authentication failed: ${errorDetail}` : 'Invalid KiotViet Client ID or Secret',
      response.status === 400 || response.status === 401 ? 401 : 502,
      'invalid_credentials'
    );
  }

  const data = (await response.json()) as any;
  if (!data?.access_token || typeof data.access_token !== 'string') {
    throw new KiotvietAuthError('KiotViet identity service returned malformed token response', 502, 'malformed_token_response');
  }

  const expiresIn = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 86400;

  return {
    accessToken: data.access_token,
    expiresIn,
  };
}

/**
 * Retrieves a valid OAuth access token for an organization's saved configuration.
 * Uses revision-aware caching and single-flight deduplication.
 */
export async function getKiotvietAccessToken(orgId: string, config: KiotvietConfig): Promise<string> {
  const now = Date.now();
  const cached = tokenCache.get(orgId);

  // Return cached token if valid and revision matches
  if (cached && cached.configRevision === config.configRevision && cached.expiresAt > now) {
    return cached.accessToken;
  }

  const flightKey = `${orgId}:${config.configRevision}`;
  const existingFlight = inFlightRequests.get(flightKey);
  if (existingFlight) {
    return await existingFlight;
  }

  const flightPromise = (async () => {
    try {
      const { accessToken, expiresIn } = await requestTokenFromVendor(config.clientId, config.clientSecret);

      // Safety margin: subtract 60s, or use half TTL if short
      const marginSeconds = expiresIn > 120 ? 60 : Math.floor(expiresIn / 2);
      const expiresAt = Date.now() + (expiresIn - marginSeconds) * 1000;

      tokenCache.set(orgId, {
        accessToken,
        expiresAt,
        configRevision: config.configRevision,
      });

      return accessToken;
    } finally {
      inFlightRequests.delete(flightKey);
    }
  })();

  inFlightRequests.set(flightKey, flightPromise);
  return await flightPromise;
}

/**
 * Retrieves an ephemeral access token for draft connection testing.
 * Does not store the token in the saved configuration cache.
 */
export async function getDraftKiotvietAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const { accessToken } = await requestTokenFromVendor(clientId, clientSecret);
  return accessToken;
}
