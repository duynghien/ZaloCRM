/**
 * chat-copilot-cache.ts — In-Memory zero-dependency LRU cache using native JavaScript Map.
 */
import type { CopilotAnalysisResult } from './chat-copilot-types.js';

interface CacheEntry {
  value: CopilotAnalysisResult;
  expiresAt: number;
}

export class ChatCopilotCache {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(maxEntries = 500, ttlMs = 300_000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  get(key: string): CopilotAnalysisResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Refresh LRU order (delete & re-insert)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: CopilotAnalysisResult): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      // Evict oldest entry (first item in insertion order)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

export const chatCopilotCache = new ChatCopilotCache();
