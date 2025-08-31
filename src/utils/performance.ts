/**
 * Performance monitoring and optimization utilities
 */

import { createLogger } from './logger';

const logger = createLogger('performance');

export interface PerformanceMetric {
  name: string;
  duration: number;
  startTime: number;
  endTime: number;
  metadata?: Record<string, any>;
}

export interface PerformanceStats {
  totalOperations: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  p95Duration: number;
  p99Duration: number;
}

export class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private activeTimers = new Map<string, number>();
  private maxMetrics: number;

  constructor(maxMetrics: number = 1000) {
    this.maxMetrics = maxMetrics;
  }

  /**
   * Start timing an operation
   */
  startTimer(name: string): void {
    const startTime = performance.now();
    this.activeTimers.set(name, startTime);
    logger.debug('Timer started', { name, startTime });
  }

  /**
   * End timing an operation and record the metric
   */
  endTimer(name: string, metadata?: Record<string, any>): number {
    const endTime = performance.now();
    const startTime = this.activeTimers.get(name);

    if (!startTime) {
      logger.warn('Timer not found', { name });
      return 0;
    }

    const duration = endTime - startTime;
    this.activeTimers.delete(name);

    const metric: PerformanceMetric = {
      name,
      duration,
      startTime,
      endTime,
      metadata
    };

    this.addMetric(metric);
    logger.debug('Timer ended', { name, duration, metadata });

    return duration;
  }

  /**
   * Time a function execution
   */
  async timeAsync<T>(name: string, fn: () => Promise<T>, metadata?: Record<string, any>): Promise<T> {
    this.startTimer(name);
    try {
      const result = await fn();
      this.endTimer(name, metadata);
      return result;
    } catch (error) {
      this.endTimer(name, { ...metadata, error: true });
      throw error;
    }
  }

  /**
   * Time a synchronous function execution
   */
  timeSync<T>(name: string, fn: () => T, metadata?: Record<string, any>): T {
    this.startTimer(name);
    try {
      const result = fn();
      this.endTimer(name, metadata);
      return result;
    } catch (error) {
      this.endTimer(name, { ...metadata, error: true });
      throw error;
    }
  }

  /**
   * Add a metric manually
   */
  addMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);

    // Keep only the most recent metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }
  }

  /**
   * Get performance statistics for a specific operation
   */
  getStats(operationName?: string): PerformanceStats {
    const relevantMetrics = operationName
      ? this.metrics.filter(m => m.name === operationName)
      : this.metrics;

    if (relevantMetrics.length === 0) {
      return {
        totalOperations: 0,
        averageDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        p95Duration: 0,
        p99Duration: 0
      };
    }

    const durations = relevantMetrics.map(m => m.duration).sort((a, b) => a - b);
    const total = durations.reduce((sum, d) => sum + d, 0);

    return {
      totalOperations: relevantMetrics.length,
      averageDuration: total / relevantMetrics.length,
      minDuration: durations[0],
      maxDuration: durations[durations.length - 1],
      p95Duration: durations[Math.floor(durations.length * 0.95)],
      p99Duration: durations[Math.floor(durations.length * 0.99)]
    };
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  /**
   * Get metrics for a specific time range
   */
  getMetricsInRange(startTime: number, endTime: number): PerformanceMetric[] {
    return this.metrics.filter(m => 
      m.startTime >= startTime && m.endTime <= endTime
    );
  }

  /**
   * Clear all metrics
   */
  clearMetrics(): void {
    this.metrics = [];
    logger.debug('Performance metrics cleared');
  }

  /**
   * Get a summary report
   */
  getReport(): string {
    const operationNames = [...new Set(this.metrics.map(m => m.name))];
    let report = 'Performance Report\n';
    report += '==================\n\n';

    for (const name of operationNames) {
      const stats = this.getStats(name);
      report += `Operation: ${name}\n`;
      report += `  Total Operations: ${stats.totalOperations}\n`;
      report += `  Average Duration: ${stats.averageDuration.toFixed(2)}ms\n`;
      report += `  Min Duration: ${stats.minDuration.toFixed(2)}ms\n`;
      report += `  Max Duration: ${stats.maxDuration.toFixed(2)}ms\n`;
      report += `  95th Percentile: ${stats.p95Duration.toFixed(2)}ms\n`;
      report += `  99th Percentile: ${stats.p99Duration.toFixed(2)}ms\n\n`;
    }

    return report;
  }
}

/**
 * Performance decorator for automatic timing of method calls
 */
export function timed(name?: string) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const timerName = name || `${target.constructor.name}.${propertyName}`;

    descriptor.value = function (...args: any[]) {
      return performanceMonitor.timeSync(timerName, () => {
        return originalMethod.apply(this, args);
      });
    };

    return descriptor;
  };
}

/**
 * Async performance decorator
 */
export function timedAsync(name?: string) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const timerName = name || `${target.constructor.name}.${propertyName}`;

    descriptor.value = async function (...args: any[]) {
      return performanceMonitor.timeAsync(timerName, async () => {
        return originalMethod.apply(this, args);
      });
    };

    return descriptor;
  };
}

/**
 * Debounce utility for reducing API calls
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle utility for rate limiting
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  
  return function executedFunction(this: any, ...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Batch utility for batching operations
 */
export class BatchProcessor<T, R> {
  private batch: T[] = [];
  private timer?: NodeJS.Timeout;
  private processor: (items: T[]) => Promise<R[]>;
  private batchSize: number;
  private batchTimeout: number;

  constructor(
    processor: (items: T[]) => Promise<R[]>,
    batchSize: number = 10,
    batchTimeout: number = 1000
  ) {
    this.processor = processor;
    this.batchSize = batchSize;
    this.batchTimeout = batchTimeout;
  }

  /**
   * Add an item to the batch
   */
  add(item: T): Promise<R> {
    return new Promise((resolve, reject) => {
      this.batch.push(item);
      
      // Store the resolve/reject functions with the item
      (item as any).__resolve = resolve;
      (item as any).__reject = reject;

      // Process immediately if batch is full
      if (this.batch.length >= this.batchSize) {
        this.processBatch();
      } else {
        // Set timer for batch timeout
        if (!this.timer) {
          this.timer = setTimeout(() => {
            this.processBatch();
          }, this.batchTimeout);
        }
      }
    });
  }

  /**
   * Process the current batch
   */
  private async processBatch(): Promise<void> {
    if (this.batch.length === 0) return;

    const currentBatch = this.batch.splice(0);
    
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    try {
      const results = await this.processor(currentBatch);
      
      // Resolve all promises
      currentBatch.forEach((item, index) => {
        const resolve = (item as any).__resolve;
        if (resolve) {
          resolve(results[index]);
        }
      });
    } catch (error) {
      // Reject all promises
      currentBatch.forEach(item => {
        const reject = (item as any).__reject;
        if (reject) {
          reject(error);
        }
      });
    }
  }

  /**
   * Flush any pending items
   */
  async flush(): Promise<void> {
    if (this.batch.length > 0) {
      await this.processBatch();
    }
  }
}

// Global performance monitor instance
export const performanceMonitor = new PerformanceMonitor();

/**
 * Memory usage monitoring
 */
export function getMemoryUsage(): {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
} {
  const usage = process.memoryUsage();
  return {
    rss: Math.round(usage.rss / 1024 / 1024), // MB
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
    external: Math.round(usage.external / 1024 / 1024), // MB
    arrayBuffers: Math.round(usage.arrayBuffers / 1024 / 1024) // MB
  };
}

/**
 * Log memory usage
 */
export function logMemoryUsage(context?: string): void {
  const usage = getMemoryUsage();
  logger.info('Memory usage', { context, ...usage });
}