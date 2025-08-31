/**
 * Local process-based test runner implementation
 */

import { spawn } from 'child_process';
import { BaseRunner, RunnerExecutionResult } from './base-runner';
import { RunnerDefinition } from '../config/types';
import {
  ValidationResult,
  RunOptions,
  RunnerExecutionContext,
  ProgressCallback,
  RunnerCapability
} from './types';

export class LocalRunner extends BaseRunner {
  constructor(name: string, definition: RunnerDefinition) {
    super(name, definition);
  }

  /**
   * Execute the test runner as a local process
   */
  async execute(
    context: RunnerExecutionContext,
    progressCallback: ProgressCallback
  ): Promise<RunnerExecutionResult> {
    this.logger.info(`Executing local runner: ${this.name}`);

    progressCallback({
      type: 'start',
      runId: context.runId,
      suite: context.suite,
      message: `Starting local process for ${this.name}`
    });

    try {
      const args = this.buildCommandArgs(context);
      const command = args[0];
      const commandArgs = args.slice(1);

      return new Promise((resolve, reject) => {
        const process = spawn(command, commandArgs, {
          cwd: context.workingDirectory,
          env: this.buildEnvironment(context),
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let output = '';
        let error = '';

        process.stdout?.on('data', (data) => {
          const chunk = data.toString();
          output += chunk;
          
          progressCallback({
            type: 'progress',
            runId: context.runId,
            suite: context.suite,
            message: chunk.trim()
          });
        });

        process.stderr?.on('data', (data) => {
          const chunk = data.toString();
          error += chunk;
          this.logger.warn(`Process stderr: ${chunk.trim()}`);
        });

        process.on('close', (code) => {
          const success = code === 0;
          
          progressCallback({
            type: 'complete',
            runId: context.runId,
            suite: context.suite,
            message: success ? 'Test execution completed successfully' : 'Test execution failed'
          });

          resolve({
            success,
            output,
            error: error || undefined,
            artifacts: this.extractArtifacts(output, context),
            summary: this.parseSummary(output)
          });
        });

        process.on('error', (err) => {
          progressCallback({
            type: 'error',
            runId: context.runId,
            suite: context.suite,
            message: `Process execution failed: ${err.message}`
          });

          reject(err);
        });

        // Set timeout
        setTimeout(() => {
          if (!process.killed) {
            process.kill('SIGTERM');
            reject(new Error(`Process execution timed out after ${this.definition.timeout}ms`));
          }
        }, this.definition.timeout);
      });

    } catch (error) {
      progressCallback({
        type: 'error',
        runId: context.runId,
        suite: context.suite,
        message: `Failed to start process: ${error instanceof Error ? error.message : 'Unknown error'}`
      });

      throw error;
    }
  }

  /**
   * Local runner-specific validation
   */
  public async validateSpecific(): Promise<ValidationResult> {
    const errors: any[] = [];
    const warnings: any[] = [];

    // Check if command exists
    const command = this.definition.command[0];
    try {
      const { execSync } = await import('child_process');
      execSync(`which ${command}`, { stdio: 'ignore' });
    } catch {
      try {
        // Try Windows where command
        const { execSync } = await import('child_process');
        execSync(`where ${command}`, { stdio: 'ignore' });
      } catch {
        errors.push({
          field: 'command',
          message: `Command not found in PATH: ${command}`,
          code: 'COMMAND_NOT_FOUND'
        });
      }
    }

    // Validate environment variables
    if (this.definition.environment) {
      for (const [key, value] of Object.entries(this.definition.environment)) {
        if (typeof value !== 'string') {
          warnings.push({
            field: 'environment',
            message: `Environment variable ${key} should be a string`,
            code: 'INVALID_ENV_TYPE'
          });
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Local runner-specific environment setup
   */
  public async setupSpecific(options: RunOptions): Promise<void> {
    // Ensure any required directories exist
    if (options.environment?.OTP_OUTPUT_DIR) {
      const fs = await import('fs/promises');
      await fs.mkdir(options.environment.OTP_OUTPUT_DIR, { recursive: true });
    }

    // Set up any local dependencies if needed
    this.logger.debug(`Local environment setup completed for ${this.name}`);
  }

  /**
   * Get local runner-specific capabilities
   */
  protected async getCapabilities(): Promise<RunnerCapability[]> {
    const capabilities = await super.getCapabilities();
    
    capabilities.push(
      {
        name: 'native-execution',
        supported: true
      },
      {
        name: 'file-system-access',
        supported: true
      },
      {
        name: 'environment-variables',
        supported: true
      }
    );

    return capabilities;
  }

  /**
   * Extract artifacts from test output
   */
  private extractArtifacts(output: string, context: RunnerExecutionContext): string[] {
    const artifacts: string[] = [];
    
    // Look for common artifact patterns in output
    const artifactPatterns = [
      /Generated report: (.+)/g,
      /Artifact saved: (.+)/g,
      /Output file: (.+)/g,
      /Coverage report: (.+)/g,
      /Test results: (.+)/g
    ];

    for (const pattern of artifactPatterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        artifacts.push(match[1]);
      }
    }

    return artifacts;
  }

  /**
   * Parse test summary from output
   */
  private parseSummary(output: string): any {
    // Try to parse common test result formats
    const summaryPatterns = {
      jest: /Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/,
      mocha: /(\d+)\s+passing.*(\d+)\s+failing/s,
      pytest: /(\d+)\s+failed,\s+(\d+)\s+passed/
    };

    for (const [framework, pattern] of Object.entries(summaryPatterns)) {
      const match = output.match(pattern);
      if (match) {
        return {
          framework,
          raw: match[0],
          parsed: match.slice(1)
        };
      }
    }

    return null;
  }
}