/**
 * Up command - Deploy the OTP infrastructure stack
 */

import { BaseCommand } from './base';
import { CommandContext, CommandResult, CommandOption } from './types';
import { ConfigurationManager, DefaultConfigurationManager } from '../config/manager';
import { DockerComposeOrchestrator, DeploymentOptions } from '../docker/compose-orchestrator';
import { OTPConfig } from '../config/types';

export class UpCommand extends BaseCommand {
  public readonly name = 'up';
  public readonly description = 'Start the OTP infrastructure stack';
  public readonly usage = '[options]';
  public readonly aliases = ['start'];
  public readonly examples = [
    'otp up',
    'otp up --profile ci',
    'otp up --build',
    'otp up --no-wait'
  ];

  public readonly options: CommandOption[] = [
    {
      flags: '--profile <profile>',
      description: 'Deployment profile to use (local, ci, k8s)',
      required: false
    },
    {
      flags: '--build',
      description: 'Build images before starting services',
      required: false
    },
    {
      flags: '--pull',
      description: 'Pull latest images before starting',
      required: false
    },
    {
      flags: '--no-wait',
      description: 'Do not wait for services to become healthy',
      required: false
    },
    {
      flags: '--timeout <seconds>',
      description: 'Deployment timeout in seconds (default: 300)',
      required: false,
      defaultValue: 300
    },
    {
      flags: '--health-timeout <seconds>',
      description: 'Health check timeout in seconds (default: 120)',
      required: false,
      defaultValue: 120
    },
    {
      flags: '--services <services>',
      description: 'Comma-separated list of specific services to start',
      required: false
    }
  ];

  private configManager: ConfigurationManager;

  constructor(configManager?: ConfigurationManager) {
    super();
    this.configManager = configManager || new DefaultConfigurationManager();
  }

  public async execute(args: any, context: CommandContext): Promise<CommandResult> {
    try {
      this.validateArgs(args);

      // Load configuration
      const profile = args.profile || context.profile;
      this.logger.info(`Starting OTP infrastructure deployment`, { profile });

      const config = await this.configManager.loadConfig(profile);
      
      // Validate configuration
      const validation = await this.configManager.validateConfig(config);
      if (!validation.valid) {
        const errorMessages = validation.errors.map(e => `${e.path}: ${e.message}`).join('\n');
        return this.failure(`Configuration validation failed:\n${errorMessages}`);
      }

      // Check for existing deployment
      const existingDeployment = await this.checkExistingDeployment(config);
      if (existingDeployment.exists && !args.force) {
        this.logger.warn('Existing deployment detected');
        
        if (existingDeployment.conflicting) {
          return this.failure(
            `Conflicting deployment detected. Use --force to override or run 'otp down' first.\n` +
            `Conflicting services: ${existingDeployment.conflictingServices?.join(', ')}`
          );
        }
        
        this.logger.info('Existing deployment is compatible, proceeding with update');
      }

      // Create orchestrator
      const orchestrator = this.createOrchestrator(config);

      // Prepare deployment options
      const deploymentOptions = this.buildDeploymentOptions(args, config);

      // Show deployment plan
      this.showDeploymentPlan(config, deploymentOptions);

      // Execute deployment with progress reporting
      const result = await this.deployWithProgress(orchestrator, deploymentOptions);

      if (!result.success) {
        return this.failure(
          `Deployment failed: ${result.errors.join(', ')}`,
          1,
          { errors: result.errors, warnings: result.warnings }
        );
      }

      // Report success
      const message = this.formatSuccessMessage(result);
      this.logger.info('OTP infrastructure deployment completed successfully', {
        serviceCount: result.services.length,
        deploymentTime: result.deploymentTime
      });

      return this.success(message, {
        services: result.services,
        deploymentTime: result.deploymentTime,
        warnings: result.warnings
      });

    } catch (error) {
      this.logger.error('Up command failed', error);
      return this.error(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  protected validateArgs(args: any): void {
    if (args.timeout !== undefined && (isNaN(args.timeout) || args.timeout <= 0)) {
      throw new Error('Timeout must be a positive number');
    }

    if (args.healthTimeout !== undefined && (isNaN(args.healthTimeout) || args.healthTimeout <= 0)) {
      throw new Error('Health timeout must be a positive number');
    }

    if (args.profile && !['local', 'ci', 'k8s'].includes(args.profile)) {
      throw new Error('Profile must be one of: local, ci, k8s');
    }
  }

  private async checkExistingDeployment(config: OTPConfig): Promise<{
    exists: boolean;
    conflicting: boolean;
    conflictingServices?: string[];
  }> {
    try {
      const orchestrator = this.createOrchestrator(config);
      const status = await orchestrator.getStatus();

      if (!status.isRunning) {
        return { exists: false, conflicting: false };
      }

      // Check for conflicting services (services with different configurations)
      const conflictingServices: string[] = [];
      
      // For now, we'll consider any running services as potentially conflicting
      // In a more sophisticated implementation, we'd compare configurations
      const runningServices = status.services.filter(s => s.status === 'running');
      
      if (runningServices.length > 0) {
        // Simple conflict detection - if services are running with different project name
        const hasConflict = status.projectName !== config.infrastructure.compose.projectName;
        
        if (hasConflict) {
          conflictingServices.push(...runningServices.map(s => s.name));
        }
      }

      return {
        exists: true,
        conflicting: conflictingServices.length > 0,
        conflictingServices: conflictingServices.length > 0 ? conflictingServices : undefined
      };
    } catch (error) {
      this.logger.debug('Could not check existing deployment', error);
      return { exists: false, conflicting: false };
    }
  }

  private createOrchestrator(config: OTPConfig): DockerComposeOrchestrator {
    const composeConfig = {
      projectName: config.infrastructure.compose.projectName,
      baseComposeFile: config.infrastructure.compose.baseFile,
      profileComposeFiles: config.infrastructure.compose.profileFiles
    };

    return new DockerComposeOrchestrator(composeConfig);
  }

  private buildDeploymentOptions(args: any, config: OTPConfig): DeploymentOptions {
    const options: DeploymentOptions = {
      profile: config.profile,
      detached: true,
      build: args.build || false,
      pullImages: args.pull || false,
      timeout: (args.timeout || 300) * 1000, // Convert to milliseconds
      waitForHealthy: !args.noWait,
      healthCheckTimeout: (args.healthTimeout || 120) * 1000, // Convert to milliseconds
    };

    // Parse services list if provided
    if (args.services) {
      options.services = args.services.split(',').map((s: string) => s.trim());
    }

    // Build health checks configuration from service definitions
    if (config.infrastructure.services.length > 0) {
      options.healthChecks = {};
      
      for (const service of config.infrastructure.services) {
        if (service.healthCheck) {
          options.healthChecks[service.name] = [{
            name: `${service.name}-health`,
            url: service.healthCheck.endpoint,
            timeout: service.healthCheck.timeout,
            expectedStatus: [200]
          }];
        }
      }
    }

    return options;
  }

  private showDeploymentPlan(config: OTPConfig, options: DeploymentOptions): void {
    console.log('\n📋 Deployment Plan:');
    console.log(`   Profile: ${config.profile}`);
    console.log(`   Project: ${config.infrastructure.compose.projectName}`);
    
    if (options.services && options.services.length > 0) {
      console.log(`   Services: ${options.services.join(', ')}`);
    } else {
      console.log(`   Services: All services`);
    }
    
    console.log(`   Build: ${options.build ? 'Yes' : 'No'}`);
    console.log(`   Pull Images: ${options.pullImages ? 'Yes' : 'No'}`);
    console.log(`   Wait for Health: ${options.waitForHealthy ? 'Yes' : 'No'}`);
    console.log('');
  }

  private async deployWithProgress(
    orchestrator: DockerComposeOrchestrator,
    options: DeploymentOptions
  ) {
    console.log('🚀 Starting deployment...');
    
    const startTime = Date.now();
    
    try {
      // Start deployment
      console.log('   📦 Pulling/building images...');
      const result = await orchestrator.deploy(options);
      
      if (result.success) {
        const deployTime = Math.round(result.deploymentTime / 1000);
        console.log(`   ✅ Services deployed (${deployTime}s)`);
        
        if (options.waitForHealthy && result.services.length > 0) {
          console.log('   🔍 Checking service health...');
          
          // The orchestrator already waited for health, so we just report the status
          const healthyServices = result.services.filter(s => s.health === 'healthy').length;
          const totalServices = result.services.length;
          
          if (healthyServices === totalServices) {
            console.log(`   ✅ All services healthy (${healthyServices}/${totalServices})`);
          } else {
            console.log(`   ⚠️  Some services unhealthy (${healthyServices}/${totalServices})`);
          }
        }
        
        if (result.warnings.length > 0) {
          console.log('\n⚠️  Warnings:');
          result.warnings.forEach(warning => console.log(`   ${warning}`));
        }
      }
      
      return result;
    } catch (error) {
      const deployTime = Math.round((Date.now() - startTime) / 1000);
      console.log(`   ❌ Deployment failed (${deployTime}s)`);
      throw error;
    }
  }

  private formatSuccessMessage(result: any): string {
    const deployTime = Math.round(result.deploymentTime / 1000);
    const serviceCount = result.services.length;
    const healthyCount = result.services.filter((s: any) => s.health === 'healthy').length;
    
    let message = `🎉 OTP infrastructure deployed successfully!\n`;
    message += `   Services: ${serviceCount} deployed, ${healthyCount} healthy\n`;
    message += `   Time: ${deployTime} seconds\n`;
    
    // Show service endpoints
    const runningServices = result.services.filter((s: any) => s.status === 'running');
    if (runningServices.length > 0) {
      message += `\n📡 Available services:\n`;
      runningServices.forEach((service: any) => {
        if (service.endpoints && service.endpoints.length > 0) {
          const endpoints = service.endpoints.map((e: any) => e.url).join(', ');
          message += `   ${service.name}: ${endpoints}\n`;
        }
      });
    }
    
    message += `\n💡 Use 'otp status' to check service health`;
    message += `\n💡 Use 'otp report open' to view dashboards`;
    
    return message;
  }
}