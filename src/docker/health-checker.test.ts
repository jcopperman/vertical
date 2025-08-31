/**
 * Tests for health checking system
 */

import { HealthChecker, HealthCheckConfig, EndpointHealthCheck } from './health-checker';
import { ServiceInfo } from './types';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.MockedFunction<typeof axios>;

describe('HealthChecker', () => {
  let healthChecker: HealthChecker;
  
  const mockServiceInfo: ServiceInfo = {
    name: 'web',
    containers: [],
    status: 'running',
    health: 'healthy',
    endpoints: [
      {
        name: 'web-http',
        url: 'http://localhost:8080',
        port: 8080,
        protocol: 'http'
      }
    ]
  };

  beforeEach(() => {
    jest.clearAllMocks();
    healthChecker = new HealthChecker();
  });

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      const checker = new HealthChecker();
      expect(checker).toBeDefined();
    });

    it('should initialize with custom configuration', () => {
      const config: Partial<HealthCheckConfig> = {
        timeout: 60000,
        retries: 5,
        retryDelay: 3000
      };
      
      const checker = new HealthChecker(config);
      expect(checker).toBeDefined();
    });
  });

  describe('checkServiceHealth', () => {
    it('should check service health successfully', async () => {
      mockedAxios.mockResolvedValue({
        status: 200,
        data: { status: 'ok' }
      });

      const result = await healthChecker.checkServiceHealth(mockServiceInfo);

      expect(result.service).toBe('web');
      expect(result.healthy).toBe(true);
      expect(result.checks.length).toBeGreaterThan(0);
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should handle service health check failure', async () => {
      mockedAxios.mockRejectedValue(new Error('Connection refused'));

      const result = await healthChecker.checkServiceHealth(mockServiceInfo);

      expect(result.service).toBe('web');
      expect(result.healthy).toBe(false);
      expect(result.checks.length).toBeGreaterThan(0);
      expect(result.checks[0].healthy).toBe(false);
      expect(result.checks[0].error).toContain('Connection refused');
    });

    it('should use custom health checks when provided', async () => {
      const customHealthChecks: EndpointHealthCheck[] = [
        {
          name: 'custom-health',
          url: 'http://localhost:8080/api/health',
          method: 'GET',
          expectedStatus: [200]
        }
      ];

      mockedAxios.mockResolvedValue({
        status: 200,
        data: { healthy: true }
      });

      const result = await healthChecker.checkServiceHealth(mockServiceInfo, customHealthChecks);

      expect(result.checks).toHaveLength(1);
      expect(result.checks[0].endpoint).toBe('http://localhost:8080/api/health');
      expect(mockedAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: 'http://localhost:8080/api/health'
        })
      );
    });

    it('should handle service with no endpoints', async () => {
      const serviceWithoutEndpoints: ServiceInfo = {
        ...mockServiceInfo,
        endpoints: []
      };

      const result = await healthChecker.checkServiceHealth(serviceWithoutEndpoints);

      expect(result.service).toBe('web');
      expect(result.healthy).toBe(true); // Should fall back to container status
      expect(result.checks).toHaveLength(0);
    });
  });

  describe('checkServicesHealth', () => {
    it('should check health of multiple services', async () => {
      const services: ServiceInfo[] = [
        mockServiceInfo,
        {
          ...mockServiceInfo,
          name: 'db',
          endpoints: [
            {
              name: 'db-tcp',
              url: 'http://localhost:5432',
              port: 5432,
              protocol: 'tcp'
            }
          ]
        }
      ];

      mockedAxios.mockResolvedValue({
        status: 200,
        data: {}
      });

      const results = await healthChecker.checkServicesHealth(services);

      expect(results).toHaveLength(2);
      expect(results[0].service).toBe('web');
      expect(results[1].service).toBe('db');
    });

    it('should use service-specific health checks', async () => {
      const services: ServiceInfo[] = [mockServiceInfo];
      const healthChecks = {
        web: [
          {
            name: 'web-api',
            url: 'http://localhost:8080/api/status',
            method: 'GET' as const,
            expectedStatus: [200]
          }
        ]
      };

      mockedAxios.mockResolvedValue({
        status: 200,
        data: { status: 'healthy' }
      });

      const results = await healthChecker.checkServicesHealth(services, healthChecks);

      expect(results).toHaveLength(1);
      expect(results[0].checks).toHaveLength(1);
      expect(results[0].checks[0].endpoint).toBe('http://localhost:8080/api/status');
    });
  });

  describe('waitForServicesReady', () => {
    it('should return true when all services are healthy', async () => {
      mockedAxios.mockResolvedValue({
        status: 200,
        data: {}
      });

      const result = await healthChecker.waitForServicesReady([mockServiceInfo], {
        timeout: 5000,
        checkInterval: 1000
      });

      expect(result).toBe(true);
    });

    it('should return false when timeout is reached', async () => {
      mockedAxios.mockRejectedValue(new Error('Service unavailable'));

      const result = await healthChecker.waitForServicesReady([mockServiceInfo], {
        timeout: 2000,
        checkInterval: 500
      });

      expect(result).toBe(false);
    }, 10000);

    it('should only check required services when specified', async () => {
      const services: ServiceInfo[] = [
        mockServiceInfo,
        { ...mockServiceInfo, name: 'db' },
        { ...mockServiceInfo, name: 'cache' }
      ];

      mockedAxios.mockResolvedValue({
        status: 200,
        data: {}
      });

      const result = await healthChecker.waitForServicesReady(services, {
        requiredServices: ['web', 'db'],
        timeout: 5000,
        checkInterval: 1000
      });

      expect(result).toBe(true);
    });

    it('should return true immediately when no services to check', async () => {
      const result = await healthChecker.waitForServicesReady([], {
        timeout: 5000
      });

      expect(result).toBe(true);
    });
  });

  describe('checkWithRetry', () => {
    it('should succeed on first attempt', async () => {
      const healthCheck: EndpointHealthCheck = {
        name: 'test-check',
        url: 'http://localhost:8080/health',
        method: 'GET'
      };

      mockedAxios.mockResolvedValue({
        status: 200,
        data: {}
      });

      const result = await healthChecker.checkWithRetry(healthCheck);

      expect(result.healthy).toBe(true);
      expect(result.endpoint).toBe('http://localhost:8080/health');
      expect(mockedAxios).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const healthCheck: EndpointHealthCheck = {
        name: 'test-check',
        url: 'http://localhost:8080/health',
        method: 'GET'
      };

      // Fail first two attempts, succeed on third
      mockedAxios
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce({
          status: 200,
          data: {}
        });

      const checker = new HealthChecker({ retries: 3, retryDelay: 100 });
      const result = await checker.checkWithRetry(healthCheck);

      expect(result.healthy).toBe(true);
      expect(mockedAxios).toHaveBeenCalledTimes(3);
    });

    it('should fail after all retries exhausted', async () => {
      const healthCheck: EndpointHealthCheck = {
        name: 'test-check',
        url: 'http://localhost:8080/health',
        method: 'GET'
      };

      mockedAxios.mockRejectedValue(new Error('Service unavailable'));

      const checker = new HealthChecker({ retries: 2, retryDelay: 100 });
      const result = await checker.checkWithRetry(healthCheck);

      expect(result.healthy).toBe(false);
      expect(result.error).toContain('Service unavailable');
      expect(mockedAxios).toHaveBeenCalledTimes(2);
    });
  });

  describe('startMonitoring', () => {
    it('should start and stop monitoring', async () => {
      mockedAxios.mockResolvedValue({
        status: 200,
        data: {}
      });

      const onHealthChange = jest.fn();
      const stopMonitoring = healthChecker.startMonitoring(
        [mockServiceInfo],
        undefined,
        onHealthChange
      );

      // Let it run for a short time
      await new Promise(resolve => setTimeout(resolve, 100));

      stopMonitoring();

      expect(stopMonitoring).toBeInstanceOf(Function);
    });

    it('should call onHealthChange when health status changes', async () => {
      let callCount = 0;
      mockedAxios.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ status: 200, data: {} });
        } else {
          return Promise.reject(new Error('Service down'));
        }
      });

      const onHealthChange = jest.fn();
      const checker = new HealthChecker({ healthCheckInterval: 100 });
      
      const stopMonitoring = checker.startMonitoring(
        [mockServiceInfo],
        undefined,
        onHealthChange
      );

      // Wait for a couple of health checks
      await new Promise(resolve => setTimeout(resolve, 250));

      stopMonitoring();

      expect(onHealthChange).toHaveBeenCalled();
    });
  });

  describe('endpoint checking', () => {
    it('should handle different HTTP methods', async () => {
      const healthCheck: EndpointHealthCheck = {
        name: 'post-check',
        url: 'http://localhost:8080/api/health',
        method: 'POST',
        body: { check: 'health' },
        headers: { 'Content-Type': 'application/json' }
      };

      mockedAxios.mockResolvedValue({
        status: 201,
        data: { status: 'ok' }
      });

      const result = await healthChecker.checkWithRetry(healthCheck);

      expect(result.healthy).toBe(true);
      expect(mockedAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: 'http://localhost:8080/api/health',
          data: { check: 'health' },
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    it('should validate expected status codes', async () => {
      const healthCheck: EndpointHealthCheck = {
        name: 'status-check',
        url: 'http://localhost:8080/health',
        method: 'GET',
        expectedStatus: [200, 204]
      };

      mockedAxios.mockResolvedValue({
        status: 204,
        data: ''
      });

      const result = await healthChecker.checkWithRetry(healthCheck);

      expect(result.healthy).toBe(true);
      expect(result.status).toBe(204);
    });

    it('should handle timeout configuration', async () => {
      const healthCheck: EndpointHealthCheck = {
        name: 'timeout-check',
        url: 'http://localhost:8080/slow',
        method: 'GET',
        timeout: 1000
      };

      mockedAxios.mockResolvedValue({
        status: 200,
        data: {}
      });

      await healthChecker.checkWithRetry(healthCheck);

      expect(mockedAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 1000
        })
      );
    });
  });
});