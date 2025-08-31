/**
 * Down command - Stop and cleanup the OTP infrastructure stack
 */

import { BaseCommand } from './base';
import { CommandContext, CommandResult, CommandOption } from './types';
import { ConfigurationManager, DefaultConfigurationManager } from '../config/manager';
import { DockerComposeOrchestrator } from '../docker/compose-orchestrator';
import { OTPConfig } from '../config/types';

export class DownCommand extends BaseCommand {
  public readonly name = 'down';
  public readonly description = 'Stop and cleanup the OTP infrastructure stack';
  public readonly usage = '[options]';
  public readonly aliases = ['stop'];
  public readonly examples = [
    'otp down',
    'otp down --clean',
    'otp down --timeout 60',
    'otp down --force'
  ];

  public readonly options: CommandOption[] = [
    {
      flags: '--profile <profile>',
      description: 'Deployment profile to use (local, ci, k8s)',
      required: false
    },
    {
      flags: '--clean',
      description: 'Remove all data volumes and reset to initial state',
      required: false
    },
    {
      flags: '--timeout <seconds>',
      description: 'Shutdown timeout in seconds (default: 60)',
      required: false,
      defaultValue: 60
    },
    {
      flags: '--force',
      description: 'Force stop services that fail to stop gracefully',
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
      this.logger.info(`Starting OTP infrastructure cleanup`, { profile, clean: args.clean });

      const config = await this.configManager.loadConfig(profile);
      
      // Validate configuration
      const validation = await this.configManager.validateConfig(config);
      if (!validation.valid) {
        const errorMessages = validation.errors.map(e => `${e.path}: ${e.message}`).join('\n');
        return this.failure(`Configuration validation failed:\n${errorMessages}`);
      }

      // Check if stack is running
      const stackStatus = await this.checkStackStatus(config);
      if (!stackStatus.isRunning) {
        this.logger.info('No running OTP infrastructure found');
        return this.success('No OTP infrastructure is currently running');
      }

      // Show cleanup plan
      this.showCleanupPlan(config, args, stackStatus);

      // Create orchestrator
      const orchestrator = this.createOrchestrator(config);

      // Execute cleanup with progress reporting
      const result = await this.cleanupWithProgress(orchestrator, args);

      if (!result.success) {
        return this.failure(
          `Cleanup failed: ${result.errors.join(', ')}`,
          1,
          { errors: result.errors }
        );
      }

      // Report success
      const message = this.formatSuccessMessage(result, args);
      this.logger.info('OTP infrastructure cleanup completed successfully', {
        cleanupTime: result.cleanupTime,
        servicesRemoved: result.servicesRemoved
      });

      return this.success(message, {
        cleanupTime: result.cleanupTime,
        servicesRemoved: result.servicesRemoved
      });

    } catch (error) {
      this.logger.error('Down command failed', error);
      return this.error(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  protected validateArgs(args: any): void {
    if (args.timeout !== undefined && (isNaN(args.timeout) || args.timeout <= 0)) {
      throw new Error('Timeout must be a positive number');
    }

    if (args.profile && !['local', 'ci', 'k8s'].includes(args.profile)) {
      throw new Error('Profile must be one of: local, ci, k8s');
    }
  }

  private async checkStackStatus(config: OTPConfig): Promise<{
    isRunning: boolean;
    services: any[];
    projectName: string;
  }> {
    try {
      const orchestrator = this.createOrchestrator(config);
      const status = await orchestrator.getStatus();
      
      return {
        isRunning: status.isRunning,
        services: status.services,
        projectName: status.projectName
      };
    } catch (error) {
      this.logger.debug('Could not check stack status', error);
      return {
        isRunning: false,
        services: [],
        projectName: config.infrastructure.compose.projectName
      };
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

  private showCleanupPlan(config: OTPConfig, args: any, stackStatus: any): void {
    console.log('\n🗑️  Cleanup Plan:');
    console.log(`   Profile: ${config.profile}`);
    console.log(`   Project: ${config.infrastructure.compose.projectName}`);
    console.log(`   Services: ${stackStatus.services.length} running services`);
    console.log(`   Remove Volumes: ${args.clean ? 'Yes' : 'No'}`);
    console.log(`   Timeout: ${args.timeout || 60} seconds`);
    console.log(`   Force Stop: ${args.force ? 'Yes' : 'No'}`);
    console.log('');
  }

  private async cleanupWithProgress(
    orchestrator: DockerComposeOrchestrator,
    args: any
  ): Promise<{
    success: boolean;
    cleanupTime: number;
    servicesRemoved: number;
    errors: string[];
  }> {
    console.log('🛑 Starting cleanup...');
    
    const startTime = Date.now();
    
    try {
      // Get current services before cleanup
      const statusBefore = await orchestrator.getStatus();
      const servicesBefore = statusBefore.services.length;

      console.log(`   📋 Found ${servicesBefore} services to stop`);

      // Force stop if force flag is set
      if (args.force) {
        console.log('   💥 Force stopping services...');
        
        // Force stop with shorter timeout
        await orchestrator.destroy({
          removeVolumes: args.clean,
          timeout: Math.min(args.timeout || 60, 30) // Max 30 seconds for force stop
        });
        
        const cleanupTime = Date.now() - startTime;
        console.log(`   ✅ Services force stopped (${Math.round(cleanupTime / 1000)}s)`);
        
        if (args.clean) {
          console.log('   🧹 Data volumes removed');
        }
        
        return {
          success: true,
          cleanupTime,
          servicesRemoved: servicesBefore,
          errors: []
        };
      }

      // Attempt graceful shutdown
      console.log('   ⏳ Stopping services gracefully...');
      
      await orchestrator.destroy({
        removeVolumes: args.clean,
        timeout: args.timeout || 60
      });
      
      const cleanupTime = Date.now() - startTime;
      console.log(`   ✅ Services stopped gracefully (${Math.round(cleanupTime / 1000)}s)`);
      
      if (args.clean) {
        console.log('   🧹 Data volumes removed');
      }
      
      return {
        success: true,
        cleanupTime,
        servicesRemoved: servicesBefore,
        errors: []
      };

      // This shouldn't be reached, but just in case
      throw new Error('Cleanup method not determined');
      
    } catch (error) {
      const cleanupTime = Date.now() - startTime;
      console.log(`   ❌ Cleanup failed (${Math.round(cleanupTime / 1000)}s)`);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      return {
        success: false,
        cleanupTime,
        servicesRemoved: 0,
        errors: [errorMessage]
      };
    }
  }

  private formatSuccessMessage(result: any, args: any): string {
    const cleanupTime = Math.round(result.cleanupTime / 1000);
    
    let message = `🎉 OTP infrastructure cleanup completed!\n`;
    message += `   Services stopped: ${result.servicesRemoved}\n`;
    message += `   Time: ${cleanupTime} seconds\n`;
    
    if (args.clean) {
      message += `   Data volumes: Removed\n`;
    } else {
      message += `   Data volumes: Preserved\n`;
    }
    
    if (args.force) {
      message += `   Method: Force stop\n`;
    } else {
      message += `   Method: Graceful shutdown\n`;
    }
    
    message += `\n💡 Use 'otp up' to start the infrastructure again`;
    
    if (!args.clean) {
      message += `\n💡 Use 'otp down --clean' to remove data volumes`;
    }
    
    return message;
  }
}