/**
 * visual-fact-cache.ts — In-Memory LRU Cache with strict multi-tenant isolation and TTL for visual facts.
 */
import crypto from 'node:crypto';
import type { VerifiedVisualFact } from './visual-fact-types.js';

interface CacheEntry {
  fact: VerifiedVisualFact;
  expiresAt: number;
}

export class VisualFactCache {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private cache = new Map<string, CacheEntry>();
  private sweepTimer?: NodeJS.Timeout;

  constructor(maxEntries = 500, ttlMs = 24 * 60 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;

    // Periodic sweep every 30 minutes to prevent V8 memory leak, unref'd to not block process exit
    this.sweepTimer = setInterval(() => {
      this.sweepExpired();
    }, 30 * 60 * 1000);
    if (this.sweepTimer.unref) {
      this.sweepTimer.unref();
    }
  }

  private buildKey(orgId?: string, buffer?: Buffer): string | null {
    if (!orgId || !buffer || buffer.length === 0) {
      return null; // Strict isolation: never fallback to 'common'
    }
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return `${orgId}:${hash}`;
  }

  public get(orgId?: string, buffer?: Buffer): VerifiedVisualFact | null {
    const key = this.buildKey(orgId, buffer);
    if (!key) return null;

    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Refresh LRU position (delete & re-insert)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.fact;
  }

  public set(orgId?: string, buffer?: Buffer, fact?: VerifiedVisualFact): void {
    if (!fact) return;
    const key = this.buildKey(orgId, buffer);
    if (!key) return;

    // Evict oldest if limit reached
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      fact,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  public sweepExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  public clear(): void {
    this.cache.clear();
  }

  public size(): number {
    return this.cache.size;
  }

  public destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
    this.clear();
  }
}

export const globalVisualFactCache = new VisualFactCache();
