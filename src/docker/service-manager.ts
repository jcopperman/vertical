/**
 * Docker service management utilities
 */

import { DockerClient } from './client';
import { createLogger } from '../utils/logger';

const logger = createLogger('service-manager');
import {
  ServiceInfo,
  ContainerInfo,
  DockerClientConfig,
  DockerClientOptions
} from './types';

export interface ServiceManagerConfig {
  projectName?: string;
  timeout?: number;
  retries?: number;
}

export interface ServiceOperation {
  service: string;
  operation: 'start' | 'stop' | 'restart' | 'remove';
  success: boolean;
  error?: string;
}

export interface ServiceOperationResult {
  success: boolean;
  operations: ServiceOperation[];
  errors: string[];
}

export class ServiceManager {
  private dockerClient: DockerClient;
  private config: ServiceManagerConfig;

  constructor(
    dockerConfig: DockerClientConfig = {},
    dockerOptions: DockerClientOptions = {},
    config: ServiceManagerConfig = {}
  ) {
    this.dockerClient = new DockerClient(dockerConfig, dockerOptions);
    this.config = {
      timeout: 30000,
      retries: 3,
      ...config
    };

    logger.debug('ServiceManager initialized', { config: this.config });
  }

  /**
   * Get all services for the configured project
   */
  async getServices(): Promise<ServiceInfo[]> {
    try {
      logger.debug('Getting services', { projectName: this.config.projectName });
      
      const services = await this.dockerClient.getServices(this.config.projectName);
      
      logger.debug(`Found ${services.length} services`);
      return services;
    } catch (error) {
      logger.error('Failed to get services', { error });
      throw new Error(`Failed to get services: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get a specific service by name
   */
  async getService(serviceName: string): Promise<ServiceInfo | null> {
    try {
      logger.debug('Getting service', { serviceName, projectName: this.config.projectName });
      
      const services = await this.getServices();
      const service = services.find(s => s.name === serviceName);
      
      if (service) {
        logger.debug('Service found', { serviceName, containerCount: service.containers.length });
      } else {
        logger.debug('Service not found', { serviceName });
      }
      
      return service || null;
    } catch (error) {
      logger.error('Failed to get service', { serviceName, error });
      throw new Error(`Failed to get service: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Start all containers for a service
   */
  async startService(serviceName: string): Promise<ServiceOperation> {
    try {
      logger.info('Starting service', { serviceName });
      
      const service = await this.getService(serviceName);
      if (!service) {
        throw new Error(`Service '${serviceName}' not found`);
      }

      const stoppedContainers = service.containers.filter(c => c.state !== 'running');
      
      for (const container of stoppedContainers) {
        await this.dockerClient.startContainer(container.id);
      }

      logger.info('Service started successfully', { serviceName, containerCount: stoppedContainers.length });
      
      return {
        service: serviceName,
        operation: 'start',
        success: true
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to start service', { serviceName, error: errorMessage });
      
      return {
        service: serviceName,
        operation: 'start',
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Stop all containers for a service
   */
  async stopService(serviceName: string, timeout: number = 10): Promise<ServiceOperation> {
    try {
      logger.info('Stopping service', { serviceName, timeout });
      
      const service = await this.getService(serviceName);
      if (!service) {
        throw new Error(`Service '${serviceName}' not found`);
      }

      const runningContainers = service.containers.filter(c => c.state === 'running');
      
      for (const container of runningContainers) {
        await this.dockerClient.stopContainer(container.id, timeout);
      }

      logger.info('Service stopped successfully', { serviceName, containerCount: runningContainers.length });
      
      return {
        service: serviceName,
        operation: 'stop',
        success: true
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to stop service', { serviceName, error: errorMessage });
      
      return {
        service: serviceName,
        operation: 'stop',
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Restart all containers for a service
   */
  async restartService(serviceName: string, timeout: number = 10): Promise<ServiceOperation> {
    try {
      logger.info('Restarting service', { serviceName, timeout });
      
      const stopResult = await this.stopService(serviceName, timeout);
      if (!stopResult.success) {
        return {
          service: serviceName,
          operation: 'restart',
          success: false,
          error: `Failed to stop service: ${stopResult.error}`
        };
      }

      // Wait a moment before starting
      await new Promise(resolve => setTimeout(resolve, 1000));

      const startResult = await this.startService(serviceName);
      if (!startResult.success) {
        return {
          service: serviceName,
          operation: 'restart',
          success: false,
          error: `Failed to start service: ${startResult.error}`
        };
      }

      logger.info('Service restarted successfully', { serviceName });
      
      return {
        service: serviceName,
        operation: 'restart',
        success: true
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to restart service', { serviceName, error: errorMessage });
      
      return {
        service: serviceName,
        operation: 'restart',
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Remove all containers for a service
   */
  async removeService(serviceName: string, force: boolean = false): Promise<ServiceOperation> {
    try {
      logger.info('Removing service', { serviceName, force });
      
      const service = await this.getService(serviceName);
      if (!service) {
        throw new Error(`Service '${serviceName}' not found`);
      }

      // Stop running containers first if not forcing
      if (!force) {
        const runningContainers = service.containers.filter(c => c.state === 'running');
        for (const container of runningContainers) {
          await this.dockerClient.stopContainer(container.id);
        }
      }

      // Remove all containers
      for (const container of service.containers) {
        await this.dockerClient.removeContainer(container.id, force);
      }

      logger.info('Service removed successfully', { serviceName, containerCount: service.containers.length });
      
      return {
        service: serviceName,
        operation: 'remove',
        success: true
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to remove service', { serviceName, error: errorMessage });
      
      return {
        service: serviceName,
        operation: 'remove',
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Start multiple services
   */
  async startServices(serviceNames: string[]): Promise<ServiceOperationResult> {
    logger.info('Starting multiple services', { serviceNames });
    
    const operations: ServiceOperation[] = [];
    const errors: string[] = [];

    for (const serviceName of serviceNames) {
      const result = await this.startService(serviceName);
      operations.push(result);
      
      if (!result.success && result.error) {
        errors.push(`${serviceName}: ${result.error}`);
      }
    }

    const success = operations.every(op => op.success);
    
    logger.info('Multiple service start completed', { 
      success, 
      successCount: operations.filter(op => op.success).length,
      totalCount: operations.length 
    });

    return {
      success,
      operations,
      errors
    };
  }

  /**
   * Stop multiple services
   */
  async stopServices(serviceNames: string[], timeout: number = 10): Promise<ServiceOperationResult> {
    logger.info('Stopping multiple services', { serviceNames, timeout });
    
    const operations: ServiceOperation[] = [];
    const errors: string[] = [];

    for (const serviceName of serviceNames) {
      const result = await this.stopService(serviceName, timeout);
      operations.push(result);
      
      if (!result.success && result.error) {
        errors.push(`${serviceName}: ${result.error}`);
      }
    }

    const success = operations.every(op => op.success);
    
    logger.info('Multiple service stop completed', { 
      success, 
      successCount: operations.filter(op => op.success).length,
      totalCount: operations.length 
    });

    return {
      success,
      operations,
      errors
    };
  }

  /**
   * Get service logs
   */
  async getServiceLogs(serviceName: string, tail: number = 100): Promise<Record<string, string>> {
    try {
      logger.debug('Getting service logs', { serviceName, tail });
      
      const service = await this.getService(serviceName);
      if (!service) {
        throw new Error(`Service '${serviceName}' not found`);
      }

      const logs: Record<string, string> = {};
      
      for (const container of service.containers) {
        try {
          logs[container.name] = await this.dockerClient.getContainerLogs(container.id, tail);
        } catch (error) {
          logs[container.name] = `Error getting logs: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }

      logger.debug('Service logs retrieved', { serviceName, containerCount: Object.keys(logs).length });
      return logs;
    } catch (error) {
      logger.error('Failed to get service logs', { serviceName, error });
      throw new Error(`Failed to get service logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Wait for service to be healthy
   */
  async waitForServiceHealth(
    serviceName: string, 
    timeout: number = 60000,
    checkInterval: number = 2000
  ): Promise<boolean> {
    logger.debug('Waiting for service health', { serviceName, timeout, checkInterval });
    
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const service = await this.getService(serviceName);
        
        if (service && service.health === 'healthy') {
          logger.info('Service is healthy', { serviceName, elapsed: Date.now() - startTime });
          return true;
        }
        
        logger.debug('Service not yet healthy, waiting...', { 
          serviceName, 
          currentHealth: service?.health || 'unknown',
          elapsed: Date.now() - startTime 
        });
        
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      } catch (error) {
        logger.debug('Error checking service health, retrying...', { serviceName, error });
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
    }
    
    logger.warn('Service health check timed out', { serviceName, timeout });
    return false;
  }

  /**
   * Validate Docker connectivity
   */
  async validateDockerConnection() {
    return this.dockerClient.validateConnection();
  }
}