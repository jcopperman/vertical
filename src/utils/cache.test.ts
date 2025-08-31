/**
 * Cache utilities tests
 */

import { Cache, configCache, serviceStatusCache, dockerApiCache, memoize } from './cache';

describe('Cache Utilities', () => {
  let cache: Cache<string>;

  beforeEach(() => {
    cache = new Cache<string>({ ttl: 1000, maxSize: 5 });
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('Basic Cache Operations', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should check if key exists', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should delete keys', () => {
      cache.set('key1', 'value1');
      expect(cache.delete('key1')).toBe(true);
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.delete('nonexistent')).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
    });
  });

  describe('TTL (Time To Live)', () => {
    it('should expire entries after TTL', (done) => {
      const shortCache = new Cache<string>({ ttl: 50 });
      
      shortCache.set('key1', 'value1');
      expect(shortCache.get('key1')).toBe('value1');
      
      setTimeout(() => {
        expect(shortCache.get('key1')).toBeUndefined();
        shortCache.destroy();
        done();
      }, 100);
    });

    it('should allow custom TTL per entry', (done) => {
      cache.set('key1', 'value1', 50); // 50ms TTL
      cache.set('key2', 'value2', 200); // 200ms TTL
      
      setTimeout(() => {
        expect(cache.get('key1')).toBeUndefined();
        expect(cache.get('key2')).toBe('value2');
        done();
      }, 100);
    });
  });

  describe('Size Limits', () => {
    it('should evict oldest entries when max size reached', () => {
      // Fill cache to max size
      for (let i = 1; i <= 5; i++) {
        cache.set(`key${i}`, `value${i}`);
      }
      
      // Add one more to trigger eviction
      cache.set('key6', 'value6');
      
      // First entry should be evicted
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key6')).toBe('value6');
    });
  });

  describe('Advanced Operations', () => {
    it('should get or set with factory function', async () => {
      let factoryCalled = false;
      
      const factory = async () => {
        factoryCalled = true;
        return 'factory-value';
      };
      
      // First call should use factory
      const result1 = await cache.getOrSet('key1', factory);
      expect(result1).toBe('factory-value');
      expect(factoryCalled).toBe(true);
      
      // Second call should use cache
      factoryCalled = false;
      const result2 = await cache.getOrSet('key1', factory);
      expect(result2).toBe('factory-value');
      expect(factoryCalled).toBe(false);
    });

    it('should get or set with sync factory function', () => {
      let factoryCalled = false;
      
      const factory = () => {
        factoryCalled = true;
        return 'sync-factory-value';
      };
      
      // First call should use factory
      const result1 = cache.getOrSetSync('key1', factory);
      expect(result1).toBe('sync-factory-value');
      expect(factoryCalled).toBe(true);
      
      // Second call should use cache
      factoryCalled = false;
      const result2 = cache.getOrSetSync('key1', factory);
      expect(result2).toBe('sync-factory-value');
      expect(factoryCalled).toBe(false);
    });

    it('should invalidate entries by pattern', () => {
      cache.set('user:1', 'user1');
      cache.set('user:2', 'user2');
      cache.set('post:1', 'post1');
      
      const invalidated = cache.invalidatePattern(/^user:/);
      
      expect(invalidated).toBe(2);
      expect(cache.get('user:1')).toBeUndefined();
      expect(cache.get('user:2')).toBeUndefined();
      expect(cache.get('post:1')).toBe('post1');
    });
  });

  describe('Statistics', () => {
    it('should provide cache statistics', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      
      const stats = cache.getStats();
      
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(5);
      expect(stats.entries).toHaveLength(2);
      expect(stats.entries[0].key).toBe('key1');
    });
  });

  describe('Cleanup', () => {
    it('should automatically clean up expired entries', (done) => {
      const cleanupCache = new Cache<string>({ 
        ttl: 50, 
        cleanupInterval: 25 
      });
      
      cleanupCache.set('key1', 'value1');
      cleanupCache.set('key2', 'value2');
      
      expect(cleanupCache.getStats().size).toBe(2);
      
      setTimeout(() => {
        // Entries should be expired and cleaned up
        expect(cleanupCache.getStats().size).toBe(0);
        cleanupCache.destroy();
        done();
      }, 100);
    });
  });

  describe('Global Cache Instances', () => {
    afterEach(() => {
      configCache.clear();
      serviceStatusCache.clear();
      dockerApiCache.clear();
    });

    it('should have working config cache', () => {
      configCache.set('test-config', { version: '1.0.0' });
      expect(configCache.get('test-config')).toEqual({ version: '1.0.0' });
    });

    it('should have working service status cache', () => {
      const status = { name: 'test-service', health: 'healthy' };
      serviceStatusCache.set('test-service', status);
      expect(serviceStatusCache.get('test-service')).toEqual(status);
    });

    it('should have working Docker API cache', () => {
      const containers = [{ id: '123', name: 'test' }];
      dockerApiCache.set('containers', containers);
      expect(dockerApiCache.get('containers')).toEqual(containers);
    });
  });

  describe('Memoization Decorator', () => {
    class TestClass {
      callCount = 0;

      @memoize
      expensiveOperation(input: string): string {
        this.callCount++;
        return `processed-${input}`;
      }
    }

    it('should memoize method results', () => {
      const instance = new TestClass();
      
      // First call
      const result1 = instance.expensiveOperation('test');
      expect(result1).toBe('processed-test');
      expect(instance.callCount).toBe(1);
      
      // Second call with same input should use cache
      const result2 = instance.expensiveOperation('test');
      expect(result2).toBe('processed-test');
      expect(instance.callCount).toBe(1);
      
      // Different input should call method again
      const result3 = instance.expensiveOperation('other');
      expect(result3).toBe('processed-other');
      expect(instance.callCount).toBe(2);
    });
  });

  describe('Performance Tests', () => {
    it('should handle large number of operations efficiently', () => {
      const largeCache = new Cache<number>({ maxSize: 10000 });
      const iterations = 5000;
      
      const startTime = performance.now();
      
      // Write operations
      for (let i = 0; i < iterations; i++) {
        largeCache.set(`key-${i}`, i);
      }
      
      // Read operations
      for (let i = 0; i < iterations; i++) {
        largeCache.get(`key-${i}`);
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`Cache performance: ${duration.toFixed(2)}ms for ${iterations * 2} operations`);
      
      // Should complete in reasonable time (adjust threshold as needed)
      expect(duration).toBeLessThan(1000);
      
      largeCache.destroy();
    });

    it('should handle concurrent operations', async () => {
      const concurrentCache = new Cache<string>();
      const promises: Promise<void>[] = [];
      
      // Create multiple concurrent operations
      for (let i = 0; i < 100; i++) {
        promises.push(
          (async () => {
            await concurrentCache.getOrSet(`key-${i}`, async () => {
              await new Promise(resolve => setTimeout(resolve, 1));
              return `value-${i}`;
            });
          })()
        );
      }
      
      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(100);
      expect(concurrentCache.getStats().size).toBe(100);
      
      concurrentCache.destroy();
    });
  });
});