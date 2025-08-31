/**
 * Performance optimization integration tests
 */

import { DefaultConfigurationManager } from '../config/manager';
import { DockerClient } from '../docker/client';
import { StatusCommand } from '../commands/status';
import { configCache, serviceStatusCache, dockerApiCache } from './cache';
import { performanceMonitor } from './performance';
import path from 'path';
import fs from 'fs';

describe('Performance Optimization Integration', () => {
  let tempDir: string;
  let configManager: DefaultConfigurationManager;

  beforeAll(async () => {
    // Create temporary directory for test config
    tempDir = path.join(__dirname, '../../test-temp');
    await fs.promises.mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    // Clean up temporary directory
    await fs.promises.rmdir(tempDir, { recursive: true });
  });

  beforeEach(() => {
    configManager = new DefaultConfigurationManager(tempDir);
    
    // Clear all caches
    configCache.clear();
    serviceStatusCache.clear();
    dockerApiCache.clear();
    performanceMonitor.clearMetrics();
  });

  describe('Configuration Loading Performance', () => {
    beforeEach(async () => {
      // Create test configuration file
      const configPath = path.join(tempDir, 'otp.config.js');
      const configContent = `
        module.exports = {
          version: '1.0.0',
          profile: 'local',
          infrastructure: {
            compose: {
              baseFile: 'docker-compose.yml',
              profileFiles: {
                local: 'docker-compose.local.yml',
                ci: 'docker-compose.ci.yml',
                k8s: 'docker-compose.k8s.yml'
              },
              projectName: 'otp-test'
            },
            services: [],
            healthChecks: {
              timeout: 60,
              retries: 5,
              interval: 5
            }
          },
          runners: {},
          reporting: {
            grafana: {
              url: 'http://localhost:3000',
              dashboards: []
            },
            resultsApi: {
              url: 'http://localhost:8080/api',
              timeout: 30
            }
          },
          fixtures: {
            defaultSet: 'basic',
            sets: {}
          }
        };
      `;
      
      await fs.promises.writeFile(configPath, configContent);
    });

    it('should cache configuration loading', async () => {
      // First load - should hit file system
      const startTime1 = performance.now();
      const config1 = await configManager.loadConfig('local');
      const duration1 = performance.now() - startTime1;

      expect(config1.version).toBe('1.0.0');
      expect(config1.profile).toBe('local');

      // Second load - should use cache
      const startTime2 = performance.now();
      const config2 = await configManager.loadConfig('local');
      const duration2 = performance.now() - startTime2;

      expect(config2).toEqual(config1);
      
      // Cached load should be significantly faster
      expect(duration2).toBeLessThan(duration1 * 0.5);
      
      console.log(`First load: ${duration1.toFixed(2)}ms, Cached load: ${duration2.toFixed(2)}ms`);
    });

    it('should invalidate cache when needed', async () => {
      // Load configuration
      await configManager.loadConfig('local');
      
      // Verify it's cached
      const cacheStats = configCache.getStats();
      expect(cacheStats.size).toBeGreaterThan(0);
      
      // Invalidate cache
      configManager.invalidateCache();
      
      // Cache should be cleared for this config
      const cachedConfig = configCache.get(`config:local:${tempDir}`);
      expect(cachedConfig).toBeUndefined();
    });

    it('should handle multiple profiles efficiently', async () => {
      const profiles = ['local', 'ci', 'k8s'];
      const loadTimes: number[] = [];

      for (const profile of profiles) {
        const startTime = performance.now();
        await configManager.loadConfig(profile);
        const duration = performance.now() - startTime;
        loadTimes.push(duration);
      }

      // Each profile should be cached separately
      const cacheStats = configCache.getStats();
      expect(cacheStats.size).toBe(profiles.length);

      console.log('Profile load times:', loadTimes.map((t, i) => `${profiles[i]}: ${t.toFixed(2)}ms`));
    });
  });

  describe('Docker Client Performance', () => {
    let dockerClient: DockerClient;

    beforeEach(() => {
      dockerClient = new DockerClient();
    });

    it('should cache Docker API calls', async () => {
      // Mock Docker API to avoid actual Docker dependency
      const originalValidateConnection = dockerClient.validateConnection;
      let callCount = 0;
      
      dockerClient.validateConnection = jest.fn().mockImplementation(async () => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 10)); // Simulate API delay
        return {
          connected: true,
          version: '20.10.0',
          apiVersion: '1.41'
        };
      });

      // First call
      const startTime1 = performance.now();
      const result1 = await dockerClient.validateConnection();
      const duration1 = performance.now() - startTime1;

      expect(result1.connected).toBe(true);
      expect(callCount).toBe(1);

      // Second call - should use cache
      const startTime2 = performance.now();
      const result2 = await dockerClient.validateConnection();
      const duration2 = performance.now() - startTime2;

      expect(result2).toEqual(result1);
      expect(callCount).toBe(1); // Should not increment due to caching
      expect(duration2).toBeLessThan(duration1 * 0.5);

      console.log(`Docker API - First call: ${duration1.toFixed(2)}ms, Cached call: ${duration2.toFixed(2)}ms`);
    });

    it('should cache container listings', async () => {
      // Mock listContainers method
      let callCount = 0;
      
      dockerClient.listContainers = jest.fn().mockImplementation(async () => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 15)); // Simulate API delay
        return [
          {
            id: 'container1',
            name: 'test-container',
            image: 'nginx:latest',
            status: 'running' as const,
            state: 'running' as const,
            ports: [],
            labels: {},
            created: new Date()
          }
        ];
      });

      // First call
      const containers1 = await dockerClient.listContainers();
      expect(containers1).toHaveLength(1);
      expect(callCount).toBe(1);

      // Second call - should use cache
      const containers2 = await dockerClient.listContainers();
      expect(containers2).toEqual(containers1);
      expect(callCount).toBe(1); // Should not increment due to caching
    });

    it('should invalidate Docker cache', async () => {
      // Add some data to Docker cache
      dockerApiCache.set('test-key', { data: 'test' });
      expect(dockerApiCache.has('test-key')).toBe(true);

      // Invalidate cache
      dockerClient.invalidateCache();

      // Cache should be cleared
      expect(dockerApiCache.has('test-key')).toBe(false);
    });
  });

  describe('Status Command Performance', () => {
    let statusCommand: StatusCommand;

    beforeEach(() => {
      statusCommand = new StatusCommand();
    });

    it('should cache service status checks', async () => {
      // Mock the private getServiceStatus method
      const originalGetServiceStatus = (statusCommand as any).getServiceStatus;
      let callCount = 0;

      (statusCommand as any).getServiceStatus = jest.fn().mockImplementation(async (serviceName: string) => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 5)); // Simulate check delay
        return {
          name: serviceName,
          status: 'running' as const,
          health: 'healthy' as const,
          ports: [3000],
          lastCheck: new Date()
        };
      });

      // First status check
      const startTime1 = performance.now();
      const result1 = await statusCommand.execute({}, { verbose: false, logger: console });
      const duration1 = performance.now() - startTime1;

      expect(result1.success).toBe(true);
      expect(callCount).toBeGreaterThan(0);

      const initialCallCount = callCount;

      // Second status check - should use cached results
      const startTime2 = performance.now();
      const result2 = await statusCommand.execute({}, { verbose: false, logger: console });
      const duration2 = performance.now() - startTime2;

      expect(result2.success).toBe(true);
      expect(callCount).toBe(initialCallCount); // Should not increment due to caching
      expect(duration2).toBeLessThan(duration1 * 0.5);

      console.log(`Status check - First: ${duration1.toFixed(2)}ms, Cached: ${duration2.toFixed(2)}ms`);
    });
  });

  describe('Performance Monitoring', () => {
    it('should track performance metrics across operations', async () => {
      // Simulate various operations
      await performanceMonitor.timeAsync('config-load', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      await performanceMonitor.timeAsync('docker-api', async () => {
        await new Promise(resolve => setTimeout(resolve, 15));
      });

      performanceMonitor.timeSync('validation', () => {
        // Simulate sync operation
        for (let i = 0; i < 1000; i++) {
          Math.sqrt(i);
        }
      });

      // Get overall statistics
      const allStats = performanceMonitor.getStats();
      expect(allStats.totalOperations).toBe(3);

      // Get operation-specific statistics
      const configStats = performanceMonitor.getStats('config-load');
      expect(configStats.totalOperations).toBe(1);
      expect(configStats.averageDuration).toBeGreaterThan(0);

      // Generate performance report
      const report = performanceMonitor.getReport();
      expect(report).toContain('Performance Report');
      expect(report).toContain('config-load');
      expect(report).toContain('docker-api');
      expect(report).toContain('validation');

      console.log('Performance Report:');
      console.log(report);
    });

    it('should handle concurrent performance tracking', async () => {
      const operations = Array.from({ length: 10 }, (_, i) => 
        performanceMonitor.timeAsync(`concurrent-op-${i}`, async () => {
          await new Promise(resolve => setTimeout(resolve, Math.random() * 20));
        })
      );

      await Promise.all(operations);

      const stats = performanceMonitor.getStats();
      expect(stats.totalOperations).toBe(10);
    });
  });

  describe('Memory Usage Optimization', () => {
    it('should maintain reasonable memory usage with caching', () => {
      const initialMemory = process.memoryUsage();

      // Fill caches with data
      for (let i = 0; i < 1000; i++) {
        configCache.set(`config-${i}`, { 
          version: '1.0.0', 
          data: new Array(100).fill(`data-${i}`) 
        });
        
        serviceStatusCache.set(`service-${i}`, {
          name: `service-${i}`,
          status: 'running',
          health: 'healthy',
          ports: [3000 + i]
        });
      }

      const peakMemory = process.memoryUsage();

      // Clear caches
      configCache.clear();
      serviceStatusCache.clear();

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage();

      console.log('Memory usage:');
      console.log(`Initial: ${Math.round(initialMemory.heapUsed / 1024 / 1024)}MB`);
      console.log(`Peak: ${Math.round(peakMemory.heapUsed / 1024 / 1024)}MB`);
      console.log(`Final: ${Math.round(finalMemory.heapUsed / 1024 / 1024)}MB`);

      // Memory should be released after clearing caches
      expect(finalMemory.heapUsed).toBeLessThan(peakMemory.heapUsed * 1.1);
    });
  });

  describe('Startup Time Optimization', () => {
    it('should have fast CLI initialization', async () => {
      const startTime = performance.now();

      // Simulate CLI initialization
      const configManager = new DefaultConfigurationManager(tempDir);
      const dockerClient = new DockerClient();
      const statusCommand = new StatusCommand();

      // Basic operations that would happen during startup
      await dockerClient.validateConnection().catch(() => {
        // Ignore connection errors in test
      });

      const duration = performance.now() - startTime;

      console.log(`CLI initialization time: ${duration.toFixed(2)}ms`);

      // Should initialize quickly (adjust threshold as needed)
      expect(duration).toBeLessThan(500);
    });
  });
});