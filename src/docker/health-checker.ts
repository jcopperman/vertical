/**
 * Health checking system for Docker services
 */

import axios, { AxiosRequestConfig } from 'axios';
import { createLogger } from '../utils/logger';
import { ServiceInfo, ServiceEndpoint } from './types';

const logger = createLogger('health-checker');

export interface HealthCheckConfig {
  timeout: number;
  retries: number;
  retryDelay: number;
  healthCheckInterval: number;
  endpoints?: EndpointHealthCheck[];
}

export interface EndpointHealthCheck {
  name: string;
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'HEAD';
  expectedStatus?: number[];
  timeout?: number;
  headers?: Record<string, string>;
  body?: any;
}

export interface HealthCheckResult {
  service: string;
  healthy: boolean;
  checks: EndpointCheckResult[];
  timestamp: Date;
  duration: number;
}

export interface EndpointCheckResult {
  endpoint: string;
  healthy: boolean;
  status?: number;
  responseTime: number;
  error?: string;
}

export interface ServiceReadinessOptions {
  timeout?: number;
  checkInterval?: number;
  requiredServices?: string[];
  healthChecks?: Record<string, EndpointHealthCheck[]>;
}

export class HealthChecker {
  private config: HealthCheckConfig;

  constructor(config: Partial<HealthCheckConfig> = {}) {
    this.config = {
      timeout: 30000,
      retries: 3,
      retryDelay: 2000,
      healthCheckInterval: 5000,
      endpoints: [],
      ...config
    };

    logger.debug('HealthChecker initialized', { config: this.config });
  }

  /**
   * Check the health of a single service
   */
  async checkServiceHealth(service: ServiceInfo, healthChecks?: EndpointHealthCheck[]): Promise<HealthCheckResult> {
    const startTime = Date.now();
    logger.debug('Checking service health', { serviceName: service.name });

    const checks: EndpointCheckResult[] = [];
    
    // Use provided health checks or discover from service endpoints
    const checksToRun = healthChecks || this.discoverHealthChecks(service);
    
    for (const check of checksToRun) {
      const checkResult = await this.checkEndpoint(check);
      checks.push(checkResult);
    }

    const healthy = checks.length > 0 ? checks.every(check => check.healthy) : service.status === 'running';
    const duration = Date.now() - startTime;

    const result: HealthCheckResult = {
      service: service.name,
      healthy,
      checks,
      timestamp: new Date(),
      duration
    };

    logger.debug('Service health check completed', { 
      serviceName: service.name, 
      healthy, 
      checkCount: checks.length,
      duration 
    });

    return result;
  }

  /**
   * Check the health of multiple services
   */
  async checkServicesHealth(
    services: ServiceInfo[], 
    healthChecks?: Record<string, EndpointHealthCheck[]>
  ): Promise<HealthCheckResult[]> {
    logger.info('Checking health of multiple services', { serviceCount: services.length });

    const healthCheckPromises = services.map(service => {
      const serviceHealthChecks = healthChecks?.[service.name];
      return this.checkServiceHealth(service, serviceHealthChecks);
    });

    const results = await Promise.all(healthCheckPromises);
    
    const healthyCount = results.filter(r => r.healthy).length;
    logger.info('Multiple service health check completed', { 
      totalServices: services.length,
      healthyServices: healthyCount,
      unhealthyServices: services.length - healthyCount
    });

    return results;
  }

  /**
   * Wait for services to become ready
   */
  async waitForServicesReady(
    services: ServiceInfo[],
    options: ServiceReadinessOptions = {}
  ): Promise<boolean> {
    const {
      timeout = 120000, // 2 minutes default
      checkInterval = 5000, // 5 seconds default
      requiredServices,
      healthChecks
    } = options;

    const servicesToCheck = requiredServices 
      ? services.filter(s => requiredServices.includes(s.name))
      : services;

    if (servicesToCheck.length === 0) {
      logger.warn('No services to check for readiness');
      return true;
    }

    logger.info('Waiting for services to become ready', {
      services: servicesToCheck.map(s => s.name),
      timeout,
      checkInterval
    });

    const startTime = Date.now();
    let attempt = 0;

    while (Date.now() - startTime < timeout) {
      attempt++;
      logger.debug('Service readiness check attempt', { attempt, elapsed: Date.now() - startTime });

      try {
        const healthResults = await this.checkServicesHealth(servicesToCheck, healthChecks);
        const allHealthy = healthResults.every(result => result.healthy);

        if (allHealthy) {
          logger.info('All services are ready', { 
            attempt, 
            elapsed: Date.now() - startTime,
            services: servicesToCheck.map(s => s.name)
          });
          return true;
        }

        const unhealthyServices = healthResults
          .filter(result => !result.healthy)
          .map(result => result.service);

        logger.debug('Some services not yet ready', { 
          unhealthyServices,
          attempt,
          elapsed: Date.now() - startTime
        });

      } catch (error) {
        logger.debug('Error during readiness check', { 
          error: error instanceof Error ? error.message : 'Unknown error',
          attempt 
        });
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    logger.warn('Service readiness check timed out', { 
      timeout,
      attempts: attempt,
      services: servicesToCheck.map(s => s.name)
    });

    return false;
  }

  /**
   * Check a single endpoint
   */
  private async checkEndpoint(check: EndpointHealthCheck): Promise<EndpointCheckResult> {
    const startTime = Date.now();
    logger.debug('Checking endpoint', { endpoint: check.url, method: check.method || 'GET' });

    try {
      const config: AxiosRequestConfig = {
        method: check.method || 'GET',
        url: check.url,
        timeout: check.timeout || this.config.timeout,
        headers: check.headers || {},
        validateStatus: (status) => {
          const expectedStatuses = check.expectedStatus || [200, 201, 204];
          return expectedStatuses.includes(status);
        }
      };

      if (check.body && (check.method === 'POST' || check.method === 'PUT')) {
        config.data = check.body;
      }

      const response = await axios(config);
      const responseTime = Date.now() - startTime;

      logger.debug('Endpoint check successful', { 
        endpoint: check.url, 
        status: response.status,
        responseTime 
      });

      return {
        endpoint: check.url,
        healthy: true,
        status: response.status,
        responseTime
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.debug('Endpoint check failed', { 
        endpoint: check.url, 
        error: errorMessage,
        responseTime 
      });

      return {
        endpoint: check.url,
        healthy: false,
        responseTime,
        error: errorMessage
      };
    }
  }

  /**
   * Discover health checks from service endpoints
   */
  private discoverHealthChecks(service: ServiceInfo): EndpointHealthCheck[] {
    const healthChecks: EndpointHealthCheck[] = [];

    for (const endpoint of service.endpoints) {
      if (endpoint.protocol === 'http' || endpoint.protocol === 'https') {
        // Try common health check paths
        const healthPaths = ['/health', '/healthz', '/ping', '/status', '/ready'];
        
        for (const path of healthPaths) {
          healthChecks.push({
            name: `${endpoint.name}-${path}`,
            url: `${endpoint.url}${path}`,
            method: 'GET',
            expectedStatus: [200, 204],
            timeout: 10000 // 10 seconds for health checks
          });
        }

        // Also check the root endpoint
        healthChecks.push({
          name: `${endpoint.name}-root`,
          url: endpoint.url,
          method: 'GET',
          expectedStatus: [200, 201, 204, 404], // 404 is acceptable for root
          timeout: 10000
        });
      }
    }

    // If no HTTP endpoints found, create a basic TCP check
    if (healthChecks.length === 0 && service.endpoints.length > 0) {
      const firstEndpoint = service.endpoints[0];
      healthChecks.push({
        name: `${firstEndpoint.name}-tcp`,
        url: `http://localhost:${firstEndpoint.port}`,
        method: 'GET',
        expectedStatus: [200, 201, 204, 404, 503], // Be lenient for TCP checks
        timeout: 5000
      });
    }

    logger.debug('Discovered health checks for service', { 
      serviceName: service.name,
      healthCheckCount: healthChecks.length 
    });

    return healthChecks;
  }

  /**
   * Create a health check with retry logic
   */
  async checkWithRetry(check: EndpointHealthCheck): Promise<EndpointCheckResult> {
    let lastResult: EndpointCheckResult | null = null;

    for (let attempt = 1; attempt <= this.config.retries; attempt++) {
      logger.debug('Health check attempt', { 
        endpoint: check.url, 
        attempt, 
        maxRetries: this.config.retries 
      });

      lastResult = await this.checkEndpoint(check);

      if (lastResult.healthy) {
        return lastResult;
      }

      // Wait before retry (except on last attempt)
      if (attempt < this.config.retries) {
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
      }
    }

    logger.debug('Health check failed after all retries', { 
      endpoint: check.url, 
      retries: this.config.retries 
    });

    return lastResult!;
  }

  /**
   * Start continuous health monitoring
   */
  startMonitoring(
    services: ServiceInfo[],
    healthChecks?: Record<string, EndpointHealthCheck[]>,
    onHealthChange?: (results: HealthCheckResult[]) => void
  ): () => void {
    logger.info('Starting continuous health monitoring', { 
      serviceCount: services.length,
      interval: this.config.healthCheckInterval 
    });

    let isMonitoring = true;
    let previousResults: HealthCheckResult[] = [];

    const monitor = async () => {
      if (!isMonitoring) return;

      try {
        const results = await this.checkServicesHealth(services, healthChecks);
        
        // Check if health status changed
        const hasChanged = this.hasHealthStatusChanged(previousResults, results);
        
        if (hasChanged && onHealthChange) {
          onHealthChange(results);
        }

        previousResults = results;
      } catch (error) {
        logger.error('Error during health monitoring', { 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }

      // Schedule next check
      if (isMonitoring) {
        setTimeout(monitor, this.config.healthCheckInterval);
      }
    };

    // Start monitoring
    monitor();

    // Return stop function
    return () => {
      logger.info('Stopping health monitoring');
      isMonitoring = false;
    };
  }

  /**
   * Check if health status has changed between two result sets
   */
  private hasHealthStatusChanged(
    previous: HealthCheckResult[], 
    current: HealthCheckResult[]
  ): boolean {
    if (previous.length !== current.length) return true;

    for (let i = 0; i < current.length; i++) {
      const prev = previous.find(p => p.service === current[i].service);
      if (!prev || prev.healthy !== current[i].healthy) {
        return true;
      }
    }

    return false;
  }
}