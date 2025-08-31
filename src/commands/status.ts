/**
 * Status command - Check infrastructure health and service states
 */

import { BaseCommand } from './base';
import { CommandContext, CommandResult } from './types';
import { serviceStatusCache } from '../utils/cache';
import { performanceMonitor, timedAsync } from '../utils/performance';

export interface ServiceStatus {
  name: string;
  status: 'running' | 'starting' | 'stopped' | 'error' | 'unknown';
  health: 'healthy' | 'unhealthy' | 'unknown';
  ports: number[];
  uptime?: string;
  lastCheck?: Date;
  endpoint?: string;
  error?: string;
}

export interface InfrastructureStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  services: ServiceStatus[];
  lastUpdated: Date;
  profile: string;
}

export class StatusCommand extends BaseCommand {
  public readonly name = 'status';
  public readonly description = 'Check infrastructure health and service states';
  public readonly usage = '[options]';
  public readonly aliases = ['st'];
  public readonly examples = [
    'otp status',
    'otp status --verbose',
    'otp status --service grafana',
  ];

  public async execute(args: any, context: CommandContext): Promise<CommandResult> {
    try {
      const serviceName = args.service;
      const showDetails = context.verbose || args.verbose || args.details;

      if (serviceName) {
        return await this.checkSingleService(serviceName, showDetails);
      } else {
        return await this.checkAllServices(showDetails);
      }
    } catch (error) {
      return this.error(error as Error);
    }
  }

  private async checkAllServices(showDetails: boolean): Promise<CommandResult> {
    this.logger.debug('Checking status of all infrastructure services');

    const status = await this.getInfrastructureStatus();
    const output = this.formatInfrastructureStatus(status, showDetails);

    const exitCode = status.overall === 'healthy' ? 0 : 1;
    
    return {
      success: status.overall !== 'unhealthy',
      message: output,
      data: status,
      exitCode,
    };
  }

  private async checkSingleService(serviceName: string, showDetails: boolean): Promise<CommandResult> {
    this.logger.debug(`Checking status of service: ${serviceName}`);

    const serviceStatus = await this.getServiceStatus(serviceName);
    
    if (!serviceStatus) {
      return this.failure(`Service '${serviceName}' not found`);
    }

    const output = this.formatServiceStatus(serviceStatus, showDetails);
    const exitCode = serviceStatus.health === 'healthy' ? 0 : 1;

    return {
      success: serviceStatus.health !== 'unhealthy',
      message: output,
      data: serviceStatus,
      exitCode,
    };
  }

  @timedAsync('status-get-infrastructure')
  private async getInfrastructureStatus(): Promise<InfrastructureStatus> {
    const cacheKey = 'infrastructure:status:all';
    
    // Try cache first
    const cached = serviceStatusCache.get(cacheKey);
    if (cached) {
      this.logger.debug('Using cached infrastructure status');
      return cached;
    }

    // This is a mock implementation - in real implementation this would
    // check Docker containers, Kubernetes pods, or other infrastructure
    const services = await Promise.all([
      this.getServiceStatus('grafana'),
      this.getServiceStatus('prometheus'),
      this.getServiceStatus('loki'),
      this.getServiceStatus('tempo'),
      this.getServiceStatus('postgres'),
      this.getServiceStatus('minio'),
    ]);

    const validServices = services.filter(s => s !== null) as ServiceStatus[];
    const healthyCount = validServices.filter(s => s.health === 'healthy').length;
    const totalCount = validServices.length;

    let overall: InfrastructureStatus['overall'];
    if (healthyCount === totalCount) {
      overall = 'healthy';
    } else if (healthyCount > totalCount / 2) {
      overall = 'degraded';
    } else if (healthyCount === 0) {
      overall = 'unhealthy';
    } else {
      overall = 'degraded';
    }

    const status: InfrastructureStatus = {
      overall,
      services: validServices,
      lastUpdated: new Date(),
      profile: 'local', // This would come from configuration
    };

    // Cache for 15 seconds
    serviceStatusCache.set(cacheKey, status, 15000);

    return status;
  }

  private async getServiceStatus(serviceName: string): Promise<ServiceStatus | null> {
    const cacheKey = `service:status:${serviceName}`;
    
    // Try cache first
    const cached = serviceStatusCache.get(cacheKey);
    if (cached) {
      this.logger.debug('Using cached service status', { serviceName });
      return cached;
    }

    // Mock implementation - in real implementation this would check actual services
    const serviceConfigs = {
      grafana: { port: 3000, endpoint: '/api/health' },
      prometheus: { port: 9090, endpoint: '/api/v1/status/config' },
      loki: { port: 3100, endpoint: '/ready' },
      tempo: { port: 3200, endpoint: '/ready' },
      postgres: { port: 5432, endpoint: null },
      minio: { port: 9000, endpoint: '/minio/health/live' },
    };

    const config = serviceConfigs[serviceName as keyof typeof serviceConfigs];
    if (!config) {
      return null;
    }

    // Simulate checking service status
    const isRunning = Math.random() > 0.2; // 80% chance of being running
    const isHealthy = isRunning && Math.random() > 0.1; // 90% chance of being healthy if running

    const status: ServiceStatus = {
      name: serviceName,
      status: isRunning ? 'running' : 'stopped',
      health: isRunning ? (isHealthy ? 'healthy' : 'unhealthy') : 'unknown',
      ports: [config.port],
      uptime: isRunning ? this.generateUptime() : undefined,
      lastCheck: new Date(),
      endpoint: config.endpoint ? `http://localhost:${config.port}${config.endpoint}` : undefined,
      error: !isHealthy && isRunning ? 'Service responding with errors' : undefined,
    };

    // Cache for 10 seconds
    serviceStatusCache.set(cacheKey, status, 10000);

    return status;
  }

  private generateUptime(): string {
    const hours = Math.floor(Math.random() * 24);
    const minutes = Math.floor(Math.random() * 60);
    return `${hours}h ${minutes}m`;
  }

  private formatInfrastructureStatus(status: InfrastructureStatus, showDetails: boolean): string {
    const statusIcon = this.getStatusIcon(status.overall);
    let output = `\nOTP Infrastructure Status ${statusIcon}\n`;
    output += `Profile: ${status.profile}\n`;
    output += `Last Updated: ${status.lastUpdated.toLocaleString()}\n\n`;

    // Summary
    const healthyCount = status.services.filter(s => s.health === 'healthy').length;
    const runningCount = status.services.filter(s => s.status === 'running').length;
    output += `Services: ${runningCount}/${status.services.length} running, ${healthyCount}/${status.services.length} healthy\n\n`;

    // Service list
    output += 'Services:\n';
    for (const service of status.services) {
      output += this.formatServiceLine(service, showDetails);
    }

    if (status.overall !== 'healthy') {
      output += '\nIssues detected. Use --verbose for more details or check individual services.\n';
    }

    return output;
  }

  private formatServiceStatus(service: ServiceStatus, showDetails: boolean): string {
    const statusIcon = this.getHealthIcon(service.health);
    let output = `\nService: ${service.name} ${statusIcon}\n`;
    output += `Status: ${service.status}\n`;
    output += `Health: ${service.health}\n`;
    output += `Ports: ${service.ports.join(', ')}\n`;

    if (service.uptime) {
      output += `Uptime: ${service.uptime}\n`;
    }

    if (service.endpoint) {
      output += `Endpoint: ${service.endpoint}\n`;
    }

    if (service.lastCheck) {
      output += `Last Check: ${service.lastCheck.toLocaleString()}\n`;
    }

    if (service.error) {
      output += `Error: ${service.error}\n`;
    }

    if (showDetails) {
      output += '\nDiagnostic Information:\n';
      output += `- Container/Pod Status: ${service.status}\n`;
      output += `- Health Check Result: ${service.health}\n`;
      output += `- Network Connectivity: ${service.endpoint ? 'Available' : 'N/A'}\n`;
      
      if (service.health !== 'healthy') {
        output += '\nTroubleshooting Steps:\n';
        output += '1. Check if the service container is running\n';
        output += '2. Verify port availability and network connectivity\n';
        output += '3. Check service logs for error messages\n';
        output += `4. Try restarting the service: otp restart ${service.name}\n`;
      }
    }

    return output;
  }

  private formatServiceLine(service: ServiceStatus, showDetails: boolean): string {
    const healthIcon = this.getHealthIcon(service.health);
    const statusIcon = this.getStatusIcon(service.status as any);
    
    let line = `  ${service.name.padEnd(12)} ${statusIcon} ${healthIcon}`;
    
    if (showDetails) {
      line += ` :${service.ports.join(',')}`;
      if (service.uptime) {
        line += ` (${service.uptime})`;
      }
      if (service.error) {
        line += ` - ${service.error}`;
      }
    }
    
    return line + '\n';
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'running':
      case 'healthy':
        return '✅';
      case 'starting':
      case 'degraded':
        return '⚠️';
      case 'stopped':
      case 'unhealthy':
        return '❌';
      default:
        return '❓';
    }
  }

  private getHealthIcon(health: string): string {
    switch (health) {
      case 'healthy':
        return '🟢';
      case 'unhealthy':
        return '🔴';
      default:
        return '🟡';
    }
  }
}