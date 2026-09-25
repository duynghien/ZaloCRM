/**
 * KiotViet HTTP Client
 *
 * Provides typed, rate-limited, allowlisted HTTP communication with KiotViet Public API.
 * Invariant: Only connects to https://public.kiotapi.com and https://id.kiotviet.vn.
 */

import { logger } from '../../../shared/utils/logger.js';
import {
  getKiotvietAccessToken,
  getDraftKiotvietAccessToken,
  invalidateKiotvietToken,
  KiotvietAuthError,
} from './kiotviet-auth-service.js';
import {
  checkAndReserveRateLimit,
  recordVendorRateLimit429,
  KiotvietRateLimitError,
} from './kiotviet-rate-limit-service.js';
import type { KiotvietConfig, KiotvietCustomerSearchResult } from './kiotviet-types.js';
import { normalizeVietnamesePhoneNumberVariants } from '../../../shared/utils/phone-utils.js';

export const KIOTVIET_API_BASE = 'https://public.kiotapi.com';

export class KiotvietApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly responseBody?: any;

  constructor(message: string, statusCode = 500, code = 'kiotviet_api_error', responseBody?: any) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.responseBody = responseBody;
    Object.setPrototypeOf(this, KiotvietApiError.prototype);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  isPriorityWrite?: boolean;
  signal?: AbortSignal;
}

/**
 * Executes a request against KiotViet API with rate-limiting, auth refresh, and timeout guards.
 */
async function executeApiRequest<T>(
  orgId: string,
  config: KiotvietConfig,
  options: RequestOptions
): Promise<T> {
  const {
    method = 'GET',
    path,
    query,
    body,
    timeoutMs = 10_000,
    isPriorityWrite = method === 'POST' && path.includes('/invoices'),
    signal,
  } = options;

  // 1. Check and reserve rate limit slot
  await checkAndReserveRateLimit(orgId, config.retailer, isPriorityWrite);

  // 2. Obtain access token
  let token = await getKiotvietAccessToken(orgId, config);

  const url = new URL(path.startsWith('/') ? path : `/${path}`, KIOTVIET_API_BASE);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const makeRequest = async (authToken: string): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      return await fetch(url.toString(), {
        method,
        headers: {
          'Retailer': config.retailer,
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let response: Response;
  try {
    response = await makeRequest(token);
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new KiotvietApiError(`KiotViet API request timed out after ${timeoutMs}ms`, 504, 'timeout');
    }
    logger.error('[kiotviet-client] Network error:', { path, message: err?.message });
    throw new KiotvietApiError('Failed to communicate with KiotViet API', 502, 'network_error');
  }

  // 3. Handle 401 Unauthorized: refresh token and retry once if safe
  if (response.status === 401) {
    logger.warn('[kiotviet-client] Received 401 from KiotViet. Invalidating token and retrying...');
    invalidateKiotvietToken(orgId);
    token = await getKiotvietAccessToken(orgId, config);

    try {
      response = await makeRequest(token);
    } catch (err: any) {
      throw new KiotvietApiError('KiotViet request failed on retry after 401 refresh', 502, 'auth_retry_failed');
    }

    if (response.status === 401) {
      throw new KiotvietAuthError('KiotViet API rejected token on retry', 401, 'invalid_credentials');
    }
  }

  // 4. Handle 429 Too Many Requests
  if (response.status === 429) {
    const retryAfterHeader = response.headers.get('Retry-After');
    const retrySeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) || 30 : 30;
    await recordVendorRateLimit429(orgId, config.retailer, retrySeconds);
    throw new KiotvietRateLimitError('KiotViet API rate limit exceeded (429)', retrySeconds);
  }

  // 5. Handle HTTP errors
  if (!response.ok) {
    let errorDetail = '';
    let responseData: any;
    try {
      responseData = await response.json();
      errorDetail = responseData?.message || responseData?.responseStatus?.message || JSON.stringify(responseData);
    } catch {
      // Non-JSON error
    }

    logger.warn('[kiotviet-client] Request failed:', {
      status: response.status,
      path,
      errorDetail: errorDetail.slice(0, 500),
    });

    throw new KiotvietApiError(
      errorDetail ? `KiotViet API error: ${errorDetail}` : `KiotViet API error (HTTP ${response.status})`,
      response.status,
      'vendor_error',
      responseData
    );
  }

  // 6. Parse response body
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Fetch branches for an organization using saved configuration.
 */
export async function getKiotvietBranches(orgId: string, config: KiotvietConfig): Promise<Array<{ id: number; branchName: string }>> {
  const result = await executeApiRequest<{ data?: Array<{ id: number; branchName: string }> }>(orgId, config, {
    path: '/branches',
  });
  return result?.data ?? [];
}

/**
 * Fetch branches using draft credentials without persisting configuration.
 */
export async function getDraftKiotvietBranches(
  clientId: string,
  clientSecret: string,
  retailer: string
): Promise<Array<{ id: number; branchName: string }>> {
  const token = await getDraftKiotvietAccessToken(clientId, clientSecret);

  const url = new URL('/branches', KIOTVIET_API_BASE);
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Retailer': retailer,
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new KiotvietApiError(`Failed to fetch branches from KiotViet (HTTP ${response.status})`, response.status);
  }

  const result = (await response.json()) as { data?: Array<{ id: number; branchName: string }> };
  return result?.data ?? [];
}

/**
 * Fetch sellers / users for an organization.
 */
export async function getKiotvietSellers(orgId: string, config: KiotvietConfig): Promise<Array<{ id: number; userName: string; givenName?: string }>> {
  try {
    const result = await executeApiRequest<{ data?: Array<{ id: number; userName: string; givenName?: string }> }>(orgId, config, {
      path: '/users',
    });
    return result?.data ?? [];
  } catch (err) {
    logger.warn('[kiotviet-client] Failed to fetch users/sellers from KiotViet:', err);
    return [];
  }
}

/**
 * Fetch payment accounts for an organization.
 */
export async function getKiotvietPaymentAccounts(orgId: string, config: KiotvietConfig): Promise<Array<{ id: number; accountName?: string; bankName?: string }>> {
  try {
    const result = await executeApiRequest<{ data?: Array<{ id: number; accountName?: string; bankName?: string }> }>(orgId, config, {
      path: '/paymentmethods',
    });
    return result?.data ?? [];
  } catch (err) {
    logger.warn('[kiotviet-client] Failed to fetch payment methods from KiotViet:', err);
    return [];
  }
}

/**
 * Fetch product catalog page with inventory from KiotViet.
 */
export async function getKiotvietProductsPage(
  orgId: string,
  config: KiotvietConfig,
  params: {
    pageSize?: number;
    currentItem?: number;
    lastModifiedFrom?: string;
    includeInventory?: boolean;
    signal?: AbortSignal;
  }
): Promise<{ total: number; pageSize: number; data: any[] }> {
  const query: Record<string, string | number | boolean | undefined> = {
    pageSize: params.pageSize ?? 100,
    currentItem: params.currentItem ?? 0,
    includeInventory: params.includeInventory ?? true,
  };

  if (params.lastModifiedFrom) {
    query.lastModifiedFrom = params.lastModifiedFrom;
  }

  return await executeApiRequest<{ total: number; pageSize: number; data: any[] }>(orgId, config, {
    path: '/products',
    query,
    signal: params.signal,
    timeoutMs: 15_000,
  });
}

/**
 * Search customers by normalized phone number or phone variants.
 * Queries dual formats (e.g. 0xxx and 84xxx) in parallel via Promise.all
 * and deduplicates customer records by ID.
 */
export async function searchKiotvietCustomersByPhone(
  orgId: string,
  config: KiotvietConfig,
  phone: string
): Promise<KiotvietCustomerSearchResult[]> {
  const variants = normalizeVietnamesePhoneNumberVariants(phone);
  const searchPhones = variants.length > 0 ? variants : (phone ? [phone] : []);

  if (searchPhones.length === 0) {
    return [];
  }

  const results = await Promise.all(
    searchPhones.map((p) =>
      executeApiRequest<{ data?: any[] }>(orgId, config, {
        path: '/customers',
        query: {
          contactNumber: p,
          pageSize: 20,
        },
      })
    )
  );

  const seenIds = new Set<string>();
  const merged: KiotvietCustomerSearchResult[] = [];

  for (const result of results) {
    const list = result?.data ?? [];
    for (const c of list) {
      const idStr = String(c.id);
      if (!seenIds.has(idStr)) {
        seenIds.add(idStr);
        merged.push({
          id: idStr,
          code: c.code || '',
          name: c.name || '',
          phone: c.contactNumber || '',
          address: c.address || '',
        });
      }
    }
  }

  return merged;
}

/**
 * Create a new customer on KiotViet.
 */
export async function createKiotvietCustomer(
  orgId: string,
  config: KiotvietConfig,
  data: { name: string; phone: string; address?: string }
): Promise<KiotvietCustomerSearchResult> {
  const result = await executeApiRequest<{ id: number; code: string; name: string }>(orgId, config, {
    method: 'POST',
    path: '/customers',
    body: {
      name: data.name,
      contactNumber: data.phone,
      address: data.address || undefined,
      branchId: config.branchId ? Number(config.branchId) : undefined,
    },
    timeoutMs: 10_000,
  });

  return {
    id: String(result.id),
    code: result.code,
    name: result.name,
    phone: data.phone,
    address: data.address,
  };
}

/**
 * Create an invoice on KiotViet (used by Phase 03 worker).
 */
export async function createKiotvietInvoice(
  orgId: string,
  config: KiotvietConfig,
  payload: any,
  signal?: AbortSignal
): Promise<{ id: number; code: string }> {
  return await executeApiRequest<{ id: number; code: string }>(orgId, config, {
    method: 'POST',
    path: '/invoices',
    body: payload,
    isPriorityWrite: true,
    signal,
    timeoutMs: 15_000,
  });
}

/**
 * Fetch an invoice by ID from KiotViet (used by Phase 03 reconciliation).
 */
export async function getKiotvietInvoice(
  orgId: string,
  config: KiotvietConfig,
  invoiceId: string
): Promise<any> {
  return await executeApiRequest<any>(orgId, config, {
    method: 'GET',
    path: `/invoices/${invoiceId}`,
    timeoutMs: 10_000,
  });
}
