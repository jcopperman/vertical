/**
 * Tests for RunCommand - Test execution command
 */

import { RunCommand } from './run';
import { CommandContext } from './types';
import { ConfigurationManager } from '../config/manager';
import { TestRunnerManager } from '../runners/manager';
import { OTPConfig, RunnerDefinition, ValidationResult as ConfigValidationResult } from '../config/types';
import { TestResult, RunOptions, ValidationResult } from '../runners/types';

// Mock dependencies
jest.mock('../config/manager');
jest.mock('../runners/manager');
jest.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  })
}));

describe('RunCommand', () => {
  let command: RunCommand;
  let mockConfigManager: jest.Mocked<ConfigurationManager>;
  let mockRunnerManager: jest.Mocked<TestRunnerManager>;
  let mockContext: CommandContext;
  let mockConfig: OTPConfig;

  beforeEach(() => {
    // Setup mocks
    mockConfigManager = {
      loadConfig: jest.fn(),
      validateConfig: jest.fn(),
      getActiveProfile: jest.fn()
    } as any;

    mockRunnerManager = {
      runSuite: jest.fn(),
      listAvailableSuites: jest.fn(),
      getRunnerStatus: jest.fn(),
      validateRunner: jest.fn(),
      setupEnvironment: jest.fn()
    } as any;

    mockContext = {
      verbose: false,
      profile: 'local',
      logger: {
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn()
      }
    };

    mockConfig = {
      version: '1.0.0',
      profile: 'local',
      infrastructure: {
        compose: {
          baseFile: 'docker-compose.yml',
          profileFiles: {
            local: 'docker-compose.local.yml',
            ci: 'docker-compose.ci.yml',
            k8s: 'docker-compose.k8s.yml'
          },
          projectName: 'otp'
        },
        services: [],
        healthChecks: {
          timeout: 30000,
          retries: 3,
          interval: 5000
        }
      },
      runners: {
        api: {
          type: 'docker',
          image: 'otp/api-tests',
          command: ['npm', 'test'],
          timeout: 300000,
          environment: {
            NODE_ENV: 'test'
          }
        },
        e2e: {
          type: 'local',
          command: ['npm', 'run', 'test:e2e'],
          timeout: 600000
        }
      },
      reporting: {
        grafana: {
          url: 'http://localhost:3000',
          dashboards: []
        },
        resultsApi: {
          url: 'http://localhost:8080',
          timeout: 30000
        }
      },
      fixtures: {
        defaultSet: 'basic',
        sets: {}
      }
    };

    // Setup default mock implementations
    mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
    mockConfigManager.validateConfig.mockReturnValue({ valid: true, errors: [] });
    mockRunnerManager.listAvailableSuites.mockResolvedValue(['api', 'e2e']);
    mockRunnerManager.validateRunner.mockResolvedValue({ valid: true, errors: [] });

    command = new RunCommand(mockConfigManager);
    
    // Mock the TestRunnerManager constructor
    (TestRunnerManager as jest.MockedClass<typeof TestRunnerManager>).mockImplementation(() => mockRunnerManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Command Properties', () => {
    it('should have correct command properties', () => {
      expect(command.name).toBe('run');
      expect(command.description).toBe('Execute test suites');
      expect(command.usage).toBe('<suite> [options]');
      expect(command.aliases).toEqual(['test', 'execute']);
      expect(command.examples).toHaveLength(5);
      expect(command.options).toHaveLength(8);
    });

    it('should have all required command options', () => {
      const optionFlags = command.options.map(opt => opt.flags);
      expect(optionFlags).toContain('--target <environment>');
      expect(optionFlags).toContain('--tags <criteria>');
      expect(optionFlags).toContain('--parallel');
      expect(optionFlags).toContain('--timeout <seconds>');
      expect(optionFlags).toContain('--dry-run');
      expect(optionFlags).toContain('--env <key=value>');
      expect(optionFlags).toContain('--output-dir <path>');
      expect(optionFlags).toContain('--no-progress');
    });
  });

  describe('Argument Validation', () => {
    it('should validate timeout argument', async () => {
      const args = { _: ['api'], timeout: -1 };
      
      const result = await command.execute(args, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Timeout must be a positive number');
    });

    it('should validate target argument', async () => {
      const args = { _: ['api'], target: 'invalid' };
      
      const result = await command.execute(args, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Target must be one of: local, dev, staging, prod');
    });

    it('should validate environment variable format', async () => {
      const args = { _: ['api'], env: 'INVALID_FORMAT' };
      
      const result = await command.execute(args, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid environment variable format');
    });

    it('should accept valid arguments', async () => {
      const args = { 
        _: ['api'], 
        target: 'local', 
        timeout: 300,
        env: ['NODE_ENV=test', 'DEBUG=true']
      };
      
      // Mock successful test execution
      const mockResult: TestResult = {
        runId: 'test-run-123',
        suite: 'api',
        status: 'passed',
        summary: { total: 10, passed: 10, failed: 0, skipped: 0, errors: 0 },
        artifacts: [],
        startTime: new Date(),
        endTime: new Date(),
        duration: 30000
      };
      mockRunnerManager.runSuite.mockResolvedValue(mockResult);
      
      const result = await command.execute(args, mockContext);
      
      expect(result.success).toBe(true);
    });
  });

  describe('Suite Validation', () => {
    it('should fail when no suite is provided', async () => {
      const args = { _: [] };
      
      const result = await command.execute(args, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Suite name is required');
    });

    it('should fail when suite does not exist', async () => {
      const args = { _: ['nonexistent'] };
      mockRunnerManager.listAvailableSuites.mockResolvedValue(['api', 'e2e']);
      
      const result = await command.execute(args, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain("Suite 'nonexistent' not found");
      expect(result.message).toContain('Available suites: api, e2e');
    });

    it('should fail when runner validation fails', async () => {
      const args = { _: ['api'] };
      const validationResult: ValidationResult = {
        valid: false,
        errors: [
          { field: 'image', message: 'Docker image not found', code: 'IMAGE_NOT_FOUND' }
        ]
      };
      mockRunnerManager.validateRunner.mockResolvedValue(validationResult);
      
      const result = await command.execute(args, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Runner validation failed');
      expect(result.message).toContain('Docker image not found');
    });
  });

  describe('Configuration Handling', () => {
    it('should fail when configuration validation fails', async () => {
      const args = { _: ['api'] };
      mockConfigManager.validateConfig.mockReturnValue({
        valid: false,
        errors: [{ path: 'runners.api', message: 'Invalid runner configuration', value: null }]
      });
      
      const result = await command.execute(args, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Configuration validation failed');
      expect(result.message).toContain('Invalid runner configuration');
    });

    it('should load configuration with correct profile', async () => {
      const args = { _: ['api'] };
      mockContext.profile = 'ci';
      
      // Mock successful test execution
      const mockResult: TestResult = {
        runId: 'test-run-123',
        suite: 'api',
        status: 'passed',
        summary: { total: 5, passed: 5, failed: 0, skipped: 0, errors: 0 },
        artifacts: [],
        startTime: new Date(),
        endTime: new Date(),
        duration: 15000
      };
      mockRunnerManager.runSuite.mockResolvedValue(mockResult);
      
      await command.execute(args, mockContext);
      
      expect(mockConfigManager.loadConfig).toHaveBeenCalledWith('ci');
    });
  });

  describe('Dry Run Mode', () => {
    it('should show execution plan in dry run mode', async () => {
      const args = { _: ['api'], dryRun: true, target: 'staging', tags: 'smoke' };
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const result = await command.execute(args, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Dry run completed');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Execution Plan (Dry Run)'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Suite: api'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Target: staging'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Tags: smoke'));
      
      // Should not execute tests in dry run mode
      expect(mockRunnerManager.runSuite).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should not execute tests in dry run mode', async () => {
      const args = { _: ['api'], dryRun: true };
      
      jest.spyOn(console, 'log').mockImplementation();
      
      await command.execute(args, mockContext);
      
      expect(mockRunnerManager.runSuite).not.toHaveBeenCalled();
    });
  });

  describe('Test Execution', () => {
    it('should execute tests successfully', async () => {
      const args = { _: ['api'], target: 'local', timeout: 300 };
      
      const mockResult: TestResult = {
        runId: 'test-run-123',
        suite: 'api',
        status: 'passed',
        summary: { 
          total: 15, 
          passed: 13, 
          failed: 1, 
          skipped: 1, 
          errors: 0,
          coverage: {
            lines: 85,
            functions: 90,
            branches: 80,
            statements: 88
          }
        },
        artifacts: ['test-results.xml', 'coverage-report.html'],
        traceId: 'trace-456',
        startTime: new Date(),
        endTime: new Date(),
        duration: 45000
      };
      mockRunnerManager.runSuite.mockResolvedValue(mockResult);
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const result = await command.execute(args, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        runId: 'test-run-123',
        suite: 'api',
        status: 'passed',
        summary: expect.objectContaining({
          total: 15,
          passed: 13,
          failed: 1,
          skipped: 1,
          errors: 0,
          passRate: expect.any(Number),
          failureRate: expect.any(Number),
          executionRate: expect.any(Number)
        }),
        duration: 45000,
        artifacts: ['test-results.xml', 'coverage-report.html'],
        traceId: 'trace-456',
        processed: expect.any(Boolean),
        metadata: expect.objectContaining({
          environment: expect.any(String),
          profile: expect.any(String),
          hostname: expect.any(String),
          platform: expect.any(String),
          nodeVersion: expect.any(String)
        })
      });
      
      expect(result.message).toContain('Test Results (Run ID: test-run-123)');
      expect(result.message).toContain('Status: ✅ PASSED');
      expect(result.message).toContain('Enhanced Summary:');
      expect(result.message).toContain('Total: 15');
      expect(result.message).toContain('Passed: 13 ✅');
      expect(result.message).toContain('Failed: 1 ❌');
      expect(result.message).toContain('Coverage:');
      expect(result.message).toContain('Lines: 85%');
      expect(result.message).toContain('Artifacts (2):');
      expect(result.message).toContain('Trace ID: trace-456');
      
      consoleSpy.mockRestore();
    });

    it('should handle failed tests', async () => {
      const args = { _: ['e2e'] };
      
      const mockResult: TestResult = {
        runId: 'test-run-456',
        suite: 'e2e',
        status: 'failed',
        summary: { total: 8, passed: 5, failed: 3, skipped: 0, errors: 0 },
        artifacts: ['screenshots/failure1.png'],
        startTime: new Date(),
        endTime: new Date(),
        duration: 120000
      };
      mockRunnerManager.runSuite.mockResolvedValue(mockResult);
      
      const result = await command.execute(args, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.message).toContain('Status: ❌ FAILED');
      expect(result.message).toContain('Debug failed tests');
    });

    it('should handle test execution errors', async () => {
      const args = { _: ['api'] };
      
      const mockResult: TestResult = {
        runId: 'test-run-789',
        suite: 'api',
        status: 'error',
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, errors: 1 },
        artifacts: [],
        startTime: new Date(),
        endTime: new Date(),
        duration: 5000
      };
      mockRunnerManager.runSuite.mockResolvedValue(mockResult);
      
      const result = await command.execute(args, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.message).toContain('Status: 💥 ERROR');
      expect(result.message).toContain('Errors: 1 💥');
    });
  });

  describe('Run Options Building', () => {
    it('should build run options correctly', async () => {
      const args = { 
        _: ['api'], 
        target: 'staging',
        tags: 'smoke and not slow',
        parallel: true,
        timeout: 600,
        env: ['DEBUG=true', 'LOG_LEVEL=debug'],
        outputDir: '/tmp/test-results'
      };
      
      const mockResult: TestResult = {
        runId: 'test-run-123',
        suite: 'api',
        status: 'passed',
        summary: { total: 1, passed: 1, failed: 0, skipped: 0, errors: 0 },
        artifacts: [],
        startTime: new Date(),
        endTime: new Date(),
        duration: 10000
      };
      mockRunnerManager.runSuite.mockResolvedValue(mockResult);
      
      await command.execute(args, mockContext);
      
      expect(mockRunnerManager.runSuite).toHaveBeenCalledWith('api', {
        target: 'staging',
        tags: 'smoke and not slow',
        parallel: true,
        timeout: 600000, // Converted to milliseconds
        dryRun: false,
        environment: {
          NODE_ENV: 'test', // From runner config
          DEBUG: 'true',    // From command line
          LOG_LEVEL: 'debug', // From command line
          OTP_TARGET: 'staging',
          OTP_PROFILE: 'local',
          OTP_OUTPUT_DIR: '/tmp/test-results'
        }
      });
    });

    it('should use default values when options not provided', async () => {
      const args = { _: ['api'] };
      
      const mockResult: TestResult = {
        runId: 'test-run-123',
        suite: 'api',
        status: 'passed',
        summary: { total: 1, passed: 1, failed: 0, skipped: 0, errors: 0 },
        artifacts: [],
        startTime: new Date(),
        endTime: new Date(),
        duration: 10000
      };
      mockRunnerManager.runSuite.mockResolvedValue(mockResult);
      
      await command.execute(args, mockContext);
      
      expect(mockRunnerManager.runSuite).toHaveBeenCalledWith('api', {
        target: 'local', // Default value
        timeout: 300000, // Default 300s converted to milliseconds
        parallel: false, // Default value
        dryRun: false,   // Default value
        environment: {
          NODE_ENV: 'test', // From runner config
          OTP_TARGET: 'local',
          OTP_PROFILE: 'local'
        }
      });
    });
  });

  describe('Progress Reporting', () => {
    it('should show progress during execution', async () => {
      const args = { _: ['api'] };
      
      const mockResult: TestResult = {
        runId: 'test-run-123',
        suite: 'api',
        status: 'passed',
        summary: { total: 1, passed: 1, failed: 0, skipped: 0, errors: 0 },
        artifacts: [],
        startTime: new Date(),
        endTime: new Date(),
        duration: 10000
      };
      mockRunnerManager.runSuite.mockResolvedValue(mockResult);
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      await command.execute(args, mockContext);
      
      expect(consoleSpy).toHaveBeenCalledWith('🚀 Starting test execution...');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('📋 Preparing test environment...'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✅ Test execution completed'));
      
      consoleSpy.mockRestore();
    });

    it('should show error message when execution fails', async () => {
      const args = { _: ['api'] };
      
      mockRunnerManager.runSuite.mockRejectedValue(new Error('Docker container failed to start'));
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const result = await command.execute(args, mockContext);
      
      expect(result.success).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('❌ Test execution failed'));
      
      consoleSpy.mockRestore();
    });
  });

  describe('Available Suites', () => {
    it('should get available suites', async () => {
      mockRunnerManager.listAvailableSuites.mockResolvedValue(['api', 'e2e', 'contract']);
      
      const suites = await command.getAvailableSuites(mockConfig);
      
      expect(suites).toEqual(['api', 'e2e', 'contract']);
    });

    it('should handle errors when getting available suites', async () => {
      mockRunnerManager.listAvailableSuites.mockRejectedValue(new Error('Connection failed'));
      
      const suites = await command.getAvailableSuites(mockConfig);
      
      expect(suites).toEqual([]);
    });
  });

  describe('Error Handling', () => {
    it('should handle configuration loading errors', async () => {
      const args = { _: ['api'] };
      mockConfigManager.loadConfig.mockRejectedValue(new Error('Config file not found'));
      
      const result = await command.execute(args, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Config file not found');
    });

    it('should handle runner manager initialization errors', async () => {
      const args = { _: ['api'] };
      
      // Mock TestRunnerManager constructor to throw
      (TestRunnerManager as jest.MockedClass<typeof TestRunnerManager>).mockImplementation(() => {
        throw new Error('Failed to initialize runners');
      });
      
      const result = await command.execute(args, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to initialize runners');
    });

    it('should handle unexpected errors gracefully', async () => {
      const args = { _: ['api'] };
      mockRunnerManager.runSuite.mockRejectedValue(new Error('Unexpected error'));
      
      const result = await command.execute(args, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Unexpected error');
    });
  });
});