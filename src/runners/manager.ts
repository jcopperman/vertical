/**
 * Test Runner Manager - Coordinates test execution across different runner types
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';
import { OTPConfig, RunnerDefinition } from '../config/types';
import {
  TestRunnerManager as ITestRunnerManager,
  RunOptions,
  TestResult,
  RunnerStatus,
  ValidationResult,
  RunnerExecutionContext,
  ProgressCallback,
  ProgressEvent,
  TestSummary
} from './types';
import { DockerRunner } from './docker-runner';
import { LocalRunner } from './local-runner';
import { KubernetesRunner } from './k8s-runner';

export class TestRunnerManager implements ITestRunnerManager {
  private logger = createLogger('TestRunnerManager');
  private runners = new Map<string, any>();
  private activeRuns = new Map<string, RunnerExecutionContext>();

  constructor(private config: OTPConfig) {
    this.initializeRunners();
  }

  /**
   * Initialize runners based on configuration
   */
  private initializeRunners(): void {
    for (const [name, definition] of Object.entries(this.config.runners)) {
      try {
        const runner = this.createRunner(name, definition);
        this.runners.set(name, runner);
        this.logger.debug(`Initialized runner: ${name} (${definition.type})`);
      } catch (error) {
        this.logger.error(`Failed to initialize runner ${name}:`, error);
      }
    }
  }

  /**
   * Create a runner instance based on type
   */
  private createRunner(name: string, definition: RunnerDefinition): any {
    switch (definition.type) {
      case 'docker':
        return new DockerRunner(name, definition);
      case 'local':
        return new LocalRunner(name, definition);
      case 'k8s':
        return new KubernetesRunner(name, definition);
      default:
        throw new Error(`Unsupported runner type: ${definition.type}`);
    }
  }

  /**
   * Run a test suite with the specified options
   */
  async runSuite(suite: string, options: RunOptions): Promise<TestResult> {
    const runId = uuidv4();
    const startTime = new Date();

    this.logger.info(`Starting test run ${runId} for suite: ${suite}`);

    try {
      // Validate runner exists
      const runner = this.runners.get(suite);
      if (!runner) {
        throw new Error(`Runner not found for suite: ${suite}`);
      }

      // Validate runner configuration
      const validation = await this.validateRunner(suite);
      if (!validation.valid) {
        throw new Error(`Runner validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
      }

      // Setup execution context
      const context = await this.createExecutionContext(runId, suite, options);
      this.activeRuns.set(runId, context);

      // Setup environment
      await this.setupEnvironment(suite, options);

      // Execute the test suite
      const result = await runner.execute(context, this.createProgressCallback(runId));

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      const testResult: TestResult = {
        runId,
        suite,
        status: result.success ? 'passed' : 'failed',
        summary: result.summary || this.createEmptySummary(),
        artifacts: result.artifacts || [],
        traceId: result.traceId,
        startTime,
        endTime,
        duration
      };

      this.logger.info(`Test run ${runId} completed with status: ${testResult.status}`);
      return testResult;

    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.logger.error(`Test run ${runId} failed:`, error);

      return {
        runId,
        suite,
        status: 'error',
        summary: this.createEmptySummary(),
        artifacts: [],
        startTime,
        endTime,
        duration
      };
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  /**
   * List all available test suites
   */
  async listAvailableSuites(): Promise<string[]> {
    const suites: string[] = [];

    for (const [name, runner] of this.runners) {
      try {
        const status = await runner.getStatus();
        if (status.available) {
          suites.push(name);
        }
      } catch (error) {
        this.logger.warn(`Failed to check status for runner ${name}:`, error);
      }
    }

    return suites.sort();
  }

  /**
   * Get the status of a specific runner
   */
  async getRunnerStatus(suite: string): Promise<RunnerStatus> {
    const runner = this.runners.get(suite);
    if (!runner) {
      return {
        name: suite,
        available: false,
        healthy: false,
        capabilities: [],
        issues: [`Runner not found: ${suite}`]
      };
    }

    try {
      return await runner.getStatus();
    } catch (error) {
      this.logger.error(`Failed to get status for runner ${suite}:`, error);
      return {
        name: suite,
        available: false,
        healthy: false,
        capabilities: [],
        issues: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  /**
   * Validate a runner configuration
   */
  async validateRunner(runnerName: string): Promise<ValidationResult> {
    const runner = this.runners.get(runnerName);
    if (!runner) {
      return {
        valid: false,
        errors: [{
          field: 'runner',
          message: `Runner not found: ${runnerName}`,
          code: 'RUNNER_NOT_FOUND'
        }]
      };
    }

    try {
      return await runner.validate();
    } catch (error) {
      return {
        valid: false,
        errors: [{
          field: 'validation',
          message: error instanceof Error ? error.message : 'Validation failed',
          code: 'VALIDATION_ERROR'
        }]
      };
    }
  }

  /**
   * Setup environment for test execution
   */
  async setupEnvironment(runnerName: string, options: RunOptions): Promise<void> {
    const runner = this.runners.get(runnerName);
    if (!runner) {
      throw new Error(`Runner not found: ${runnerName}`);
    }

    try {
      await runner.setupEnvironment(options);
      this.logger.debug(`Environment setup completed for runner: ${runnerName}`);
    } catch (error) {
      this.logger.error(`Environment setup failed for runner ${runnerName}:`, error);
      throw error;
    }
  }

  /**
   * Create execution context for a test run
   */
  private async createExecutionContext(
    runId: string,
    suite: string,
    options: RunOptions
  ): Promise<RunnerExecutionContext> {
    const workingDirectory = process.cwd();
    const outputDirectory = `${workingDirectory}/test-results/${runId}`;

    // Merge environment variables
    const environment: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...options.environment,
      OTP_RUN_ID: runId,
      OTP_SUITE: suite,
      OTP_TARGET: options.target,
      OTP_OUTPUT_DIR: outputDirectory
    };

    if (options.tags) {
      environment.OTP_TAGS = options.tags;
    }

    return {
      runId,
      suite,
      runner: suite,
      options,
      environment,
      workingDirectory,
      outputDirectory
    };
  }

  /**
   * Create progress callback for test execution
   */
  private createProgressCallback(runId: string): ProgressCallback {
    return (event: ProgressEvent) => {
      this.logger.debug(`Progress event for run ${runId}:`, event);
      // TODO: Implement progress streaming to console or external systems
    };
  }

  /**
   * Create empty test summary
   */
  private createEmptySummary(): TestSummary {
    return {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: 0
    };
  }

  /**
   * Get active test runs
   */
  getActiveRuns(): RunnerExecutionContext[] {
    return Array.from(this.activeRuns.values());
  }

  /**
   * Cancel a running test
   */
  async cancelRun(runId: string): Promise<boolean> {
    const context = this.activeRuns.get(runId);
    if (!context) {
      return false;
    }

    const runner = this.runners.get(context.suite);
    if (!runner || !runner.cancel) {
      return false;
    }

    try {
      await runner.cancel(runId);
      this.activeRuns.delete(runId);
      this.logger.info(`Test run ${runId} cancelled`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to cancel run ${runId}:`, error);
      return false;
    }
  }
}