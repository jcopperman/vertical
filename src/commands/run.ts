/**
 * Run command - Execute test suites through the OTP platform
 */

import { BaseCommand } from './base';
import { CommandContext, CommandResult, CommandOption } from './types';
import { ConfigurationManager, DefaultConfigurationManager } from '../config/manager';
import { TestRunnerManager } from '../runners/manager';
import { RunOptions, TestResult, ProgressEvent } from '../runners/types';
import { OTPConfig } from '../config/types';
import { DefaultReportManager, ReportManager, ProcessedResult } from '../reporting';

export class RunCommand extends BaseCommand {
  public readonly name = 'run';
  public readonly description = 'Execute test suites';
  public readonly usage = '<suite> [options]';
  public readonly aliases = ['test', 'execute'];
  public readonly examples = [
    'otp run api',
    'otp run e2e --target staging',
    'otp run contract --tags "smoke"',
    'otp run perf --target local --timeout 600',
    'otp run api --dry-run'
  ];

  public readonly options: CommandOption[] = [
    {
      flags: '--target <environment>',
      description: 'Target environment to run tests against (local, dev, staging, prod)',
      required: false,
      defaultValue: 'local'
    },
    {
      flags: '--tags <criteria>',
      description: 'Filter tests by tag criteria (e.g., "smoke", "regression", "!slow")',
      required: false
    },
    {
      flags: '--parallel',
      description: 'Run tests in parallel when supported',
      required: false
    },
    {
      flags: '--timeout <seconds>',
      description: 'Test execution timeout in seconds (default: 300)',
      required: false,
      defaultValue: 300
    },
    {
      flags: '--dry-run',
      description: 'Show what would be executed without running tests',
      required: false
    },
    {
      flags: '--env <key=value>',
      description: 'Set environment variables for test execution (can be used multiple times)',
      required: false
    },
    {
      flags: '--output-dir <path>',
      description: 'Directory for test output and artifacts',
      required: false
    },
    {
      flags: '--no-progress',
      description: 'Disable progress reporting during execution',
      required: false
    }
  ];

  private configManager: ConfigurationManager;
  private runnerManager?: TestRunnerManager;
  private reportManager?: ReportManager;

  constructor(configManager?: ConfigurationManager) {
    super();
    this.configManager = configManager || new DefaultConfigurationManager();
  }

  public async execute(args: any, context: CommandContext): Promise<CommandResult> {
    try {
      this.validateArgs(args);

      const suite = args._[0];
      if (!suite) {
        return this.failure('Suite name is required. Use: otp run <suite>');
      }

      // Load configuration
      const profile = context.profile;
      this.logger.info(`Executing test suite: ${suite}`, { profile, target: args.target });

      const config = await this.configManager.loadConfig(profile);
      
      // Validate configuration
      const validation = await this.configManager.validateConfig(config);
      if (!validation.valid) {
        const errorMessages = validation.errors.map(e => `${e.path}: ${e.message}`).join('\n');
        return this.failure(`Configuration validation failed:\n${errorMessages}`);
      }

      // Initialize runner manager and report manager
      this.runnerManager = new TestRunnerManager(config);
      this.reportManager = new DefaultReportManager(config);

      // Check if suite exists
      const availableSuites = await this.runnerManager.listAvailableSuites();
      if (!availableSuites.includes(suite)) {
        return this.failure(
          `Suite '${suite}' not found.\nAvailable suites: ${availableSuites.join(', ')}`
        );
      }

      // Validate runner
      const runnerValidation = await this.runnerManager.validateRunner(suite);
      if (!runnerValidation.valid) {
        const errorMessages = runnerValidation.errors.map(e => e.message).join('\n');
        return this.failure(`Runner validation failed:\n${errorMessages}`);
      }

      // Build run options
      const runOptions = this.buildRunOptions(args, config);

      // Show execution plan
      console.log('DEBUG: Checking dry-run:', args.dryRun, args['dry-run'], args);
      if (args.dryRun || args['dry-run']) {
        return this.showExecutionPlan(suite, runOptions, config, true);
      }

      this.showExecutionPlan(suite, runOptions, config, false);

      // Execute test suite with progress reporting
      const result = await this.executeWithProgress(suite, runOptions);

      // Process and publish results
      const processedResult = await this.processResult(result);

      // Format and return results
      return this.formatTestResult(processedResult);

    } catch (error) {
      this.logger.error('Run command failed', error);
      return this.error(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  protected validateArgs(args: any): void {
    if (args.timeout !== undefined && (isNaN(args.timeout) || args.timeout <= 0)) {
      throw new Error('Timeout must be a positive number');
    }

    if (args.target && !['local', 'dev', 'staging', 'prod'].includes(args.target)) {
      throw new Error('Target must be one of: local, dev, staging, prod');
    }

    // Validate environment variables format
    if (args.env) {
      const envVars = Array.isArray(args.env) ? args.env : [args.env];
      for (const envVar of envVars) {
        if (typeof envVar === 'string' && !envVar.includes('=')) {
          throw new Error(`Invalid environment variable format: ${envVar}. Use KEY=VALUE format.`);
        }
      }
    }
  }

  private buildRunOptions(args: any, config: OTPConfig): RunOptions {
    const options: RunOptions = {
      target: args.target || 'local',
      timeout: (args.timeout || 300) * 1000, // Convert to milliseconds
      parallel: args.parallel || false,
      dryRun: args.dryRun || false
    };

    // Add tags if specified
    if (args.tags) {
      options.tags = args.tags;
    }

    // Build environment variables
    const environment: Record<string, string> = {};
    
    // Add environment variables from config
    const runnerConfig = config.runners[args._[0]];
    if (runnerConfig?.environment) {
      Object.assign(environment, runnerConfig.environment);
    }

    // Add environment variables from command line
    if (args.env) {
      const envVars = Array.isArray(args.env) ? args.env : [args.env];
      for (const envVar of envVars) {
        if (typeof envVar === 'string') {
          const [key, ...valueParts] = envVar.split('=');
          const value = valueParts.join('=');
          environment[key] = value;
        }
      }
    }

    // Add target-specific environment variables
    environment.OTP_TARGET = options.target;
    environment.OTP_PROFILE = config.profile;

    if (args.outputDir) {
      environment.OTP_OUTPUT_DIR = args.outputDir;
    }

    options.environment = environment;

    return options;
  }

  private showExecutionPlan(
    suite: string, 
    options: RunOptions, 
    config: OTPConfig, 
    dryRun: boolean = true
  ): CommandResult {
    const runnerConfig = config.runners[suite];
    
    console.log(`\n🧪 ${dryRun ? 'Execution Plan (Dry Run)' : 'Test Execution Plan'}:`);
    console.log(`   Suite: ${suite}`);
    console.log(`   Target: ${options.target}`);
    console.log(`   Runner Type: ${runnerConfig.type}`);
    
    if (options.tags) {
      console.log(`   Tags: ${options.tags}`);
    }
    
    console.log(`   Parallel: ${options.parallel ? 'Yes' : 'No'}`);
    console.log(`   Timeout: ${Math.round((options.timeout || 0) / 1000)}s`);
    
    if (runnerConfig.command && runnerConfig.command.length > 0) {
      console.log(`   Command: ${runnerConfig.command.join(' ')}`);
    }
    
    if (options.environment && Object.keys(options.environment).length > 0) {
      console.log(`   Environment Variables:`);
      Object.entries(options.environment).forEach(([key, value]) => {
        // Mask sensitive values
        const maskedValue = key.toLowerCase().includes('password') || 
                           key.toLowerCase().includes('token') || 
                           key.toLowerCase().includes('secret') 
                           ? '***' : value;
        console.log(`     ${key}=${maskedValue}`);
      });
    }
    
    if (dryRun) {
      console.log('\n💡 Use --no-dry-run or remove --dry-run to execute the tests');
      return this.success('Dry run completed');
    }
    
    console.log('');
    return this.success('Execution plan displayed');
  }

  private async executeWithProgress(suite: string, options: RunOptions): Promise<TestResult> {
    if (!this.runnerManager) {
      throw new Error('Runner manager not initialized');
    }

    console.log('🚀 Starting test execution...');
    
    const startTime = Date.now();
    let lastProgressTime = startTime;
    
    try {
      // Setup progress callback if not disabled
      const showProgress = !options.dryRun; // We can add a --no-progress flag later
      
      if (showProgress) {
        console.log('   📋 Preparing test environment...');
      }

      // Execute the test suite
      const result = await this.runnerManager.runSuite(suite, options);
      
      const totalTime = Math.round((Date.now() - startTime) / 1000);
      
      if (showProgress) {
        console.log(`   ✅ Test execution completed (${totalTime}s)`);
      }
      
      return result;
    } catch (error) {
      const totalTime = Math.round((Date.now() - startTime) / 1000);
      console.log(`   ❌ Test execution failed (${totalTime}s)`);
      throw error;
    }
  }

  private async processResult(result: TestResult): Promise<ProcessedResult> {
    if (!this.reportManager) {
      throw new Error('Report manager not initialized');
    }

    try {
      console.log('📊 Processing test results...');
      
      // Process and publish the result
      const processedResult = await this.reportManager.processAndPublishResult(result);
      
      console.log('   ✅ Results processed and published');
      return processedResult;
      
    } catch (error) {
      this.logger.warn('Failed to process/publish results, continuing with basic result:', error);
      
      // Fallback to basic processing if API fails
      const basicProcessed: ProcessedResult = {
        ...result,
        processed: false,
        processedAt: new Date(),
        metadata: {
          environment: process.env.OTP_TARGET || 'local',
          profile: process.env.OTP_PROFILE || 'local',
          hostname: require('os').hostname(),
          platform: require('os').platform(),
          nodeVersion: process.version
        },
        enrichedSummary: {
          ...result.summary,
          passRate: result.summary.total > 0 ? (result.summary.passed / result.summary.total) * 100 : 0,
          failureRate: result.summary.total > 0 ? (result.summary.failed / result.summary.total) * 100 : 0,
          executionRate: result.summary.total > 0 ? 
            ((result.summary.passed + result.summary.failed) / result.summary.total) * 100 : 0
        }
      };
      
      return basicProcessed;
    }
  }

  private formatTestResult(result: ProcessedResult): CommandResult {
    const { enrichedSummary, status, duration } = result;
    const executionTime = Math.round(duration / 1000);
    
    // Determine overall success
    const success = status === 'passed';
    const exitCode = success ? 0 : 1;
    
    // Build result message using enhanced summary
    let message = `\n📊 Test Results (Run ID: ${result.runId}):\n`;
    message += `   Suite: ${result.suite}\n`;
    message += `   Status: ${this.formatStatus(status)}\n`;
    message += `   Duration: ${executionTime}s\n`;
    message += `\n📈 Enhanced Summary:\n`;
    message += `   Total: ${enrichedSummary.total}\n`;
    message += `   Passed: ${enrichedSummary.passed} ✅ (${enrichedSummary.passRate.toFixed(1)}%)\n`;
    message += `   Failed: ${enrichedSummary.failed} ❌ (${enrichedSummary.failureRate.toFixed(1)}%)\n`;
    message += `   Skipped: ${enrichedSummary.skipped} ⏭️\n`;
    
    if (enrichedSummary.errors > 0) {
      message += `   Errors: ${enrichedSummary.errors} 💥\n`;
    }
    
    // Add performance metrics if available
    if (enrichedSummary.performance) {
      message += `\n⚡ Performance:\n`;
      message += `   Average Test Duration: ${enrichedSummary.performance.averageTestDuration}ms\n`;
      message += `   Throughput: ${enrichedSummary.performance.throughput} tests/second\n`;
    }
    
    // Add coverage information if available
    if (enrichedSummary.coverage) {
      message += `\n📋 Coverage:\n`;
      message += `   Lines: ${enrichedSummary.coverage.lines}%\n`;
      message += `   Functions: ${enrichedSummary.coverage.functions}%\n`;
      message += `   Branches: ${enrichedSummary.coverage.branches}%\n`;
      message += `   Statements: ${enrichedSummary.coverage.statements}%\n`;
    }
    
    // Add artifacts information
    if (result.artifacts.length > 0) {
      message += `\n📁 Artifacts (${result.artifacts.length}):\n`;
      result.artifacts.forEach(artifact => {
        message += `   ${artifact}\n`;
      });
    }
    
    // Add metadata if processed
    if (result.processed) {
      message += `\n🏷️  Environment: ${result.metadata.environment} (${result.metadata.profile})\n`;
    }
    
    // Add trace information if available
    if (result.traceId) {
      message += `\n🔍 Trace ID: ${result.traceId}\n`;
    }
    
    // Add next steps
    message += `\n💡 Next steps:\n`;
    message += `   View detailed results: otp report open --run-id ${result.runId}\n`;
    message += `   Check service logs: otp logs <service>\n`;
    
    if (!success) {
      message += `   Debug failed tests: Check artifacts and logs above\n`;
    }

    return {
      success,
      message,
      exitCode,
      data: {
        runId: result.runId,
        suite: result.suite,
        status: result.status,
        summary: result.enrichedSummary,
        duration: result.duration,
        artifacts: result.artifacts,
        traceId: result.traceId,
        processed: result.processed,
        metadata: result.metadata
      }
    };
  }

  private formatStatus(status: string): string {
    const statusEmojis: Record<string, string> = {
      'passed': '✅ PASSED',
      'failed': '❌ FAILED', 
      'error': '💥 ERROR',
      'skipped': '⏭️ SKIPPED'
    };
    
    return statusEmojis[status] || `❓ ${status.toUpperCase()}`;
  }

  /**
   * Get available test suites for help/completion
   */
  public async getAvailableSuites(config?: OTPConfig): Promise<string[]> {
    try {
      if (!config) {
        config = await this.configManager.loadConfig();
      }
      
      const runnerManager = new TestRunnerManager(config);
      return await runnerManager.listAvailableSuites();
    } catch (error) {
      this.logger.debug('Could not get available suites', error);
      return [];
    }
  }
}