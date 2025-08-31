/**
 * Tests for DownCommand
 */

import { DownCommand } from './down';
import { CommandContext } from './types';
import { ConfigurationManager } from '../config/manager';
import { DockerComposeOrchestrator } from '../docker/compose-orchestrator';
import { OTPConfig, ValidationResult } from '../config/types';

// Mock dependencies
jest.mock('../config/manager');
jest.mock('../docker/compose-orchestrator');
jest.mock('../utils/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

describe('DownCommand', () => {
  let command: DownCommand;
  let mockConfigManager: jest.Mocked<ConfigurationManager>;
  let mockOrchestrator: jest.Mocked<DockerComposeOrchestrator>;
  let mockContext: CommandContext;
  let mockConfig: OTPConfig;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock configuration manager
    mockConfigManager = {
      loadConfig: jest.fn().mockResolvedValue(mockConfig),
      validateConfig: jest.fn().mockReturnValue({ valid: true, errors: [] } as ValidationResult),
      getActiveProfile: jest.fn().mockReturnValue('local'),
    } as jest.Mocked<ConfigurationManager>;

    // Mock orchestrator
    mockOrchestrator = {
      destroy: jest.fn(),
      getStatus: jest.fn(),
      deploy: jest.fn(),
      checkStackHealth: jest.fn(),
    } as any;

    // Mock DockerComposeOrchestrator constructor
    (DockerComposeOrchestrator as jest.Mock).mockImplementation(() => mockOrchestrator);

    // Create command with mocked config manager
    command = new DownCommand(mockConfigManager);

    // Mock context
    mockContext = {
      verbose: false,
      logger: { debug: jest.fn(), error: jest.fn() },
    };

    // Mock config
    mockConfig = {
      version: '1.0.0',
      profile: 'local',
      infrastructure: {
        compose: {
          baseFile: 'docker-compose.yml',
          profileFiles: {
            local: 'docker-compose.local.yml',
            ci: 'docker-compose.ci.yml',
            k8s: 'docker-compose.k8s.yml',
          },
          projectName: 'otp-test',
        },
        services: [
          {
            name: 'grafana',
            ports: [3000],
            healthCheck: {
              endpoint: 'http://localhost:3000/api/health',
              timeout: 5000,
              retries: 3,
            },
          },
        ],
        healthChecks: {
          timeout: 120000,
          retries: 3,
          interval: 5000,
        },
      },
      runners: {},
      reporting: {
        grafana: {
          url: 'http://localhost:3000',
          dashboards: [],
        },
        resultsApi: {
          url: 'http://localhost:8080',
          timeout: 30000,
        },
      },
      fixtures: {
        defaultSet: 'basic',
        sets: {},
      },
    };
  });

  describe('command properties', () => {
    it('should have correct command properties', () => {
      expect(command.name).toBe('down');
      expect(command.description).toBe('Stop and cleanup the OTP infrastructure stack');
      expect(command.aliases).toEqual(['stop']);
      expect(command.options).toHaveLength(4);
    });

    it('should have proper options defined', () => {
      const optionFlags = command.options.map(opt => opt.flags);
      expect(optionFlags).toContain('--profile <profile>');
      expect(optionFlags).toContain('--clean');
      expect(optionFlags).toContain('--timeout <seconds>');
      expect(optionFlags).toContain('--force');
    });
  });

  describe('execute', () => {
    beforeEach(() => {
      // Reset mocks for each test
      jest.clearAllMocks();
    });

    it('should stop services successfully with default options', async () => {
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.validateConfig.mockReturnValue({ valid: true, errors: [] });
      mockOrchestrator.getStatus.mockResolvedValue({
        projectName: 'otp-test',
        isRunning: true,
        services: [
          {
            name: 'grafana',
            containers: [],
            status: 'running',
            health: 'healthy',
            endpoints: [{ name: 'web', url: 'http://localhost:3000', port: 3000, protocol: 'http' }],
          },
        ],
        composeFiles: [],
      });
      mockOrchestrator.destroy.mockResolvedValue(undefined);

      const result = await command.execute({}, mockContext);

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.message).toContain('cleanup completed');
      expect(mockConfigManager.loadConfig).toHaveBeenCalledWith(undefined);
      expect(mockOrchestrator.destroy).toHaveBeenCalledWith({
        removeVolumes: undefined,
        timeout: 60
      });
    });

    it('should handle no running services', async () => {
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.validateConfig.mockReturnValue({ valid: true, errors: [] });
      mockOrchestrator.getStatus.mockResolvedValue({
        projectName: 'otp-test',
        isRunning: false,
        services: [],
        composeFiles: [],
      });

      const result = await command.execute({}, mockContext);

      expect(result.success).toBe(true);
      expect(result.message).toContain('No OTP infrastructure is currently running');
      expect(mockOrchestrator.destroy).not.toHaveBeenCalled();
    });

    it('should use specified profile', async () => {
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.validateConfig.mockReturnValue({ valid: true, errors: [] });
      mockOrchestrator.getStatus.mockResolvedValue({
        projectName: 'otp-test',
        isRunning: true,
        services: [{ name: 'grafana', containers: [], status: 'running', health: 'healthy', endpoints: [] }],
        composeFiles: [],
      });
      mockOrchestrator.destroy.mockResolvedValue(undefined);

      const args = { profile: 'ci' };
      const result = await command.execute(args, mockContext);

      expect(result.success).toBe(true);
      expect(mockConfigManager.loadConfig).toHaveBeenCalledWith('ci');
    });

    it('should use profile from context if not in args', async () => {
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.validateConfig.mockReturnValue({ valid: true, errors: [] });
      mockOrchestrator.getStatus.mockResolvedValue({
        projectName: 'otp-test',
        isRunning: true,
        services: [{ name: 'grafana', containers: [], status: 'running', health: 'healthy', endpoints: [] }],
        composeFiles: [],
      });
      mockOrchestrator.destroy.mockResolvedValue(undefined);

      const contextWithProfile = { ...mockContext, profile: 'k8s' };
      const result = await command.execute({}, contextWithProfile);

      expect(result.success).toBe(true);
      expect(mockConfigManager.loadConfig).toHaveBeenCalledWith('k8s');
    });

    it('should handle configuration validation errors', async () => {
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.validateConfig.mockReturnValue({
        valid: false,
        errors: [
          { path: 'infrastructure.compose.baseFile', message: 'File not found' },
        ],
      });

      const result = await command.execute({}, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Configuration validation failed');
      expect(result.message).toContain('File not found');
    });

    it('should clean volumes when --clean flag is used', async () => {
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.validateConfig.mockReturnValue({ valid: true, errors: [] });
      mockOrchestrator.getStatus.mockResolvedValue({
        projectName: 'otp-test',
        isRunning: true,
        services: [{ name: 'grafana', containers: [], status: 'running', health: 'healthy', endpoints: [] }],
        composeFiles: [],
      });
      mockOrchestrator.destroy.mockResolvedValue(undefined);

      const args = { clean: true };
      const result = await command.execute(args, mockContext);

      expect(result.success).toBe(true);
      expect(mockOrchestrator.destroy).toHaveBeenCalledWith({
        removeVolumes: true,
        timeout: 60
      });
      expect(result.message).toContain('Data volumes: Removed');
    });

    it('should use custom timeout', async () => {
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.validateConfig.mockReturnValue({ valid: true, errors: [] });
      mockOrchestrator.getStatus.mockResolvedValue({
        projectName: 'otp-test',
        isRunning: true,
        services: [{ name: 'grafana', containers: [], status: 'running', health: 'healthy', endpoints: [] }],
        composeFiles: [],
      });
      mockOrchestrator.destroy.mockResolvedValue(undefined);

      const args = { timeout: 120 };
      const result = await command.execute(args, mockContext);

      expect(result.success).toBe(true);
      expect(mockOrchestrator.destroy).toHaveBeenCalledWith({
        removeVolumes: undefined,
        timeout: 120
      });
    });

    it('should handle force stop when graceful shutdown fails', async () => {
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.validateConfig.mockReturnValue({ valid: true, errors: [] });
      mockOrchestrator.getStatus.mockResolvedValue({
        projectName: 'otp-test',
        isRunning: true,
        services: [{ name: 'grafana', containers: [], status: 'running', health: 'healthy', endpoints: [] }],
        composeFiles: [],
      });
      
      // Force stop should succeed
      mockOrchestrator.destroy.mockResolvedValue(undefined);

      const args = { force: true };
      const result = await command.execute(args, mockContext);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Method: Force stop');
      expect(mockOrchestrator.destroy).toHaveBeenCalledTimes(1);
    });

    it('should handle cleanup failures', async () => {
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.validateConfig.mockReturnValue({ valid: true, errors: [] });
      mockOrchestrator.getStatus.mockResolvedValue({
        projectName: 'otp-test',
        isRunning: true,
        services: [{ name: 'grafana', containers: [], status: 'running', health: 'healthy', endpoints: [] }],
        composeFiles: [],
      });
      mockOrchestrator.destroy.mockRejectedValue(new Error('Docker daemon not running'));

      const result = await command.execute({}, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Cleanup failed');
      expect(result.message).toContain('Docker daemon not running');
    });

    it('should handle unexpected errors', async () => {
      mockConfigManager.loadConfig.mockRejectedValue(new Error('Config file not found'));

      const result = await command.execute({}, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Config file not found');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('validateArgs', () => {
    it('should validate timeout argument', () => {
      expect(() => (command as any).validateArgs({ timeout: -1 })).toThrow(
        'Timeout must be a positive number'
      );
      expect(() => (command as any).validateArgs({ timeout: 'invalid' })).toThrow(
        'Timeout must be a positive number'
      );
    });

    it('should validate profile argument', () => {
      expect(() => (command as any).validateArgs({ profile: 'invalid' })).toThrow(
        'Profile must be one of: local, ci, k8s'
      );
    });

    it('should accept valid arguments', () => {
      expect(() =>
        (command as any).validateArgs({
          timeout: 120,
          profile: 'local',
          clean: true,
          force: true,
        })
      ).not.toThrow();
    });
  });

  describe('cleanup plan display', () => {
    it('should show cleanup plan', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const stackStatus = {
        isRunning: true,
        services: [{ name: 'grafana' }, { name: 'prometheus' }],
        projectName: 'otp-test'
      };

      (command as any).showCleanupPlan(mockConfig, {
        clean: true,
        timeout: 120,
        force: false,
      }, stackStatus);

      expect(consoleSpy).toHaveBeenCalledWith('\n🗑️  Cleanup Plan:');
      expect(consoleSpy).toHaveBeenCalledWith('   Profile: local');
      expect(consoleSpy).toHaveBeenCalledWith('   Services: 2 running services');
      expect(consoleSpy).toHaveBeenCalledWith('   Remove Volumes: Yes');
      expect(consoleSpy).toHaveBeenCalledWith('   Timeout: 120 seconds');
      expect(consoleSpy).toHaveBeenCalledWith('   Force Stop: No');

      consoleSpy.mockRestore();
    });
  });

  describe('success message formatting', () => {
    it('should format success message with cleanup details', () => {
      const result = {
        cleanupTime: 45000,
        servicesRemoved: 3,
      };

      const args = { clean: true, force: false };
      const message = (command as any).formatSuccessMessage(result, args);

      expect(message).toContain('cleanup completed');
      expect(message).toContain('Services stopped: 3');
      expect(message).toContain('Time: 45 seconds');
      expect(message).toContain('Data volumes: Removed');
      expect(message).toContain('Method: Graceful shutdown');
    });

    it('should format success message for force stop without clean', () => {
      const result = {
        cleanupTime: 15000,
        servicesRemoved: 2,
      };

      const args = { clean: false, force: true };
      const message = (command as any).formatSuccessMessage(result, args);

      expect(message).toContain('cleanup completed');
      expect(message).toContain('Services stopped: 2');
      expect(message).toContain('Time: 15 seconds');
      expect(message).toContain('Data volumes: Preserved');
      expect(message).toContain('Method: Force stop');
    });
  });
});