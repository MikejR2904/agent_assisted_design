import crypto from 'crypto';
import type { LLMMessage } from './ModelRouter';
import { logger } from '../utils/logger';

interface CacheEntry {
  response: string;
  timestamp: number;
}

/**
 * TTL-based in-memory cache for LLM completions.
 * Key = SHA-256 of (systemPrompt + serialised messages).
 * Avoids re-computing repeated prefills
 */
export class PromptCache {
  private cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs = 60_000) {
    this.ttlMs = ttlMs;
  }

  // Compute a stable cache key from the full prompt context
  static buildKey(systemPrompt: string, messages: LLMMessage[]): string {
    const payload = systemPrompt + '\x00' + JSON.stringify(messages);
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  get(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    logger.debug('PromptCache hit', { key: key.slice(0, 12) });
    return entry.response;
  }

  set(key: string, response: string): void {
    this.cache.set(key, { response, timestamp: Date.now() });
  }

  // Remove all stale entries. Call periodically if needed
  evictExpired(): void {
    const now = Date.now();
    for (const [k, v] of this.cache) {
      if (now - v.timestamp > this.ttlMs) this.cache.delete(k);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}