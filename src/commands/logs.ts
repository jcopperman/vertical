/**
 * Logs command - Retrieve and display service logs for debugging
 */

import { BaseCommand } from './base';
import { CommandContext, CommandResult } from './types';
import { ServiceManager } from '../docker/service-manager';
import { DefaultConfigurationManager } from '../config/manager';

export interface LogsOptions {
  service?: string;
  tail?: number;
  follow?: boolean;
  since?: string;
  timestamps?: boolean;
  filter?: string;
}

export interface ServiceLogs {
  service: string;
  containers: ContainerLogs[];
  timestamp: Date;
}

export interface ContainerLogs {
  container: string;
  logs: string;
  error?: string;
}

export class LogsCommand extends BaseCommand {
  public readonly name = 'logs';
  public readonly description = 'Retrieve and display service logs for debugging';
  public readonly usage = '[service] [options]';
  public readonly aliases = ['log'];
  public readonly examples = [
    'otp logs',
    'otp logs grafana',
    'otp logs --tail 50',
    'otp logs grafana --follow',
    'otp logs --since "1h"',
    'otp logs --timestamps',
    'otp logs --filter "error"',
  ];

  public readonly options = [
    {
      flags: '-s, --service <name>',
      description: 'Specific service to get logs from',
    },
    {
      flags: '-t, --tail <lines>',
      description: 'Number of lines to show from the end of logs',
      defaultValue: 100,
    },
    {
      flags: '-f, --follow',
      description: 'Follow log output (stream real-time logs)',
    },
    {
      flags: '--since <time>',
      description: 'Show logs since timestamp (e.g. "1h", "30m", "2023-01-01T00:00:00")',
    },
    {
      flags: '--timestamps',
      description: 'Show timestamps in log output',
    },
    {
      flags: '--filter <pattern>',
      description: 'Filter logs by pattern (case-insensitive)',
    },
  ];

  private serviceManager?: ServiceManager;
  private configManager?: DefaultConfigurationManager;

  public async execute(args: any, context: CommandContext): Promise<CommandResult> {
    try {
      const options: LogsOptions = {
        service: args.service || args._?.[0],
        tail: parseInt(args.tail) || 100,
        follow: args.follow || false,
        since: args.since,
        timestamps: args.timestamps || false,
        filter: args.filter,
      };

      this.validateOptions(options);
      
      await this.initializeManagers(context);

      if (options.service) {
        return await this.getServiceLogs(options.service, options);
      } else {
        return await this.getAllServiceLogs(options);
      }
    } catch (error) {
      return this.error(error as Error);
    }
  }

  private async initializeManagers(context: CommandContext): Promise<void> {
    this.configManager = new DefaultConfigurationManager();
    const config = await this.configManager.loadConfig();
    
    this.serviceManager = new ServiceManager(
      {}, // Docker config from configuration
      {}, // Docker options
      { projectName: config.infrastructure?.compose?.projectName }
    );

    // Validate Docker connection
    const dockerStatus = await this.serviceManager.validateDockerConnection();
    if (!dockerStatus.connected) {
      throw new Error(`Docker is not available: ${dockerStatus.error}`);
    }
  }

  private validateOptions(options: LogsOptions): void {
    if (options.tail && (options.tail < 1 || options.tail > 10000)) {
      throw new Error('Tail value must be between 1 and 10000');
    }

    if (options.since && !this.isValidTimeFormat(options.since)) {
      throw new Error('Invalid time format. Use formats like "1h", "30m", "2023-01-01T00:00:00"');
    }
  }

  private isValidTimeFormat(timeStr: string): boolean {
    if (!timeStr || typeof timeStr !== 'string') {
      return false;
    }

    // Check relative time formats (1h, 30m, 45s)
    const relativeTimeRegex = /^\d+[hms]$/;
    if (relativeTimeRegex.test(timeStr)) {
      return true;
    }

    // Check ISO timestamp format
    try {
      const date = new Date(timeStr);
      return !isNaN(date.getTime());
    } catch {
      return false;
    }
  }

  private async getServiceLogs(serviceName: string, options: LogsOptions): Promise<CommandResult> {
    this.logger.debug(`Getting logs for service: ${serviceName}`, options);

    const service = await this.serviceManager!.getService(serviceName);
    if (!service) {
      return this.failure(`Service '${serviceName}' not found`);
    }

    if (service.containers.length === 0) {
      return this.failure(`No containers found for service '${serviceName}'`);
    }

    if (options.follow) {
      return await this.followServiceLogs(serviceName, options);
    }

    const containerLogs = await this.fetchServiceLogs(serviceName, options);
    const output = this.formatServiceLogs({
      service: serviceName,
      containers: containerLogs,
      timestamp: new Date(),
    }, options);

    return this.success(output, { service: serviceName, containers: containerLogs });
  }

  private async getAllServiceLogs(options: LogsOptions): Promise<CommandResult> {
    this.logger.debug('Getting logs for all services', options);

    const services = await this.serviceManager!.getServices();
    if (services.length === 0) {
      return this.failure('No services found');
    }

    const serviceLogs: ServiceLogs[] = [];
    
    for (const service of services) {
      if (service.containers.length > 0) {
        try {
          const containerLogs = await this.fetchServiceLogs(service.name, options);
          serviceLogs.push({
            service: service.name,
            containers: containerLogs,
            timestamp: new Date(),
          });
        } catch (error) {
          this.logger.warn(`Failed to get logs for service ${service.name}:`, error);
          serviceLogs.push({
            service: service.name,
            containers: [{
              container: 'error',
              logs: '',
              error: error instanceof Error ? error.message : 'Unknown error',
            }],
            timestamp: new Date(),
          });
        }
      }
    }

    const output = this.formatAllServiceLogs(serviceLogs, options);
    return this.success(output, serviceLogs);
  }

  private async fetchServiceLogs(serviceName: string, options: LogsOptions): Promise<ContainerLogs[]> {
    const containerLogs = await this.serviceManager!.getServiceLogs(serviceName, options.tail);
    
    return Object.entries(containerLogs).map(([containerName, logs]) => {
      let processedLogs = logs;

      // Apply time filtering if specified
      if (options.since) {
        processedLogs = this.filterLogsBySince(processedLogs, options.since);
      }

      // Apply text filtering if specified
      if (options.filter) {
        processedLogs = this.filterLogsByPattern(processedLogs, options.filter);
      }

      // Process timestamps if requested
      if (!options.timestamps) {
        processedLogs = this.removeTimestamps(processedLogs);
      }

      return {
        container: containerName,
        logs: processedLogs,
      };
    });
  }

  private async followServiceLogs(serviceName: string, options: LogsOptions): Promise<CommandResult> {
    // For follow mode, we would implement real-time log streaming
    // This is a simplified implementation that shows the concept
    this.logger.info(`Following logs for service: ${serviceName} (Press Ctrl+C to stop)`);

    try {
      // Initial logs
      const containerLogs = await this.fetchServiceLogs(serviceName, options);
      const initialOutput = this.formatServiceLogs({
        service: serviceName,
        containers: containerLogs,
        timestamp: new Date(),
      }, options);

      console.log(initialOutput);

      // In a real implementation, this would set up log streaming
      // For now, we'll simulate by polling every few seconds
      const pollInterval = 2000;
      let lastTimestamp = new Date();

      const poll = async () => {
        try {
          const newLogs = await this.fetchServiceLogs(serviceName, { ...options, since: lastTimestamp.toISOString() });
          
          for (const containerLog of newLogs) {
            if (containerLog.logs.trim()) {
              console.log(`\n[${new Date().toISOString()}] ${containerLog.container}:`);
              console.log(containerLog.logs);
            }
          }
          
          lastTimestamp = new Date();
        } catch (error) {
          this.logger.error('Error polling logs:', error);
        }
      };

      // Set up polling (in real implementation, this would be proper streaming)
      const intervalId = setInterval(poll, pollInterval);

      // Handle process termination
      process.on('SIGINT', () => {
        clearInterval(intervalId);
        console.log('\nLog following stopped.');
        process.exit(0);
      });

      // Keep the process alive
      await new Promise(() => {}); // This would be replaced with proper streaming logic

    } catch (error) {
      return this.error(error as Error);
    }

    return this.success('Log following completed');
  }

  private filterLogsBySince(logs: string, since: string): string {
    const sinceTime = this.parseSinceTime(since);
    const lines = logs.split('\n');
    
    return lines.filter(line => {
      const timestamp = this.extractTimestamp(line);
      return timestamp && timestamp >= sinceTime;
    }).join('\n');
  }

  private filterLogsByPattern(logs: string, pattern: string): string {
    const regex = new RegExp(pattern, 'i'); // Case-insensitive
    const lines = logs.split('\n');
    
    return lines.filter(line => regex.test(line)).join('\n');
  }

  private removeTimestamps(logs: string): string {
    // Remove Docker log timestamps (format: 2023-01-01T00:00:00.000000000Z)
    return logs.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*/gm, '');
  }

  private parseSinceTime(since: string): Date {
    if (!since || typeof since !== 'string') {
      throw new Error('Invalid time format');
    }

    // Handle relative time formats
    const relativeMatch = since.match(/^(\d+)([hms])$/);
    if (relativeMatch) {
      const value = parseInt(relativeMatch[1]);
      const unit = relativeMatch[2];
      const now = new Date();
      
      switch (unit) {
        case 'h':
          return new Date(now.getTime() - value * 60 * 60 * 1000);
        case 'm':
          return new Date(now.getTime() - value * 60 * 1000);
        case 's':
          return new Date(now.getTime() - value * 1000);
      }
    }

    // Handle absolute timestamps
    const date = new Date(since);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid time format');
    }
    return date;
  }

  private extractTimestamp(logLine: string): Date | null {
    // Extract Docker log timestamp
    const timestampMatch = logLine.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/);
    if (timestampMatch) {
      return new Date(timestampMatch[1]);
    }
    
    return null;
  }

  private formatServiceLogs(serviceLogs: ServiceLogs, options: LogsOptions): string {
    let output = `\n=== Logs for service: ${serviceLogs.service} ===\n`;
    output += `Retrieved at: ${serviceLogs.timestamp.toLocaleString()}\n\n`;

    for (const containerLog of serviceLogs.containers) {
      if (containerLog.error) {
        output += `❌ Container: ${containerLog.container}\n`;
        output += `Error: ${containerLog.error}\n\n`;
        continue;
      }

      output += `📦 Container: ${containerLog.container}\n`;
      output += `${'='.repeat(50)}\n`;
      
      if (containerLog.logs.trim()) {
        output += containerLog.logs;
        if (!containerLog.logs.endsWith('\n')) {
          output += '\n';
        }
      } else {
        output += '(No logs available)\n';
      }
      
      output += `${'='.repeat(50)}\n\n`;
    }

    return output;
  }

  private formatAllServiceLogs(serviceLogs: ServiceLogs[], options: LogsOptions): string {
    let output = `\n=== Logs for all services ===\n`;
    output += `Retrieved at: ${new Date().toLocaleString()}\n\n`;

    for (const serviceLog of serviceLogs) {
      output += `🔧 Service: ${serviceLog.service}\n`;
      output += `${'-'.repeat(30)}\n`;

      for (const containerLog of serviceLog.containers) {
        if (containerLog.error) {
          output += `  ❌ ${containerLog.container}: ${containerLog.error}\n`;
          continue;
        }

        const logLines = containerLog.logs.split('\n').filter(line => line.trim());
        const displayLines = logLines.slice(-5); // Show last 5 lines for overview
        
        if (displayLines.length > 0) {
          output += `  📦 ${containerLog.container} (last ${displayLines.length} lines):\n`;
          for (const line of displayLines) {
            output += `    ${line}\n`;
          }
        } else {
          output += `  📦 ${containerLog.container}: (No recent logs)\n`;
        }
      }
      
      output += '\n';
    }

    output += `Use 'otp logs <service>' to see full logs for a specific service.\n`;
    return output;
  }
}