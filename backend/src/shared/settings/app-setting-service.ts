import { prisma } from '../database/prisma-client.js';
import { decodeSecureSetting } from './secure-setting-codec.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const MAX_ENTRIES = 1000;
const DEFAULT_TTL_MS = 60_000; // 60s

class BoundedLruCache<T> {
  private map = new Map<string, CacheEntry<T>>();
  private maxEntries: number;

  constructor(maxEntries = MAX_ENTRIES) {
    this.maxEntries = maxEntries;
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Re-insert to maintain LRU order
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      // Evict oldest (first key in map)
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

const appSettingCache = new BoundedLruCache<any>(MAX_ENTRIES);

function clone<T>(val: T): T {
  if (val === null || val === undefined) return val;
  if (typeof val !== 'object') return val;
  try {
    return structuredClone(val);
  } catch {
    return JSON.parse(JSON.stringify(val));
  }
}

/**
 * Retrieves an AppSetting's plain value (or parsed JSON object) with In-Memory LRU Cache.
 * Returns a defensive copy to prevent caller mutation of cached state.
 */
export async function getAppSetting<T = any>(orgId: string, settingKey: string): Promise<T | null> {
  const cacheKey = `${orgId}:${settingKey}`;
  const cached = appSettingCache.get(cacheKey);
  if (cached !== undefined) {
    return clone(cached);
  }

  const row = await prisma.appSetting.findUnique({
    where: { orgId_settingKey: { orgId, settingKey } },
  });

  if (!row) {
    appSettingCache.set(cacheKey, null);
    return null;
  }

  let value: any = row.valuePlain;
  if (typeof row.valuePlain === 'string') {
    try {
      value = JSON.parse(row.valuePlain);
    } catch {
      value = row.valuePlain;
    }
  }

  appSettingCache.set(cacheKey, value);
  return clone(value);
}

/**
 * Retrieves an AppSetting's decrypted secret with In-Memory LRU Cache.
 * Returns a defensive copy.
 */
export async function getDecryptedAppSetting(orgId: string, settingKey: string): Promise<string | null> {
  const cacheKey = `${orgId}:${settingKey}:decrypted`;
  const cached = appSettingCache.get(cacheKey);
  if (cached !== undefined) {
    return clone(cached);
  }

  const row = await prisma.appSetting.findUnique({
    where: { orgId_settingKey: { orgId, settingKey } },
  });

  const decrypted = decodeSecureSetting(row);
  appSettingCache.set(cacheKey, decrypted);
  return clone(decrypted);
}

/**
 * Invalidates cached settings for a given org and key (both plain and decrypted).
 */
export function invalidateAppSetting(orgId: string, settingKey: string): void {
  appSettingCache.delete(`${orgId}:${settingKey}`);
  appSettingCache.delete(`${orgId}:${settingKey}:decrypted`);
}

/**
 * Clears the entire setting cache (primarily for tests).
 */
export function clearAppSettingCache(): void {
  appSettingCache.clear();
}

export function getAppSettingCacheSize(): number {
  return appSettingCache.size;
}
