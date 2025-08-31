/**
 * Simple in-memory cache with TTL support for performance optimization
 */

import { createLogger } from './logger';

const logger = createLogger('cache');

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

export interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  maxSize?: number; // Maximum number of entries
  cleanupInterval?: number; // Cleanup interval in milliseconds
}

export class Cache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private options: Required<CacheOptions>;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(options: CacheOptions = {}) {
    this.options = {
      ttl: options.ttl || 300000, // 5 minutes default
      maxSize: options.maxSize || 1000,
      cleanupInterval: options.cleanupInterval || 60000 // 1 minute default
    };

    // Start cleanup timer
    this.startCleanup();

    logger.debug('Cache initialized', { options: this.options });
  }

  /**
   * Get a value from the cache
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      logger.debug('Cache miss', { key });
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      logger.debug('Cache entry expired', { key, expiresAt: entry.expiresAt });
      this.cache.delete(key);
      return undefined;
    }

    logger.debug('Cache hit', { key, age: Date.now() - entry.createdAt });
    return entry.value;
  }

  /**
   * Set a value in the cache
   */
  set(key: string, value: T, ttl?: number): void {
    const actualTtl = ttl || this.options.ttl;
    const now = Date.now();
    
    const entry: CacheEntry<T> = {
      value,
      expiresAt: now + actualTtl,
      createdAt: now
    };

    // Check if we need to make room
    if (this.cache.size >= this.options.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, entry);
    logger.debug('Cache set', { key, ttl: actualTtl, size: this.cache.size });
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Delete a specific key
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      logger.debug('Cache entry deleted', { key });
    }
    return deleted;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    logger.debug('Cache cleared', { previousSize: size });
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    ttl: number;
    entries: Array<{ key: string; age: number; ttl: number }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      age: now - entry.createdAt,
      ttl: entry.expiresAt - now
    }));

    return {
      size: this.cache.size,
      maxSize: this.options.maxSize,
      ttl: this.options.ttl,
      entries
    };
  }

  /**
   * Get or set a value using a factory function
   */
  async getOrSet(key: string, factory: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    logger.debug('Cache miss, calling factory', { key });
    const value = await factory();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Get or set a value using a synchronous factory function
   */
  getOrSetSync(key: string, factory: () => T, ttl?: number): T {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    logger.debug('Cache miss, calling sync factory', { key });
    const value = factory();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Invalidate entries matching a pattern
   */
  invalidatePattern(pattern: string | RegExp): number {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    let count = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    logger.debug('Cache pattern invalidation', { pattern: pattern.toString(), count });
    return count;
  }

  /**
   * Start the cleanup timer
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.options.cleanupInterval);
  }

  /**
   * Stop the cleanup timer
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Cache cleanup completed', { cleaned, remaining: this.cache.size });
    }
  }

  /**
   * Evict the oldest entry to make room
   */
  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      logger.debug('Cache eviction', { evictedKey: oldestKey });
    }
  }

  /**
   * Destroy the cache and cleanup resources
   */
  destroy(): void {
    this.stopCleanup();
    this.clear();
    logger.debug('Cache destroyed');
  }
}

/**
 * Global cache instances for common use cases
 */
export const configCache = new Cache<any>({
  ttl: 600000, // 10 minutes
  maxSize: 100
});

export const serviceStatusCache = new Cache<any>({
  ttl: 30000, // 30 seconds
  maxSize: 500
});

export const dockerApiCache = new Cache<any>({
  ttl: 10000, // 10 seconds
  maxSize: 200
});

/**
 * Memoization decorator for caching method results
 */
export function memoize<T extends (...args: any[]) => any>(
  target: any,
  propertyName: string,
  descriptor: TypedPropertyDescriptor<T>
): TypedPropertyDescriptor<T> | void {
  const originalMethod = descriptor.value;
  if (!originalMethod) return;

  const cache = new Map<string, { result: any; timestamp: number }>();
  const ttl = 300000; // 5 minutes

  descriptor.value = function (this: any, ...args: any[]) {
    const key = JSON.stringify(args);
    const now = Date.now();
    const cached = cache.get(key);

    if (cached && (now - cached.timestamp) < ttl) {
      logger.debug('Method cache hit', { method: propertyName, key });
      return cached.result;
    }

    logger.debug('Method cache miss', { method: propertyName, key });
    const result = originalMethod.apply(this, args);
    cache.set(key, { result, timestamp: now });

    // Cleanup old entries periodically
    if (cache.size > 100) {
      const cutoff = now - ttl;
      for (const [k, v] of cache.entries()) {
        if (v.timestamp < cutoff) {
          cache.delete(k);
        }
      }
    }

    return result;
  } as T;

  return descriptor;
}