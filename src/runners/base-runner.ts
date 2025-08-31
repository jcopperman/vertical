/**
 * Base runner class providing common functionality for all test runners
 */

import { createLogger } from '../utils/logger';
import { RunnerDefinition } from '../config/types';
import {
  RunnerStatus,
  ValidationResult,
  RunOptions,
  RunnerExecutionContext,
  ProgressCallback,
  RunnerCapability
} from './types';

export interface RunnerExecutionResult {
  success: boolean;
  summary?: any;
  artifacts?: string[];
  traceId?: string;
  output?: string;
  error?: string;
}

export abstract class BaseRunner {
  protected logger = createLogger(this.constructor.name);

  constructor(
    protected name: string,
    protected definition: RunnerDefinition
  ) {}

  /**
   * Execute the test runner
   */
  abstract execute(
    context: RunnerExecutionContext,
    progressCallback: ProgressCallback
  ): Promise<RunnerExecutionResult>;

  /**
   * Get the current status of the runner
   */
  async getStatus(): Promise<RunnerStatus> {
    try {
      const capabilities = await this.getCapabilities();
      const healthy = await this.checkHealth();

      return {
        name: this.name,
        available: true,
        healthy,
        capabilities,
        version: await this.getVersion()
      };
    } catch (error) {
      return {
        name: this.name,
        available: false,
        healthy: false,
        capabilities: [],
        issues: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  /**
   * Validate the runner configuration
   */
  async validate(): Promise<ValidationResult> {
    const errors: any[] = [];

    // Validate basic configuration
    if (!this.definition.command || this.definition.command.length === 0) {
      errors.push({
        field: 'command',
        message: 'Command is required',
        code: 'MISSING_COMMAND'
      });
    }

    if (this.definition.timeout <= 0) {
      errors.push({
        field: 'timeout',
        message: 'Timeout must be positive',
        code: 'INVALID_TIMEOUT'
      });
    }

    // Perform runner-specific validation
    const specificValidation = await this.validateSpecific();
    errors.push(...specificValidation.errors);

    return {
      valid: errors.length === 0,
      errors,
      warnings: specificValidation.warnings
    };
  }

  /**
   * Setup environment for test execution
   */
  async setupEnvironment(options: RunOptions): Promise<void> {
    this.logger.debug(`Setting up environment for runner: ${this.name}`);
    
    // Create output directory if needed
    if (options.environment?.OTP_OUTPUT_DIR) {
      const fs = await import('fs/promises');
      await fs.mkdir(options.environment.OTP_OUTPUT_DIR, { recursive: true });
    }

    // Perform runner-specific setup
    await this.setupSpecific(options);
  }

  /**
   * Cancel a running test
   */
  async cancel(runId: string): Promise<void> {
    this.logger.info(`Cancelling run: ${runId}`);
    // Default implementation - can be overridden by subclasses
  }

  /**
   * Get runner capabilities
   */
  protected async getCapabilities(): Promise<RunnerCapability[]> {
    return [
      {
        name: 'basic-execution',
        supported: true
      }
    ];
  }

  /**
   * Check if the runner is healthy
   */
  protected async checkHealth(): Promise<boolean> {
    try {
      // Basic health check - verify command exists
      const { execSync } = await import('child_process');
      const command = this.definition.command[0];
      
      if (this.definition.type === 'local') {
        execSync(`which ${command}`, { stdio: 'ignore' });
      }
      
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get runner version
   */
  protected async getVersion(): Promise<string | undefined> {
    try {
      const { execSync } = await import('child_process');
      const command = this.definition.command[0];
      const output = execSync(`${command} --version`, { 
        encoding: 'utf8',
        timeout: 5000,
        stdio: 'pipe'
      });
      return output.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * Runner-specific validation
   */
  public abstract validateSpecific(): Promise<ValidationResult>;

  /**
   * Runner-specific environment setup
   */
  public abstract setupSpecific(options: RunOptions): Promise<void>;

  /**
   * Build command arguments
   */
  protected buildCommandArgs(context: RunnerExecutionContext): string[] {
    const args = [...this.definition.command];
    
    // Add common arguments
    if (context.options.tags) {
      args.push('--tags', context.options.tags);
    }
    
    if (context.options.parallel) {
      args.push('--parallel');
    }
    
    if (context.options.dryRun) {
      args.push('--dry-run');
    }

    return args;
  }

  /**
   * Build environment variables
   */
  protected buildEnvironment(context: RunnerExecutionContext): Record<string, string> {
    return {
      ...this.definition.environment,
      ...context.environment
    };
  }
}