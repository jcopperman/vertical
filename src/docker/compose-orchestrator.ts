/**
 * Docker Compose orchestrator for managing OTP infrastructure
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import * as path from 'path';
import * as fs from 'fs/promises';
import { createLogger } from '../utils/logger';
import { ServiceManager } from './service-manager';
import { DockerClient } from './client';
import { HealthChecker, EndpointHealthCheck, ServiceReadinessOptions } from './health-checker';
import {
  ServiceInfo,
  DockerClientConfig,
  DockerClientOptions
} from './types';

const logger = createLogger('compose-orchestrator');

export interface ComposeConfig {
  projectName: string;
  baseComposeFile: string;
  profileComposeFiles?: Record<string, string>;
  workingDirectory?: string;
  environment?: Record<string, string>;
}

export interface DeploymentOptions {
  profile?: string;
  detached?: boolean;
  build?: boolean;
  pullImages?: boolean;
  timeout?: number;
  services?: string[];
  waitForHealthy?: boolean;
  healthCheckTimeout?: number;
  healthChecks?: Record<string, EndpointHealthCheck[]>;
}

export interface DeploymentResult {
  success: boolean;
  services: ServiceInfo[];
  deploymentTime: number;
  errors: string[];
  warnings: string[];
}

export interface ComposeStatus {
  projectName: string;
  isRunning: boolean;
  services: ServiceInfo[];
  composeFiles: string[];
  profile?: string;
}

export class DockerComposeOrchestrator {
  private config: ComposeConfig;
  private serviceManager: ServiceManager;
  private dockerClient: DockerClient;
  private healthChecker: HealthChecker;

  constructor(
    config: ComposeConfig,
    dockerConfig: DockerClientConfig = {},
    dockerOptions: DockerClientOptions = {}
  ) {
    this.config = {
      workingDirectory: process.cwd(),
      environment: {},
      ...config
    };

    this.dockerClient = new DockerClient(dockerConfig, dockerOptions);
    this.serviceManager = new ServiceManager(
      dockerConfig,
      dockerOptions,
      { projectName: this.config.projectName }
    );
    this.healthChecker = new HealthChecker();

    logger.debug('DockerComposeOrchestrator initialized', { config: this.config });
  }

  /**
   * Deploy the Docker Compose stack
   */
  async deploy(options: DeploymentOptions = {}): Promise<DeploymentResult> {
    const startTime = Date.now();
    logger.info('Starting Docker Compose deployment', { options });

    try {
      // Validate Docker connectivity
      const connectionStatus = await this.dockerClient.validateConnection();
      if (!connectionStatus.connected) {
        throw new Error(`Docker is not available: ${connectionStatus.error}`);
      }

      // Build compose command arguments
      const composeFiles = await this.resolveComposeFiles(options.profile);
      const composeArgs = this.buildComposeArgs(composeFiles, options);

      // Execute docker-compose up
      logger.debug('Executing docker-compose up', { composeArgs });
      
      const result = await execAsync(`docker-compose ${composeArgs.join(' ')}`, {
        cwd: this.config.workingDirectory,
        env: {
          ...process.env,
          ...this.config.environment
        },
        timeout: options.timeout || 300000 // 5 minutes default
      });

      logger.debug('Docker Compose deployment completed', { 
        stdout: result.stdout.substring(0, 500) // Log first 500 chars
      });

      // Get deployed services status
      const services = await this.serviceManager.getServices();
      
      // Wait for services to be healthy if requested
      if (options.waitForHealthy) {
        logger.info('Waiting for services to become healthy');
        
        const readinessOptions: ServiceReadinessOptions = {
          timeout: options.healthCheckTimeout || 120000,
          healthChecks: options.healthChecks
        };
        
        const isReady = await this.healthChecker.waitForServicesReady(services, readinessOptions);
        
        if (!isReady) {
          logger.warn('Services did not become healthy within timeout');
          return {
            success: false,
            services,
            deploymentTime: Date.now() - startTime,
            errors: ['Services did not become healthy within the specified timeout'],
            warnings: this.parseWarnings(result.stdout)
          };
        }
        
        logger.info('All services are healthy');
      }

      const deploymentTime = Date.now() - startTime;

      const deploymentResult: DeploymentResult = {
        success: true,
        services,
        deploymentTime,
        errors: [],
        warnings: this.parseWarnings(result.stdout)
      };

      logger.info('Docker Compose deployment successful', {
        serviceCount: services.length,
        deploymentTime
      });

      return deploymentResult;
    } catch (error) {
      const deploymentTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error('Docker Compose deployment failed', { error: errorMessage, deploymentTime });

      return {
        success: false,
        services: [],
        deploymentTime,
        errors: [errorMessage],
        warnings: []
      };
    }
  }

  /**
   * Stop and remove the Docker Compose stack
   */
  async destroy(options: { removeVolumes?: boolean; timeout?: number } = {}): Promise<void> {
    logger.info('Destroying Docker Compose stack', { options });

    try {
      const composeFiles = await this.resolveComposeFiles();
      const composeFileArgs = composeFiles.map(file => `-f ${file}`).join(' ');
      
      let command = `docker-compose ${composeFileArgs} -p ${this.config.projectName} down`;
      
      if (options.removeVolumes) {
        command += ' --volumes';
      }
      
      if (options.timeout) {
        command += ` --timeout ${options.timeout}`;
      }

      logger.debug('Executing docker-compose down', { command });

      const result = await execAsync(command, {
        cwd: this.config.workingDirectory,
        env: {
          ...process.env,
          ...this.config.environment
        },
        timeout: (options.timeout || 60) * 1000
      });

      logger.info('Docker Compose stack destroyed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to destroy Docker Compose stack', { error: errorMessage });
      throw new Error(`Failed to destroy stack: ${errorMessage}`);
    }
  }

  /**
   * Get the current status of the Docker Compose stack
   */
  async getStatus(): Promise<ComposeStatus> {
    logger.debug('Getting Docker Compose stack status');

    try {
      const services = await this.serviceManager.getServices();
      const isRunning = services.length > 0 && services.some(s => s.status === 'running');
      const composeFiles = await this.resolveComposeFiles();

      const status: ComposeStatus = {
        projectName: this.config.projectName,
        isRunning,
        services,
        composeFiles
      };

      logger.debug('Docker Compose stack status retrieved', { 
        isRunning, 
        serviceCount: services.length 
      });

      return status;
    } catch (error) {
      logger.error('Failed to get Docker Compose stack status', { error });
      throw new Error(`Failed to get stack status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Scale services in the Docker Compose stack
   */
  async scale(serviceScales: Record<string, number>): Promise<void> {
    logger.info('Scaling Docker Compose services', { serviceScales });

    try {
      const composeFiles = await this.resolveComposeFiles();
      const composeFileArgs = composeFiles.map(file => `-f ${file}`).join(' ');
      
      const scaleArgs = Object.entries(serviceScales)
        .map(([service, scale]) => `${service}=${scale}`)
        .join(' ');

      const command = `docker-compose ${composeFileArgs} -p ${this.config.projectName} up -d --scale ${scaleArgs}`;

      logger.debug('Executing docker-compose scale', { command });

      const result = await execAsync(command, {
        cwd: this.config.workingDirectory,
        env: {
          ...process.env,
          ...this.config.environment
        }
      });

      logger.info('Docker Compose services scaled successfully', {
        serviceScales
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to scale Docker Compose services', { error: errorMessage });
      throw new Error(`Failed to scale services: ${errorMessage}`);
    }
  }

  /**
   * Get logs from Docker Compose services
   */
  async getLogs(options: {
    services?: string[];
    follow?: boolean;
    tail?: number;
    since?: string;
  } = {}): Promise<string> {
    logger.debug('Getting Docker Compose logs', { options });

    try {
      const composeFiles = await this.resolveComposeFiles();
      const composeFileArgs = composeFiles.map(file => `-f ${file}`).join(' ');
      
      let command = `docker-compose ${composeFileArgs} -p ${this.config.projectName} logs`;
      
      if (options.tail) {
        command += ` --tail=${options.tail}`;
      }
      
      if (options.since) {
        command += ` --since=${options.since}`;
      }
      
      if (options.services && options.services.length > 0) {
        command += ` ${options.services.join(' ')}`;
      }

      logger.debug('Executing docker-compose logs', { command });

      const result = await execAsync(command, {
        cwd: this.config.workingDirectory,
        env: {
          ...process.env,
          ...this.config.environment
        }
      });

      logger.debug('Docker Compose logs retrieved', { 
        logLength: result.stdout.length 
      });

      return result.stdout;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get Docker Compose logs', { error: errorMessage });
      throw new Error(`Failed to get logs: ${errorMessage}`);
    }
  }

  /**
   * Execute a command in a running service container
   */
  async exec(
    service: string, 
    command: string, 
    options: { interactive?: boolean; tty?: boolean } = {}
  ): Promise<string> {
    logger.debug('Executing command in service', { service, command, options });

    try {
      const composeFiles = await this.resolveComposeFiles();
      const composeFileArgs = composeFiles.map(file => `-f ${file}`).join(' ');
      
      let execCommand = `docker-compose ${composeFileArgs} -p ${this.config.projectName} exec`;
      
      if (!options.interactive) {
        execCommand += ' -T';
      }
      
      execCommand += ` ${service} ${command}`;

      logger.debug('Executing docker-compose exec', { execCommand });

      const result = await execAsync(execCommand, {
        cwd: this.config.workingDirectory,
        env: {
          ...process.env,
          ...this.config.environment
        }
      });

      logger.debug('Command executed successfully', { 
        outputLength: result.stdout.length 
      });

      return result.stdout;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to execute command in service', { service, command, error: errorMessage });
      throw new Error(`Failed to execute command: ${errorMessage}`);
    }
  }

  /**
   * Resolve compose files based on profile
   */
  private async resolveComposeFiles(profile?: string): Promise<string[]> {
    const files: string[] = [];
    
    // Add base compose file
    const baseFile = path.resolve(this.config.workingDirectory!, this.config.baseComposeFile);
    await this.validateComposeFile(baseFile);
    files.push(baseFile);

    // Add profile-specific compose file if specified
    if (profile && this.config.profileComposeFiles?.[profile]) {
      const profileFile = path.resolve(
        this.config.workingDirectory!, 
        this.config.profileComposeFiles[profile]
      );
      await this.validateComposeFile(profileFile);
      files.push(profileFile);
    }

    logger.debug('Resolved compose files', { files, profile });
    return files;
  }

  /**
   * Validate that a compose file exists and is readable
   */
  private async validateComposeFile(filePath: string): Promise<void> {
    try {
      await fs.access(filePath, fs.constants.R_OK);
      logger.debug('Compose file validated', { filePath });
    } catch (error) {
      const errorMessage = `Compose file not found or not readable: ${filePath}`;
      logger.error(errorMessage, { error });
      throw new Error(errorMessage);
    }
  }

  /**
   * Build docker-compose command arguments
   */
  private buildComposeArgs(composeFiles: string[], options: DeploymentOptions): string[] {
    const args: string[] = [];

    // Add compose files
    composeFiles.forEach(file => {
      args.push('-f', file);
    });

    // Add project name
    args.push('-p', this.config.projectName);

    // Add up command
    args.push('up');

    // Add options
    if (options.detached !== false) {
      args.push('-d');
    }

    if (options.build) {
      args.push('--build');
    }

    if (options.pullImages) {
      args.push('--pull');
    }

    // Add specific services if specified
    if (options.services && options.services.length > 0) {
      args.push(...options.services);
    }

    return args;
  }

  /**
   * Parse warnings from docker-compose output
   */
  private parseWarnings(output: string): string[] {
    const warnings: string[] = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (line.toLowerCase().includes('warning') || line.toLowerCase().includes('warn')) {
        warnings.push(line.trim());
      }
    }

    return warnings;
  }

  /**
   * Get the service manager instance
   */
  getServiceManager(): ServiceManager {
    return this.serviceManager;
  }

  /**
   * Get the Docker client instance
   */
  getDockerClient(): DockerClient {
    return this.dockerClient;
  }

  /**
   * Get the health checker instance
   */
  getHealthChecker(): HealthChecker {
    return this.healthChecker;
  }

  /**
   * Check the health of all services in the stack
   */
  async checkStackHealth(healthChecks?: Record<string, EndpointHealthCheck[]>) {
    logger.debug('Checking stack health');
    
    try {
      const services = await this.serviceManager.getServices();
      const healthResults = await this.healthChecker.checkServicesHealth(services, healthChecks);
      
      logger.debug('Stack health check completed', {
        serviceCount: services.length,
        healthyServices: healthResults.filter(r => r.healthy).length
      });
      
      return healthResults;
    } catch (error) {
      logger.error('Failed to check stack health', { error });
      throw new Error(`Failed to check stack health: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Wait for the entire stack to become healthy
   */
  async waitForStackReady(options: ServiceReadinessOptions = {}) {
    logger.info('Waiting for stack to become ready');
    
    try {
      const services = await this.serviceManager.getServices();
      const isReady = await this.healthChecker.waitForServicesReady(services, options);
      
      logger.info('Stack readiness check completed', { isReady });
      return isReady;
    } catch (error) {
      logger.error('Failed to wait for stack readiness', { error });
      throw new Error(`Failed to wait for stack readiness: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Start continuous health monitoring for the stack
   */
  startHealthMonitoring(
    healthChecks?: Record<string, EndpointHealthCheck[]>,
    onHealthChange?: (results: any[]) => void
  ) {
    logger.info('Starting stack health monitoring');
    
    return this.serviceManager.getServices().then(services => {
      return this.healthChecker.startMonitoring(services, healthChecks, onHealthChange);
    });
  }
}