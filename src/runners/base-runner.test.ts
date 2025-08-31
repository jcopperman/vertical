/**
 * Tests for BaseRunner
 */

import { BaseRunner } from './base-runner';
import { RunnerDefinition } from '../config/types';
import { RunOptions, ValidationResult, RunnerExecutionContext, ProgressCallback } from './types';

// Create a concrete implementation for testing
class TestRunner extends BaseRunner {
  async execute(context: RunnerExecutionContext, progressCallback: ProgressCallback) {
    return {
      success: true,
      output: 'Test execution completed'
    };
  }

  public async validateSpecific(): Promise<ValidationResult> {
    return { valid: true, errors: [] };
  }

  public async setupSpecific(options: RunOptions): Promise<void> {
    // Test implementation
  }
}

describe('BaseRunner', () => {
  let runner: TestRunner;
  let mockDefinition: RunnerDefinition;

  beforeEach(() => {
    mockDefinition = {
      type: 'local',
      command: ['npm', 'test'],
      timeout: 300000,
      environment: {
        NODE_ENV: 'test'
      }
    };

    runner = new TestRunner('test-runner', mockDefinition);
  });

  describe('constructor', () => {
    it('should initialize with name and definition', () => {
      expect(runner).toBeDefined();
      expect((runner as any).name).toBe('test-runner');
      expect((runner as any).definition).toEqual(mockDefinition);
    });
  });

  describe('getStatus', () => {
    it('should return healthy status for valid runner', async () => {
      const status = await runner.getStatus();
      
      expect(status.name).toBe('test-runner');
      expect(status.available).toBe(true);
      expect(status.capabilities).toBeDefined();
      expect(Array.isArray(status.capabilities)).toBe(true);
    });

    it('should include basic execution capability', async () => {
      const status = await runner.getStatus();
      
      const basicCapability = status.capabilities.find(c => c.name === 'basic-execution');
      expect(basicCapability).toBeDefined();
      expect(basicCapability?.supported).toBe(true);
    });
  });

  describe('validate', () => {
    it('should validate successfully with valid configuration', async () => {
      const result = await runner.validate();
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation with missing command', async () => {
      const invalidDefinition = {
        ...mockDefinition,
        command: []
      };

      const invalidRunner = new TestRunner('invalid-runner', invalidDefinition);
      const result = await invalidRunner.validate();
      
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('MISSING_COMMAND');
    });

    it('should fail validation with invalid timeout', async () => {
      const invalidDefinition = {
        ...mockDefinition,
        timeout: -1
      };

      const invalidRunner = new TestRunner('invalid-runner', invalidDefinition);
      const result = await invalidRunner.validate();
      
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('INVALID_TIMEOUT');
    });
  });

  describe('setupEnvironment', () => {
    it('should setup environment successfully', async () => {
      const options: RunOptions = {
        target: 'local',
        environment: {
          OTP_OUTPUT_DIR: '/tmp/test-output'
        }
      };

      // Mock fs.mkdir
      const mockMkdir = jest.fn().mockResolvedValue(undefined);
      jest.doMock('fs/promises', () => ({
        mkdir: mockMkdir
      }));

      await expect(runner.setupEnvironment(options)).resolves.not.toThrow();
    });

    it('should handle setup without output directory', async () => {
      const options: RunOptions = {
        target: 'local'
      };

      await expect(runner.setupEnvironment(options)).resolves.not.toThrow();
    });
  });

  describe('buildCommandArgs', () => {
    it('should build basic command arguments', () => {
      const context: RunnerExecutionContext = {
        runId: 'test-run-id',
        suite: 'test-suite',
        runner: 'test-runner',
        options: { target: 'local' },
        environment: {},
        workingDirectory: '/workspace',
        outputDirectory: '/output'
      };

      const args = (runner as any).buildCommandArgs(context);
      
      expect(args).toEqual(['npm', 'test']);
    });

    it('should add tags when specified', () => {
      const context: RunnerExecutionContext = {
        runId: 'test-run-id',
        suite: 'test-suite',
        runner: 'test-runner',
        options: { 
          target: 'local',
          tags: 'smoke,regression'
        },
        environment: {},
        workingDirectory: '/workspace',
        outputDirectory: '/output'
      };

      const args = (runner as any).buildCommandArgs(context);
      
      expect(args).toContain('--tags');
      expect(args).toContain('smoke,regression');
    });

    it('should add parallel flag when specified', () => {
      const context: RunnerExecutionContext = {
        runId: 'test-run-id',
        suite: 'test-suite',
        runner: 'test-runner',
        options: { 
          target: 'local',
          parallel: true
        },
        environment: {},
        workingDirectory: '/workspace',
        outputDirectory: '/output'
      };

      const args = (runner as any).buildCommandArgs(context);
      
      expect(args).toContain('--parallel');
    });

    it('should add dry-run flag when specified', () => {
      const context: RunnerExecutionContext = {
        runId: 'test-run-id',
        suite: 'test-suite',
        runner: 'test-runner',
        options: { 
          target: 'local',
          dryRun: true
        },
        environment: {},
        workingDirectory: '/workspace',
        outputDirectory: '/output'
      };

      const args = (runner as any).buildCommandArgs(context);
      
      expect(args).toContain('--dry-run');
    });
  });

  describe('buildEnvironment', () => {
    it('should merge definition and context environment', () => {
      const context: RunnerExecutionContext = {
        runId: 'test-run-id',
        suite: 'test-suite',
        runner: 'test-runner',
        options: { target: 'local' },
        environment: {
          OTP_RUN_ID: 'test-run-id',
          CUSTOM_VAR: 'custom-value'
        },
        workingDirectory: '/workspace',
        outputDirectory: '/output'
      };

      const env = (runner as any).buildEnvironment(context);
      
      expect(env.NODE_ENV).toBe('test'); // From definition
      expect(env.OTP_RUN_ID).toBe('test-run-id'); // From context
      expect(env.CUSTOM_VAR).toBe('custom-value'); // From context
    });

    it('should handle missing environment in definition', () => {
      const definitionWithoutEnv = {
        ...mockDefinition,
        environment: undefined
      };

      const runnerWithoutEnv = new TestRunner('test-runner', definitionWithoutEnv);
      
      const context: RunnerExecutionContext = {
        runId: 'test-run-id',
        suite: 'test-suite',
        runner: 'test-runner',
        options: { target: 'local' },
        environment: {
          OTP_RUN_ID: 'test-run-id'
        },
        workingDirectory: '/workspace',
        outputDirectory: '/output'
      };

      const env = (runnerWithoutEnv as any).buildEnvironment(context);
      
      expect(env.OTP_RUN_ID).toBe('test-run-id');
    });
  });

  describe('cancel', () => {
    it('should handle cancellation gracefully', async () => {
      await expect(runner.cancel('test-run-id')).resolves.not.toThrow();
    });
  });
});