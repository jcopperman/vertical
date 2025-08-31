#!/usr/bin/env node

/**
 * Performance benchmark script for OTP CLI optimizations
 */

import { Cache, configCache, serviceStatusCache, dockerApiCache } from './cache';
import { performanceMonitor, PerformanceMonitor, getMemoryUsage } from './performance';
import { DefaultConfigurationManager } from '../config/manager';
import { DockerClient } from '../docker/client';

async function runBenchmarks() {
  console.log('🚀 OTP CLI Performance Benchmarks\n');
  console.log('=' .repeat(50));

  // Cache Performance Benchmark
  console.log('\n📦 Cache Performance');
  console.log('-'.repeat(30));
  
  const cache = new Cache<string>({ maxSize: 10000, ttl: 300000 });
  const iterations = 5000;

  // Benchmark cache writes
  const writeStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    cache.set(`key-${i}`, `value-${i}`);
  }
  const writeTime = performance.now() - writeStart;

  // Benchmark cache reads
  const readStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    cache.get(`key-${i}`);
  }
  const readTime = performance.now() - readStart;

  console.log(`Cache Writes: ${writeTime.toFixed(2)}ms for ${iterations} operations`);
  console.log(`Cache Reads:  ${readTime.toFixed(2)}ms for ${iterations} operations`);
  console.log(`Write Rate:   ${(iterations / writeTime * 1000).toFixed(0)} ops/sec`);
  console.log(`Read Rate:    ${(iterations / readTime * 1000).toFixed(0)} ops/sec`);

  cache.destroy();

  // Configuration Loading Benchmark
  console.log('\n⚙️  Configuration Loading Performance');
  console.log('-'.repeat(30));

  const configManager = new DefaultConfigurationManager();
  
  try {
    // First load (cold)
    const coldStart = performance.now();
    await configManager.loadConfig('local').catch(() => {
      // Ignore config errors for benchmark
    });
    const coldTime = performance.now() - coldStart;

    // Second load (cached)
    const warmStart = performance.now();
    await configManager.loadConfig('local').catch(() => {
      // Ignore config errors for benchmark
    });
    const warmTime = performance.now() - warmStart;

    console.log(`Cold Load:    ${coldTime.toFixed(2)}ms`);
    console.log(`Cached Load:  ${warmTime.toFixed(2)}ms`);
    console.log(`Speedup:      ${(coldTime / warmTime).toFixed(1)}x faster`);
  } catch (error) {
    console.log('Config loading benchmark skipped (no config file)');
  }

  // Docker API Caching Benchmark
  console.log('\n🐳 Docker API Caching Performance');
  console.log('-'.repeat(30));

  const dockerClient = new DockerClient();
  
  try {
    // First call (cold)
    const dockerColdStart = performance.now();
    await dockerClient.validateConnection();
    const dockerColdTime = performance.now() - dockerColdStart;

    // Second call (cached)
    const dockerWarmStart = performance.now();
    await dockerClient.validateConnection();
    const dockerWarmTime = performance.now() - dockerWarmStart;

    console.log(`Cold Call:    ${dockerColdTime.toFixed(2)}ms`);
    console.log(`Cached Call:  ${dockerWarmTime.toFixed(2)}ms`);
    console.log(`Speedup:      ${(dockerColdTime / dockerWarmTime).toFixed(1)}x faster`);
  } catch (error) {
    console.log('Docker API benchmark skipped (Docker not available)');
  }

  // Memory Usage Analysis
  console.log('\n💾 Memory Usage Analysis');
  console.log('-'.repeat(30));

  const initialMemory = getMemoryUsage();
  console.log(`Initial Memory: ${initialMemory.heapUsed}MB`);

  // Fill caches with test data
  for (let i = 0; i < 1000; i++) {
    configCache.set(`test-config-${i}`, { 
      version: '1.0.0', 
      data: new Array(50).fill(`data-${i}`) 
    });
    
    serviceStatusCache.set(`test-service-${i}`, {
      name: `service-${i}`,
      status: 'running',
      health: 'healthy',
      ports: [3000 + i]
    });

    dockerApiCache.set(`test-docker-${i}`, {
      containers: new Array(10).fill({ id: `container-${i}` })
    });
  }

  const peakMemory = getMemoryUsage();
  console.log(`Peak Memory:   ${peakMemory.heapUsed}MB (+${peakMemory.heapUsed - initialMemory.heapUsed}MB)`);

  // Clear caches
  configCache.clear();
  serviceStatusCache.clear();
  dockerApiCache.clear();

  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }

  const finalMemory = getMemoryUsage();
  console.log(`Final Memory:  ${finalMemory.heapUsed}MB`);

  // Performance Monitoring Summary
  console.log('\n📊 Performance Monitoring Summary');
  console.log('-'.repeat(30));

  // Add some sample metrics
  await performanceMonitor.timeAsync('sample-operation', async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
  });

  performanceMonitor.timeSync('sync-operation', () => {
    for (let i = 0; i < 1000; i++) {
      Math.sqrt(i);
    }
  });

  const stats = performanceMonitor.getStats();
  console.log(`Total Operations: ${stats.totalOperations}`);
  console.log(`Average Duration: ${stats.averageDuration.toFixed(2)}ms`);
  console.log(`Min Duration:     ${stats.minDuration.toFixed(2)}ms`);
  console.log(`Max Duration:     ${stats.maxDuration.toFixed(2)}ms`);

  // Cache Statistics
  console.log('\n📈 Cache Statistics');
  console.log('-'.repeat(30));

  const configStats = configCache.getStats();
  const serviceStats = serviceStatusCache.getStats();
  const dockerStats = dockerApiCache.getStats();

  console.log(`Config Cache:     ${configStats.size}/${configStats.maxSize} entries`);
  console.log(`Service Cache:    ${serviceStats.size}/${serviceStats.maxSize} entries`);
  console.log(`Docker API Cache: ${dockerStats.size}/${dockerStats.maxSize} entries`);

  // Recommendations
  console.log('\n💡 Performance Recommendations');
  console.log('-'.repeat(30));

  const recommendations = [];

  if (peakMemory.heapUsed > 200) {
    recommendations.push('Consider reducing cache sizes for memory-constrained environments');
  }

  if (stats.averageDuration > 100) {
    recommendations.push('Some operations are slow - consider additional optimizations');
  }

  if (configStats.size === 0 && serviceStats.size === 0) {
    recommendations.push('Caches are empty - ensure caching is being utilized');
  } else {
    recommendations.push('Caching is active and should improve performance');
  }

  if (recommendations.length === 0) {
    recommendations.push('Performance looks good! 🎉');
  }

  recommendations.forEach((rec, i) => {
    console.log(`${i + 1}. ${rec}`);
  });

  console.log('\n' + '='.repeat(50));
  console.log('✅ Benchmark completed successfully!');
}

// Run benchmarks if this file is executed directly
if (require.main === module) {
  runBenchmarks().catch(error => {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  });
}

export { runBenchmarks };