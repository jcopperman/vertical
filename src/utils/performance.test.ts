/**
 * Performance utilities tests and benchmarks
 */

import { PerformanceMonitor, performanceMonitor, debounce, throttle, BatchProcessor } from './performance';
import { Cache } from './cache';

describe('Performance Utilities', () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor();
  });

  afterEach(() => {
    monitor.clearMetrics();
  });

  describe('PerformanceMonitor', () => {
    it('should track timing metrics', async () => {
      monitor.startTimer('test-operation');
      await new Promise(resolve => setTimeout(resolve, 10));
      const duration = monitor.endTimer('test-operation');

      expect(duration).toBeGreaterThan(0);
      
      const stats = monitor.getStats('test-operation');
      expect(stats.totalOperations).toBe(1);
      expect(stats.averageDuration).toBeGreaterThan(0);
    });

    it('should handle async timing', async () => {
      const result = await monitor.timeAsync('async-test', async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return 'success';
      });

      expect(result).toBe('success');
      
      const stats = monitor.getStats('async-test');
      expect(stats.totalOperations).toBe(1);
    });

    it('should handle sync timing', () => {
      const result = monitor.timeSync('sync-test', () => {
        return 42;
      });

      expect(result).toBe(42);
      
      const stats = monitor.getStats('sync-test');
      expect(stats.totalOperations).toBe(1);
    });

    it('should calculate percentiles correctly', () => {
      // Add multiple metrics with known durations
      for (let i = 1; i <= 100; i++) {
        monitor.addMetric({
          name: 'percentile-test',
          duration: i,
          startTime: 0,
          endTime: i,
        });
      }

      const stats = monitor.getStats('percentile-test');
      expect(stats.totalOperations).toBe(100);
      expect(stats.minDuration).toBe(1);
      expect(stats.maxDuration).toBe(100);
      expect(stats.p95Duration).toBe(95);
      expect(stats.p99Duration).toBe(99);
    });

    it('should generate performance report', () => {
      monitor.addMetric({
        name: 'test-op',
        duration: 100,
        startTime: 0,
        endTime: 100,
      });

      const report = monitor.getReport();
      expect(report).toContain('Performance Report');
      expect(report).toContain('test-op');
      expect(report).toContain('100.00ms');
    });
  });

  describe('Debounce', () => {
    it('should debounce function calls', (done) => {
      let callCount = 0;
      const debouncedFn = debounce(() => {
        callCount++;
      }, 50);

      // Call multiple times rapidly
      debouncedFn();
      debouncedFn();
      debouncedFn();

      // Should only be called once after delay
      setTimeout(() => {
        expect(callCount).toBe(1);
        done();
      }, 100);
    });
  });

  describe('Throttle', () => {
    it('should throttle function calls', (done) => {
      let callCount = 0;
      const throttledFn = throttle(() => {
        callCount++;
      }, 50);

      // Call multiple times rapidly
      throttledFn();
      throttledFn();
      throttledFn();

      // Should only be called once immediately
      expect(callCount).toBe(1);

      setTimeout(() => {
        throttledFn();
        expect(callCount).toBe(2);
        done();
      }, 100);
    });
  });

  describe('BatchProcessor', () => {
    it('should batch operations by size', async () => {
      const processedBatches: number[][] = [];
      
      const processor = new BatchProcessor<number, string>(
        async (items: number[]) => {
          processedBatches.push([...items]);
          return items.map(i => `processed-${i}`);
        },
        3, // batch size
        1000 // timeout
      );

      // Add items that should trigger batch processing
      const promises = [
        processor.add(1),
        processor.add(2),
        processor.add(3), // This should trigger batch processing
      ];

      const results = await Promise.all(promises);
      
      expect(results).toEqual(['processed-1', 'processed-2', 'processed-3']);
      expect(processedBatches).toHaveLength(1);
      expect(processedBatches[0]).toEqual([1, 2, 3]);
    });

    it('should batch operations by timeout', async () => {
      const processedBatches: number[][] = [];
      
      const processor = new BatchProcessor<number, string>(
        async (items: number[]) => {
          processedBatches.push([...items]);
          return items.map(i => `processed-${i}`);
        },
        10, // large batch size
        50 // short timeout
      );

      // Add items that won't reach batch size
      const promises = [
        processor.add(1),
        processor.add(2),
      ];

      const results = await Promise.all(promises);
      
      expect(results).toEqual(['processed-1', 'processed-2']);
      expect(processedBatches).toHaveLength(1);
      expect(processedBatches[0]).toEqual([1, 2]);
    });
  });

  describe('Performance Benchmarks', () => {
    it('should benchmark cache performance', async () => {
      const cache = new Cache<string>({ ttl: 60000, maxSize: 1000 });
      const iterations = 1000;

      // Benchmark cache writes
      monitor.startTimer('cache-writes');
      for (let i = 0; i < iterations; i++) {
        cache.set(`key-${i}`, `value-${i}`);
      }
      const writeTime = monitor.endTimer('cache-writes');

      // Benchmark cache reads
      monitor.startTimer('cache-reads');
      for (let i = 0; i < iterations; i++) {
        cache.get(`key-${i}`);
      }
      const readTime = monitor.endTimer('cache-reads');

      console.log(`Cache write performance: ${writeTime.toFixed(2)}ms for ${iterations} operations`);
      console.log(`Cache read performance: ${readTime.toFixed(2)}ms for ${iterations} operations`);

      // Performance assertions (these are rough benchmarks)
      expect(writeTime).toBeLessThan(100); // Should complete writes in under 100ms
      expect(readTime).toBeLessThan(50);   // Should complete reads in under 50ms

      cache.destroy();
    });

    it('should benchmark configuration loading', async () => {
      // This would test actual config loading performance
      // For now, we'll simulate it
      const loadConfig = async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return { version: '1.0.0', profile: 'local' };
      };

      const iterations = 100;
      
      monitor.startTimer('config-loading');
      for (let i = 0; i < iterations; i++) {
        await loadConfig();
      }
      const totalTime = monitor.endTimer('config-loading');

      console.log(`Config loading performance: ${totalTime.toFixed(2)}ms for ${iterations} operations`);
      
      const avgTime = totalTime / iterations;
      expect(avgTime).toBeLessThan(10); // Average should be under 10ms per load
    });

    it('should benchmark Docker API calls simulation', async () => {
      // Simulate Docker API call performance
      const dockerApiCall = async () => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 5));
        return { containers: [] };
      };

      const iterations = 50;
      
      monitor.startTimer('docker-api-calls');
      for (let i = 0; i < iterations; i++) {
        await dockerApiCall();
      }
      const totalTime = monitor.endTimer('docker-api-calls');

      console.log(`Docker API performance: ${totalTime.toFixed(2)}ms for ${iterations} operations`);
      
      const avgTime = totalTime / iterations;
      expect(avgTime).toBeLessThan(20); // Average should be under 20ms per call
    });
  });

  describe('Memory Performance', () => {
    it('should track memory usage during operations', () => {
      const initialMemory = process.memoryUsage();
      
      // Perform memory-intensive operation
      const largeArray = new Array(100000).fill('test-data');
      
      const finalMemory = process.memoryUsage();
      
      expect(finalMemory.heapUsed).toBeGreaterThan(initialMemory.heapUsed);
      
      // Clean up
      largeArray.length = 0;
    });
  });
});