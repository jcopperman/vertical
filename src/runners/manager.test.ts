/**
 * Tests for TestRunnerManager
 */

import { TestRunnerManager } from './manager';
import { OTPConfig, RunnerDefinition } from '../config/types';
import { RunOptions } from './types';

// Mock the runner implementations
jest.mock('./docker-runner');
jest.mock('./local-runner');
jest.mock('./k8s-runner');

describe('TestRunnerManager', () => {
  let manager: TestRunnerManager;
  let mockConfig: OTPConfig;

  beforeEach(() => {
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
          timeout: 60,
          retries: 5,
          interval: 5
        }
      },
      runners: {
        'api-tests': {
          type: 'docker',
          image: 'otp/api-tests:latest',
          command: ['npm', 'test'],
          timeout: 300000
        },
        'unit-tests': {
          type: 'local',
          command: ['npm', 'run', 'test:unit'],
          timeout: 120000
        },
        'e2e-tests': {
          type: 'k8s',
          image: 'otp/e2e-tests:latest',
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
          timeout: 30
        }
      },
      fixtures: {
        defaultSet: 'basic',
        sets: {
          basic: {
            name: 'basic',
            description: 'Basic test fixtures',
            files: []
          }
        }
      }
    };

    manager = new TestRunnerManager(mockConfig);
  });

  describe('initialization', () => {
    it('should initialize runners from configuration', () => {
      expect(manager).toBeDefined();
      // Runners should be initialized internally
    });

    it('should handle invalid runner types gracefully', () => {
      const invalidConfig = {
        ...mockConfig,
        runners: {
          'invalid-runner': {
            type: 'invalid' as any,
            command: ['test'],
            timeout: 300000
          }
        }
      };

      expect(() => new TestRunnerManager(invalidConfig)).not.toThrow();
    });
  });

  describe('listAvailableSuites', () => {
    it('should return list of available test suites', async () => {
      // Mock runner status
      const mockRunner = {
        getStatus: jest.fn().mockResolvedValue({
          available: true,
          healthy: true
        })
      };

      // Access private runners map for testing
      (manager as any).runners.set('api-tests', mockRunner);
      (manager as any).runners.set('unit-tests', mockRunner);

      const suites = await manager.listAvailableSuites();
      
      expect(suites).toContain('api-tests');
      expect(suites).toContain('unit-tests');
      expect(suites).toEqual(expect.arrayContaining(['api-tests', 'unit-tests']));
    });

    it('should exclude unavailable runners', async () => {
      const availableRunner = {
        getStatus: jest.fn().mockResolvedValue({
          available: true,
          healthy: true
        })
      };

      const unavailableRunner = {
        getStatus: jest.fn().mockResolvedValue({
          available: false,
          healthy: false
        })
      };

      (manager as any).runners.set('available-suite', availableRunner);
      (manager as any).runners.set('unavailable-suite', unavailableRunner);

      const suites = await manager.listAvailableSuites();
      
      expect(suites).toContain('available-suite');
      expect(suites).not.toContain('unavailable-suite');
    });

    it('should handle runner status errors gracefully', async () => {
      const errorRunner = {
        getStatus: jest.fn().mockRejectedValue(new Error('Status check failed'))
      };

      (manager as any).runners.set('error-suite', errorRunner);

      const suites = await manager.listAvailableSuites();
      
      expect(suites).not.toContain('error-suite');
    });
  });

  describe('getRunnerStatus', () => {
    it('should return status for existing runner', async () => {
      const mockStatus = {
        name: 'api-tests',
        available: true,
        healthy: true,
        capabilities: []
      };

      const mockRunner = {
        getStatus: jest.fn().mockResolvedValue(mockStatus)
      };

      (manager as any).runners.set('api-tests', mockRunner);

      const status = await manager.getRunnerStatus('api-tests');
      
      expect(status).toEqual(mockStatus);
      expect(mockRunner.getStatus).toHaveBeenCalled();
    });

    it('should return error status for non-existent runner', async () => {
      const status = await manager.getRunnerStatus('non-existent');
      
      expect(status.available).toBe(false);
      expect(status.healthy).toBe(false);
      expect(status.issues).toContain('Runner not found: non-existent');
    });

    it('should handle runner status errors', async () => {
      const mockRunner = {
        getStatus: jest.fn().mockRejectedValue(new Error('Status failed'))
      };

      (manager as any).runners.set('error-runner', mockRunner);

      const status = await manager.getRunnerStatus('error-runner');
      
      expect(status.available).toBe(false);
      expect(status.healthy).toBe(false);
      expect(status.issues).toContain('Status failed');
    });
  });

  describe('validateRunner', () => {
    it('should validate existing runner', async () => {
      const mockValidation = {
        valid: true,
        errors: []
      };

      const mockRunner = {
        validate: jest.fn().mockResolvedValue(mockValidation)
      };

      (manager as any).runners.set('api-tests', mockRunner);

      const result = await manager.validateRunner('api-tests');
      
      expect(result).toEqual(mockValidation);
      expect(mockRunner.validate).toHaveBeenCalled();
    });

    it('should return error for non-existent runner', async () => {
      const result = await manager.validateRunner('non-existent');
      
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('RUNNER_NOT_FOUND');
    });

    it('should handle validation errors', async () => {
      const mockRunner = {
        validate: jest.fn().mockRejectedValue(new Error('Validation failed'))
      };

      (manager as any).runners.set('error-runner', mockRunner);

      const result = await manager.validateRunner('error-runner');
      
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('VALIDATION_ERROR');
    });
  });

  describe('setupEnvironment', () => {
    it('should setup environment for existing runner', async () => {
      const mockRunner = {
        setupEnvironment: jest.fn().mockResolvedValue(undefined)
      };

      (manager as any).runners.set('api-tests', mockRunner);

      const options: RunOptions = {
        target: 'local',
        tags: 'smoke'
      };

      await manager.setupEnvironment('api-tests', options);
      
      expect(mockRunner.setupEnvironment).toHaveBeenCalledWith(options);
    });

    it('should throw error for non-existent runner', async () => {
      const options: RunOptions = {
        target: 'local'
      };

      await expect(manager.setupEnvironment('non-existent', options))
        .rejects.toThrow('Runner not found: non-existent');
    });

    it('should propagate setup errors', async () => {
      const mockRunner = {
        setupEnvironment: jest.fn().mockRejectedValue(new Error('Setup failed'))
      };

      (manager as any).runners.set('error-runner', mockRunner);

      const options: RunOptions = {
        target: 'local'
      };

      await expect(manager.setupEnvironment('error-runner', options))
        .rejects.toThrow('Setup failed');
    });
  });

  describe('runSuite', () => {
    it('should execute test suite successfully', async () => {
      const mockExecutionResult = {
        success: true,
        summary: {
          total: 10,
          passed: 10,
          failed: 0,
          skipped: 0,
          errors: 0
        },
        artifacts: ['test-results.xml']
      };

      const mockRunner = {
        validate: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
        setupEnvironment: jest.fn().mockResolvedValue(undefined),
        execute: jest.fn().mockResolvedValue(mockExecutionResult)
      };

      (manager as any).runners.set('api-tests', mockRunner);

      const options: RunOptions = {
        target: 'local',
        tags: 'smoke'
      };

      const result = await manager.runSuite('api-tests', options);
      
      expect(result.status).toBe('passed');
      expect(result.suite).toBe('api-tests');
      expect(result.summary).toEqual(mockExecutionResult.summary);
      expect(result.artifacts).toEqual(mockExecutionResult.artifacts);
      expect(result.runId).toBeDefined();
      expect(result.startTime).toBeDefined();
      expect(result.endTime).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle test suite failures', async () => {
      const mockExecutionResult = {
        success: false,
        summary: {
          total: 10,
          passed: 5,
          failed: 5,
          skipped: 0,
          errors: 0
        }
      };

      const mockRunner = {
        validate: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
        setupEnvironment: jest.fn().mockResolvedValue(undefined),
        execute: jest.fn().mockResolvedValue(mockExecutionResult)
      };

      (manager as any).runners.set('api-tests', mockRunner);

      const options: RunOptions = {
        target: 'local'
      };

      const result = await manager.runSuite('api-tests', options);
      
      expect(result.status).toBe('failed');
      expect(result.summary).toEqual(mockExecutionResult.summary);
    });

    it('should handle runner not found', async () => {
      const options: RunOptions = {
        target: 'local'
      };

      const result = await manager.runSuite('non-existent', options);
      
      expect(result.status).toBe('error');
      expect(result.suite).toBe('non-existent');
    });

    it('should handle validation failures', async () => {
      const mockRunner = {
        validate: jest.fn().mockResolvedValue({
          valid: false,
          errors: [{ message: 'Invalid configuration' }]
        })
      };

      (manager as any).runners.set('invalid-runner', mockRunner);

      const options: RunOptions = {
        target: 'local'
      };

      const result = await manager.runSuite('invalid-runner', options);
      
      expect(result.status).toBe('error');
    });

    it('should handle execution errors', async () => {
      const mockRunner = {
        validate: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
        setupEnvironment: jest.fn().mockResolvedValue(undefined),
        execute: jest.fn().mockRejectedValue(new Error('Execution failed'))
      };

      (manager as any).runners.set('error-runner', mockRunner);

      const options: RunOptions = {
        target: 'local'
      };

      const result = await manager.runSuite('error-runner', options);
      
      expect(result.status).toBe('error');
    });
  });

  describe('active runs management', () => {
    it('should track active runs', () => {
      const activeRuns = manager.getActiveRuns();
      expect(Array.isArray(activeRuns)).toBe(true);
      expect(activeRuns).toHaveLength(0);
    });

    it('should handle run cancellation for non-existent run', async () => {
      const result = await manager.cancelRun('non-existent-run-id');
      expect(result).toBe(false);
    });
  });
});