/**
 * Docker API client implementation using dockerode
 */

import Docker from 'dockerode';
import { createLogger } from '../utils/logger';
import { dockerApiCache } from '../utils/cache';
import { performanceMonitor, timedAsync } from '../utils/performance';

const logger = createLogger('docker-client');
import {
  DockerClientConfig,
  ContainerInfo,
  ServiceInfo,
  DockerConnectionStatus,
  ContainerStats,
  DockerClientOptions,
  PortMapping,
  ServiceEndpoint
} from './types';

export class DockerClient {
  private docker: Docker;
  private options: DockerClientOptions;

  constructor(config: DockerClientConfig = {}, options: DockerClientOptions = {}) {
    this.options = {
      timeout: 30000,
      retries: 3,
      retryDelay: 1000,
      ...options
    };

    // Initialize dockerode with configuration
    this.docker = new Docker({
      socketPath: config.socketPath || (process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock'),
      host: config.host,
      port: config.port,
      protocol: config.protocol,
      timeout: config.timeout || this.options.timeout
    });

    logger.debug('Docker client initialized', { config, options: this.options });
  }

  /**
   * Test Docker connectivity and get version information
   */
  @timedAsync('docker-validate-connection')
  async validateConnection(): Promise<DockerConnectionStatus> {
    const cacheKey = 'docker:connection:status';
    
    // Try cache first for connection status (short TTL)
    const cached = dockerApiCache.get(cacheKey);
    if (cached) {
      logger.debug('Using cached Docker connection status');
      return cached;
    }

    try {
      logger.debug('Validating Docker connection');
      
      const info = await this.docker.version();
      const status: DockerConnectionStatus = {
        connected: true,
        version: info.Version,
        apiVersion: info.ApiVersion
      };

      // Cache successful connection for 30 seconds
      dockerApiCache.set(cacheKey, status, 30000);
      
      logger.debug('Docker connection validated', status);
      return status;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Docker connection validation failed', { error: errorMessage });
      
      const status = {
        connected: false,
        error: errorMessage
      };

      // Cache failed connection for shorter time (5 seconds)
      dockerApiCache.set(cacheKey, status, 5000);
      
      return status;
    }
  }

  /**
   * List all containers with optional filtering
   */
  @timedAsync('docker-list-containers')
  async listContainers(all: boolean = false, filters?: Record<string, string[]>): Promise<ContainerInfo[]> {
    const cacheKey = `docker:containers:${all}:${JSON.stringify(filters || {})}`;
    
    // Try cache first (short TTL for container list)
    const cached = dockerApiCache.get(cacheKey);
    if (cached) {
      logger.debug('Using cached container list', { count: cached.length });
      return cached;
    }

    try {
      logger.debug('Listing containers', { all, filters });
      
      const containers = await this.docker.listContainers({
        all,
        filters: filters ? JSON.stringify(filters) : undefined
      });

      const containerInfos: ContainerInfo[] = containers.map(container => ({
        id: container.Id,
        name: container.Names[0]?.replace(/^\//, '') || 'unknown',
        image: container.Image,
        status: this.mapContainerStatus(container.State),
        state: this.mapContainerState(container.State),
        ports: this.mapPorts(container.Ports || []),
        labels: container.Labels || {},
        created: new Date(container.Created * 1000)
      }));

      // Cache for 5 seconds (containers change frequently)
      dockerApiCache.set(cacheKey, containerInfos, 5000);

      logger.debug(`Found ${containerInfos.length} containers`);
      return containerInfos;
    } catch (error) {
      logger.error('Failed to list containers', { error });
      throw new Error(`Failed to list containers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get detailed information about a specific container
   */
  async getContainer(containerId: string): Promise<ContainerInfo | null> {
    try {
      logger.debug('Getting container info', { containerId });
      
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();

      const containerInfo: ContainerInfo = {
        id: info.Id,
        name: info.Name.replace(/^\//, ''),
        image: info.Config.Image,
        status: this.mapContainerStatus(info.State.Status),
        state: info.State.Running ? 'running' : info.State.ExitCode === 0 ? 'stopped' : 'error',
        ports: this.mapPortsFromInspect(info.NetworkSettings.Ports || {}),
        labels: info.Config.Labels || {},
        created: new Date(info.Created)
      };

      logger.debug('Container info retrieved', { containerInfo });
      return containerInfo;
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        logger.debug('Container not found', { containerId });
        return null;
      }
      
      logger.error('Failed to get container info', { containerId, error });
      throw new Error(`Failed to get container info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Start a container
   */
  async startContainer(containerId: string): Promise<void> {
    try {
      logger.debug('Starting container', { containerId });
      
      const container = this.docker.getContainer(containerId);
      await container.start();
      
      logger.info('Container started successfully', { containerId });
    } catch (error) {
      logger.error('Failed to start container', { containerId, error });
      throw new Error(`Failed to start container: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Stop a container
   */
  async stopContainer(containerId: string, timeout: number = 10): Promise<void> {
    try {
      logger.debug('Stopping container', { containerId, timeout });
      
      const container = this.docker.getContainer(containerId);
      await container.stop({ t: timeout });
      
      logger.info('Container stopped successfully', { containerId });
    } catch (error) {
      logger.error('Failed to stop container', { containerId, error });
      throw new Error(`Failed to stop container: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Remove a container
   */
  async removeContainer(containerId: string, force: boolean = false): Promise<void> {
    try {
      logger.debug('Removing container', { containerId, force });
      
      const container = this.docker.getContainer(containerId);
      await container.remove({ force });
      
      logger.info('Container removed successfully', { containerId });
    } catch (error) {
      logger.error('Failed to remove container', { containerId, error });
      throw new Error(`Failed to remove container: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get container logs
   */
  async getContainerLogs(containerId: string, tail: number = 100): Promise<string> {
    try {
      logger.debug('Getting container logs', { containerId, tail });
      
      const container = this.docker.getContainer(containerId);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail,
        timestamps: true
      });

      const logString = logs.toString('utf8');
      logger.debug('Container logs retrieved', { containerId, logLength: logString.length });
      
      return logString;
    } catch (error) {
      logger.error('Failed to get container logs', { containerId, error });
      throw new Error(`Failed to get container logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get container statistics
   */
  async getContainerStats(containerId: string): Promise<ContainerStats> {
    try {
      logger.debug('Getting container stats', { containerId });
      
      const container = this.docker.getContainer(containerId);
      const stats = await container.stats({ stream: false });

      const containerStats: ContainerStats = {
        cpuUsage: this.calculateCpuUsage(stats),
        memoryUsage: stats.memory_stats?.usage || 0,
        memoryLimit: stats.memory_stats?.limit || 0,
        networkRx: this.calculateNetworkRx(stats),
        networkTx: this.calculateNetworkTx(stats)
      };

      logger.debug('Container stats retrieved', { containerId, containerStats });
      return containerStats;
    } catch (error) {
      logger.error('Failed to get container stats', { containerId, error });
      throw new Error(`Failed to get container stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Group containers by service (based on compose project and service labels)
   */
  @timedAsync('docker-get-services')
  async getServices(projectName?: string): Promise<ServiceInfo[]> {
    const cacheKey = `docker:services:${projectName || 'all'}`;
    
    // Try cache first
    const cached = dockerApiCache.get(cacheKey);
    if (cached) {
      logger.debug('Using cached services list', { count: cached.length });
      return cached;
    }

    try {
      logger.debug('Getting services', { projectName });
      
      const filters: Record<string, string[]> = {};
      if (projectName) {
        filters['label'] = [`com.docker.compose.project=${projectName}`];
      }

      const containers = await this.listContainers(true, filters);
      const serviceMap = new Map<string, ContainerInfo[]>();

      // Group containers by service name
      containers.forEach(container => {
        const serviceName = container.labels['com.docker.compose.service'] || 'unknown';
        if (!serviceMap.has(serviceName)) {
          serviceMap.set(serviceName, []);
        }
        serviceMap.get(serviceName)!.push(container);
      });

      const services: ServiceInfo[] = Array.from(serviceMap.entries()).map(([serviceName, serviceContainers]) => {
        const runningContainers = serviceContainers.filter(c => c.state === 'running');
        const hasErrors = serviceContainers.some(c => c.state === 'error');
        
        return {
          name: serviceName,
          containers: serviceContainers,
          status: hasErrors ? 'error' : runningContainers.length > 0 ? 'running' : 'stopped',
          health: this.determineServiceHealth(serviceContainers),
          endpoints: this.extractServiceEndpoints(serviceContainers)
        };
      });

      // Cache for 10 seconds
      dockerApiCache.set(cacheKey, services, 10000);

      logger.debug(`Found ${services.length} services`);
      return services;
    } catch (error) {
      logger.error('Failed to get services', { error });
      throw new Error(`Failed to get services: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Invalidate Docker API caches
   */
  invalidateCache(): void {
    dockerApiCache.invalidatePattern(/^docker:/);
    logger.debug('Docker API cache invalidated');
  }

  private mapContainerStatus(state: string): ContainerInfo['status'] {
    switch (state.toLowerCase()) {
      case 'created': return 'created';
      case 'running': return 'running';
      case 'paused': return 'paused';
      case 'restarting': return 'restarting';
      case 'removing': return 'removing';
      case 'exited': return 'exited';
      case 'dead': return 'dead';
      default: return 'exited';
    }
  }

  private mapContainerState(state: string): ContainerInfo['state'] {
    switch (state.toLowerCase()) {
      case 'running': return 'running';
      case 'exited':
      case 'created':
      case 'paused': return 'stopped';
      default: return 'error';
    }
  }

  private mapPorts(ports: any[]): PortMapping[] {
    return ports.map(port => ({
      privatePort: port.PrivatePort,
      publicPort: port.PublicPort,
      type: port.Type as 'tcp' | 'udp',
      ip: port.IP
    }));
  }

  private mapPortsFromInspect(ports: Record<string, any>): PortMapping[] {
    const mappings: PortMapping[] = [];
    
    Object.entries(ports).forEach(([portSpec, bindings]) => {
      const [port, type] = portSpec.split('/');
      const privatePort = parseInt(port, 10);
      
      if (bindings && Array.isArray(bindings)) {
        bindings.forEach(binding => {
          mappings.push({
            privatePort,
            publicPort: binding.HostPort ? parseInt(binding.HostPort, 10) : undefined,
            type: type as 'tcp' | 'udp',
            ip: binding.HostIp
          });
        });
      } else {
        mappings.push({
          privatePort,
          type: type as 'tcp' | 'udp'
        });
      }
    });

    return mappings;
  }

  private calculateCpuUsage(stats: any): number {
    if (!stats.cpu_stats || !stats.precpu_stats) return 0;
    
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuCount = stats.cpu_stats.online_cpus || 1;
    
    if (systemDelta > 0 && cpuDelta > 0) {
      return (cpuDelta / systemDelta) * cpuCount * 100;
    }
    
    return 0;
  }

  private calculateNetworkRx(stats: any): number {
    if (!stats.networks) return 0;
    
    return Object.values(stats.networks).reduce((total: number, network: any) => {
      return total + (network.rx_bytes || 0);
    }, 0);
  }

  private calculateNetworkTx(stats: any): number {
    if (!stats.networks) return 0;
    
    return Object.values(stats.networks).reduce((total: number, network: any) => {
      return total + (network.tx_bytes || 0);
    }, 0);
  }

  private determineServiceHealth(containers: ContainerInfo[]): ServiceInfo['health'] {
    if (containers.length === 0) return 'unknown';
    
    const runningContainers = containers.filter(c => c.state === 'running');
    const errorContainers = containers.filter(c => c.state === 'error');
    
    if (errorContainers.length > 0) return 'unhealthy';
    if (runningContainers.length === containers.length) return 'healthy';
    
    return 'unknown';
  }

  private extractServiceEndpoints(containers: ContainerInfo[]): ServiceEndpoint[] {
    const endpoints: ServiceEndpoint[] = [];
    
    containers.forEach(container => {
      container.ports.forEach(port => {
        if (port.publicPort) {
          endpoints.push({
            name: `${container.name}:${port.privatePort}`,
            url: `http://localhost:${port.publicPort}`,
            port: port.publicPort,
            protocol: port.type === 'tcp' ? 'http' : port.type
          });
        }
      });
    });
    
    return endpoints;
  }
}