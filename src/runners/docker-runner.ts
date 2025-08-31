/**
 * Docker-based test runner implementation
 */

import { spawn } from 'child_process';
import path from 'path';
import * as fs from 'fs/promises';
import { BaseRunner, RunnerExecutionResult } from './base-runner';
import { RunnerDefinition } from '../config/types';
import {
  ValidationResult,
  RunOptions,
  RunnerExecutionContext,
  ProgressCallback,
  RunnerCapability
} from './types';

export class DockerRunner extends BaseRunner {
  constructor(name: string, definition: RunnerDefinition) {
    super(name, definition);
  }

  /**
   * Execute the test runner in a Docker container
   */
  async execute(
    context: RunnerExecutionContext,
    progressCallback: ProgressCallback
  ): Promise<RunnerExecutionResult> {
    this.logger.info(`Executing Docker runner: ${this.name}`);

    progressCallback({
      type: 'start',
      runId: context.runId,
      suite: context.suite,
      message: `Starting Docker container for ${this.name}`
    });

    try {
      const dockerArgs = await this.buildDockerArgs(context);
      const command = dockerArgs[0];
      const args = dockerArgs.slice(1);

      return new Promise((resolve, reject) => {
        const process = spawn(command, args, {
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
          this.logger.warn(`Docker stderr: ${chunk.trim()}`);
        });

        process.on('close', (code) => {
          const success = code === 0;
          
          if (!success && error) {
            // Check if the error is related to workspace mounting
            const enhancedError = this.enhanceDockerMountError(error, context);
            if (enhancedError !== error) {
              // Error was enhanced, update the error message
              error = enhancedError;
            }
          }
          
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
            artifacts: this.extractArtifacts(output, context)
          });
        });

        process.on('error', (err) => {
          const enhancedError = this.enhanceDockerError(err, context);
          
          progressCallback({
            type: 'error',
            runId: context.runId,
            suite: context.suite,
            message: enhancedError.message
          });

          reject(enhancedError);
        });

        // Set timeout
        setTimeout(() => {
          if (!process.killed) {
            process.kill('SIGTERM');
            reject(new Error(`Docker execution timed out after ${this.definition.timeout}ms`));
          }
        }, this.definition.timeout);
      });

    } catch (error) {
      progressCallback({
        type: 'error',
        runId: context.runId,
        suite: context.suite,
        message: `Failed to start Docker container: ${error instanceof Error ? error.message : 'Unknown error'}`
      });

      throw error;
    }
  }

  /**
   * Docker-specific validation
   */
  public async validateSpecific(): Promise<ValidationResult> {
    const errors: any[] = [];
    const warnings: any[] = [];

    // Validate Docker image is specified
    if (!this.definition.image) {
      errors.push({
        field: 'image',
        message: 'Docker image is required for docker runner type',
        code: 'MISSING_IMAGE'
      });
    }

    // Check if Docker is available
    try {
      const { execSync } = await import('child_process');
      execSync('docker --version', { stdio: 'ignore' });
    } catch {
      errors.push({
        field: 'docker',
        message: 'Docker is not available or not installed',
        code: 'DOCKER_NOT_AVAILABLE'
      });
    }

    // Validate volumes format
    if (this.definition.volumes) {
      for (const volume of this.definition.volumes) {
        if (!volume.includes(':')) {
          warnings.push({
            field: 'volumes',
            message: `Volume mapping should include host:container format: ${volume}`,
            code: 'INVALID_VOLUME_FORMAT'
          });
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Docker-specific environment setup
   */
  public async setupSpecific(options: RunOptions): Promise<void> {
    // Pull Docker image if needed
    if (this.definition.image) {
      try {
        const { execSync } = await import('child_process');
        this.logger.debug(`Pulling Docker image: ${this.definition.image}`);
        execSync(`docker pull ${this.definition.image}`, { stdio: 'pipe' });
      } catch (error) {
        this.logger.warn(`Failed to pull Docker image ${this.definition.image}:`, error);
      }
    }
  }

  /**
   * Get Docker-specific capabilities
   */
  protected async getCapabilities(): Promise<RunnerCapability[]> {
    const capabilities = await super.getCapabilities();
    
    capabilities.push(
      {
        name: 'docker-isolation',
        supported: true
      },
      {
        name: 'volume-mounting',
        supported: !!this.definition.volumes
      },
      {
        name: 'network-isolation',
        supported: true
      }
    );

    return capabilities;
  }

  /**
   * Validate and resolve workspace path for mounting
   */
  private async validateAndResolveWorkspacePath(workingDirectory: string): Promise<string> {
    try {
      // Resolve path to absolute path for cross-platform compatibility
      const resolvedPath = path.resolve(workingDirectory);
      
      // Validate that the directory exists and is accessible
      await fs.access(resolvedPath, fs.constants.R_OK);
      
      // Additional check to ensure it's a directory
      const stats = await fs.stat(resolvedPath);
      if (!stats.isDirectory()) {
        throw new Error(`Workspace mount failed: path '${resolvedPath}' is not a directory`);
      }
      
      this.logger.debug(`Workspace path validated and resolved: ${resolvedPath}`);
      return resolvedPath;
    } catch (error) {
      // Enhanced error handling with specific messages and solutions
      const resolvedPath = path.resolve(workingDirectory);
      
      if (error instanceof Error) {
        const nodeError = error as NodeJS.ErrnoException;
        
        if (nodeError.code === 'ENOENT') {
          const errorMsg = `Workspace mount failed: directory '${resolvedPath}' does not exist.\n` +
            `Suggestions:\n` +
            `  - Verify the working directory path is correct\n` +
            `  - Ensure the directory exists before running tests\n` +
            `  - Check if the path was moved or deleted`;
          this.logger.error(errorMsg);
          throw new Error(errorMsg);
        } else if (nodeError.code === 'EACCES') {
          const errorMsg = `Workspace mount failed: permission denied accessing directory '${resolvedPath}'.\n` +
            `Suggestions:\n` +
            `  - Check directory permissions (should be readable)\n` +
            `  - Run with appropriate user permissions\n` +
            `  - On Windows, ensure the drive is accessible to Docker\n` +
            `  - On Linux/macOS, check file ownership and permissions`;
          this.logger.error(errorMsg);
          throw new Error(errorMsg);
        } else if (nodeError.code === 'EPERM') {
          const errorMsg = `Workspace mount failed: operation not permitted on directory '${resolvedPath}'.\n` +
            `Suggestions:\n` +
            `  - Check if Docker has permission to access the directory\n` +
            `  - On Windows, ensure Docker Desktop has access to the drive\n` +
            `  - Try running as administrator/root if necessary`;
          this.logger.error(errorMsg);
          throw new Error(errorMsg);
        } else {
          // Handle other file system errors
          const errorMsg = `Workspace mount failed: cannot access directory '${resolvedPath}' - ${error.message}.\n` +
            `Suggestions:\n` +
            `  - Verify the path exists and is accessible\n` +
            `  - Check file system permissions\n` +
            `  - Ensure Docker has access to the directory`;
          this.logger.error(errorMsg);
          throw new Error(errorMsg);
        }
      }
      
      // Fallback for non-Error objects
      const errorMsg = `Workspace mount failed: unknown error accessing directory '${resolvedPath}'`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  /**
   * Build Docker command arguments
   */
  private async buildDockerArgs(context: RunnerExecutionContext): Promise<string[]> {
    const args = ['docker', 'run', '--rm'];

    // Add environment variables
    const env = this.buildEnvironment(context);
    for (const [key, value] of Object.entries(env)) {
      args.push('-e', `${key}=${value}`);
    }

    // Add volume mounts
    if (this.definition.volumes) {
      for (const volume of this.definition.volumes) {
        args.push('-v', volume);
      }
    }

    // Add workspace mount with validation and cross-platform path resolution
    try {
      const workspacePath = await this.validateAndResolveWorkspacePath(context.workingDirectory);
      args.push('-v', `${workspacePath}:/workspace`);
      this.logger.debug(`Added workspace mount: ${workspacePath}:/workspace`);
    } catch (error) {
      // Re-throw with additional context about the Docker args building process
      if (error instanceof Error) {
        throw new Error(`Failed to build Docker arguments for workspace mounting: ${error.message}`);
      }
      throw error;
    }

    // Add output directory mount
    args.push('-v', `${context.outputDirectory}:/test-results`);

    // Add working directory
    args.push('-w', '/workspace');

    // Add image
    if (this.definition.image) {
      args.push(this.definition.image);
    }

    // Add command
    args.push(...this.buildCommandArgs(context));

    return args;
  }

  /**
   * Enhance Docker process errors with workspace mounting context
   */
  private enhanceDockerError(error: Error, context: RunnerExecutionContext): Error {
    const errorMessage = error.message.toLowerCase();
    
    // Check for common Docker errors that might be related to workspace mounting
    if (errorMessage.includes('enoent') || errorMessage.includes('no such file')) {
      return new Error(
        `Docker execution failed: ${error.message}\n` +
        `This might be related to workspace mounting. Ensure:\n` +
        `  - Docker is installed and running\n` +
        `  - The workspace directory '${context.workingDirectory}' is accessible\n` +
        `  - Docker has permission to mount the workspace directory`
      );
    }
    
    if (errorMessage.includes('permission denied') || errorMessage.includes('access denied')) {
      return new Error(
        `Docker execution failed: ${error.message}\n` +
        `This appears to be a permission issue. Suggestions:\n` +
        `  - Ensure Docker has permission to access the workspace directory\n` +
        `  - On Windows, check Docker Desktop drive sharing settings\n` +
        `  - On Linux/macOS, verify Docker daemon permissions`
      );
    }
    
    // Return original error if no specific enhancement applies
    return error;
  }

  /**
   * Enhance Docker stderr output with workspace mounting context
   */
  private enhanceDockerMountError(stderr: string, context: RunnerExecutionContext): string {
    const errorLower = stderr.toLowerCase();
    
    // Check for Docker mount-related errors in stderr
    if (errorLower.includes('invalid mount config') || 
        errorLower.includes('mount denied') ||
        errorLower.includes('no such file or directory') && errorLower.includes('mount')) {
      return `${stderr}\n\n` +
        `Workspace mounting error detected. This error occurred while trying to mount '${context.workingDirectory}' to '/workspace'.\n` +
        `Troubleshooting steps:\n` +
        `  1. Verify the workspace directory exists and is accessible\n` +
        `  2. Check Docker has permission to access the directory\n` +
        `  3. On Windows: Ensure the drive is shared with Docker Desktop\n` +
        `  4. On Linux/macOS: Check directory permissions and Docker daemon access\n` +
        `  5. Try running with elevated permissions if necessary`;
    }
    
    if (errorLower.includes('permission denied') && 
        (errorLower.includes('mount') || errorLower.includes('volume'))) {
      return `${stderr}\n\n` +
        `Docker permission error detected for workspace mounting.\n` +
        `The workspace directory '${context.workingDirectory}' cannot be mounted due to permission restrictions.\n` +
        `Solutions:\n` +
        `  - On Windows: Enable drive sharing in Docker Desktop settings\n` +
        `  - On Linux: Ensure your user is in the 'docker' group or run with sudo\n` +
        `  - On macOS: Check Docker Desktop has Full Disk Access permission\n` +
        `  - Verify the directory is not on a restricted file system`;
    }
    
    if (errorLower.includes('invalid argument') && errorLower.includes('mount')) {
      return `${stderr}\n\n` +
        `Docker mount argument error detected.\n` +
        `The workspace path '${context.workingDirectory}' may contain invalid characters or format.\n` +
        `Solutions:\n` +
        `  - Ensure the path doesn't contain unsupported characters\n` +
        `  - On Windows: Use forward slashes or properly escaped backslashes\n` +
        `  - Verify the path format is compatible with Docker volume mounting`;
    }
    
    // Return original stderr if no specific enhancement applies
    return stderr;
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
      /Output file: (.+)/g
    ];

    for (const pattern of artifactPatterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        artifacts.push(match[1]);
      }
    }

    return artifacts;
  }
}