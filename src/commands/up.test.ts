/**
 * Tests for UpCommand
 */

import { UpCommand } from './up';
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

describe('UpCommand', () => {
  let command: UpCommand;
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
      deploy: jest.fn(),
      getStatus: jest.fn(),
      destroy: jest.fn(),
      checkStackHealth: jest.fn(),
    } as any;

    // Mock DockerComposeOrchestrator constructor
    (DockerComposeOrchestrator as jest.Mock).mockImplementation(() => mockOrchestrator);

    // Create command with mocked config manager
    command = new UpCommand(mockConfigManager);

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
      expect(command.name).toBe('up');
      expect(command.description).toBe('Start the OTP infrastructure stack');
      expect(command.aliases).toEqual(['start']);
      expect(command.options).toHaveLength(7);
    });

    it('should have proper options defined', () => {
      const optionFlags = command.options.map(opt => opt.flags);
      expect(optionFlags).toContain('--profile <profile>');
      expect(optionFlags).toContain('--build');
      expect(optionFlags).toContain('--pull');
      expect(optionFlags).toContain('--no-wait');
      expect(optionFlags).toContain('--timeout <seconds>');
      expect(optionFlags).toContain('--health-timeout <seconds>');
      expect(optionFlags).toContain('--services <services>');
    });
  });

  describe('execute', () => {
    beforeEach(() => {
      // Reset mocks for each test
      jest.clearAllMocks();
    });

    it('should deploy successfully with default options', async () => {
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.validateConfig.mockReturnValue({ valid: true, errors: [] });
      mockOrchestrator.getStatus.mockResolvedValue({
        projectName: 'otp-test',
        isRunning: false,
        services: [],
        composeFiles: [],
      });
      mockOrchestrator.deploy.mockResolvedValue({
        success: true,
        services: [
          {
            name: 'grafana',
            containers: [],
            status: 'running',
            health: 'healthy',
            endpoints: [{ name: 'web', url: 'http://localhost:3000', port: 3000, protocol: 'http' }],
          },
        ],
        deploymentTime: 30000,
        errors: [],
        warnings: [],
      });

      const result = await command.execute({}, mockContext);

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.message).toContain('deployed successfully');
      expect(mockConfigManager.loadConfig).toHaveBeenCalledWith(undefined);
      expect(mockOrchestrator.deploy).toHaveBeenCalled();
    });

    it('should use specified profile', async () => {
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.validateConfig.mockReturnValue({ valid: true, errors: [] });
      mockOrchestrator.getStatus.mockResolvedValue({
        projectName: 'otp-test',
        isRunning: false,
        services: [],
        composeFiles: [],
      });
      mockOrchestrator.deploy.mockResolvedValue({
        success: true,
        services: [],
        deploymentTime: 30000,
        errors: [],
        warnings: [],
      });

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
        isRunning: false,
        services: [],
        composeFiles: [],
      });
      mockOrchestrator.deploy.mockResolvedValue({
        success: true,
        services: [],
        deploymentTime: 30000,
        errors: [],
        warnings: [],
      });

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

    it('should handle deployment failures', async () => {
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.validateConfig.mockReturnValue({ valid: true, errors: [] });
      mockOrchestrator.getStatus.mockResolvedValue({
        projectName: 'otp-test',
        isRunning: false,
        services: [],
        composeFiles: [],
      });
      mockOrchestrator.deploy.mockResolvedValue({
        success: false,
        services: [],
        deploymentTime: 15000,
        errors: ['Docker daemon not running'],
        warnings: [],
      });

      const result = await command.execute({}, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Deployment failed');
      expect(result.message).toContain('Docker daemon not running');
    });

    it('should pass deployment options correctly', async () => {
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.validateConfig.mockReturnValue({ valid: true, errors: [] });
      mockOrchestrator.getStatus.mockResolvedValue({
        projectName: 'otp-test',
        isRunning: false,
        services: [],
        composeFiles: [],
      });
      mockOrchestrator.deploy.mockResolvedValue({
        success: true,
        services: [],
        deploymentTime: 30000,
        errors: [],
        warnings: [],
      });

      const args = {
        build: true,
        pull: true,
        timeout: 600,
        healthTimeout: 180,
        services: 'grafana,prometheus',
      };

      await command.execute(args, mockContext);

      expect(mockOrchestrator.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          build: true,
          pullImages: true,
          timeout: 600000, // Converted to milliseconds
          healthCheckTimeout: 180000, // Converted to milliseconds
          services: ['grafana', 'prometheus'],
          waitForHealthy: true,
        })
      );
    });

    it('should skip health checks when --no-wait is specified', async () => {
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.validateConfig.mockReturnValue({ valid: true, errors: [] });
      mockOrchestrator.getStatus.mockResolvedValue({
        projectName: 'otp-test',
        isRunning: false,
        services: [],
        composeFiles: [],
      });
      mockOrchestrator.deploy.mockResolvedValue({
        success: true,
        services: [],
        deploymentTime: 30000,
        errors: [],
        warnings: [],
      });

      const args = { noWait: true };

      await command.execute(args, mockContext);

      expect(mockOrchestrator.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          waitForHealthy: false,
        })
      );
    });

    it('should detect conflicting deployments', async () => {
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.validateConfig.mockReturnValue({ valid: true, errors: [] });
      mockOrchestrator.getStatus.mockResolvedValue({
        projectName: 'different-project',
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

      const result = await command.execute({}, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Conflicting deployment detected');
    });

    it('should handle existing compatible deployments', async () => {
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.validateConfig.mockReturnValue({ valid: true, errors: [] });
      mockOrchestrator.getStatus.mockResolvedValue({
        projectName: 'otp-test', // Same project name
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
      mockOrchestrator.deploy.mockResolvedValue({
        success: true,
        services: [],
        deploymentTime: 30000,
        errors: [],
        warnings: [],
      });

      const result = await command.execute({}, mockContext);

      expect(result.success).toBe(true);
      expect(mockOrchestrator.deploy).toHaveBeenCalled();
    });

    it('should include warnings in success result', async () => {
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.validateConfig.mockReturnValue({ valid: true, errors: [] });
      mockOrchestrator.getStatus.mockResolvedValue({
        projectName: 'otp-test',
        isRunning: false,
        services: [],
        composeFiles: [],
      });
      mockOrchestrator.deploy.mockResolvedValue({
        success: true,
        services: [
          {
            name: 'grafana',
            containers: [],
            status: 'running',
            health: 'healthy',
            endpoints: [{ name: 'web', url: 'http://localhost:3000', port: 3000, protocol: 'http' }],
          },
        ],
        deploymentTime: 30000,
        errors: [],
        warnings: ['Image pull took longer than expected'],
      });

      const result = await command.execute({}, mockContext);

      expect(result.success).toBe(true);
      expect(result.data?.warnings).toEqual(['Image pull took longer than expected']);
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

    it('should validate health timeout argument', () => {
      expect(() => (command as any).validateArgs({ healthTimeout: 0 })).toThrow(
        'Health timeout must be a positive number'
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
          timeout: 300,
          healthTimeout: 120,
          profile: 'local',
          build: true,
          pull: true,
          noWait: false,
          services: 'grafana,prometheus',
        })
      ).not.toThrow();
    });
  });

  describe('deployment plan display', () => {
    it('should show deployment plan', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      (command as any).showDeploymentPlan(mockConfig, {
        profile: 'local',
        build: true,
        pullImages: false,
        waitForHealthy: true,
        services: ['grafana'],
      });

      expect(consoleSpy).toHaveBeenCalledWith('\n📋 Deployment Plan:');
      expect(consoleSpy).toHaveBeenCalledWith('   Profile: local');
      expect(consoleSpy).toHaveBeenCalledWith('   Services: grafana');
      expect(consoleSpy).toHaveBeenCalledWith('   Build: Yes');

      consoleSpy.mockRestore();
    });
  });

  describe('success message formatting', () => {
    it('should format success message with service details', () => {
      const result = {
        services: [
          {
            name: 'grafana',
            containers: [],
            status: 'running',
            health: 'healthy',
            endpoints: [{ name: 'web', url: 'http://localhost:3000', port: 3000, protocol: 'http' }],
          },
          {
            name: 'prometheus',
            containers: [],
            status: 'running',
            health: 'healthy',
            endpoints: [{ name: 'web', url: 'http://localhost:9090', port: 9090, protocol: 'http' }],
          },
        ],
        deploymentTime: 45000,
      };

      const message = (command as any).formatSuccessMessage(result);

      expect(message).toContain('deployed successfully');
      expect(message).toContain('Services: 2 deployed, 2 healthy');
      expect(message).toContain('Time: 45 seconds');
    });
  });
});