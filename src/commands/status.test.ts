/**
 * Tests for StatusCommand
 */

import { StatusCommand, ServiceStatus, InfrastructureStatus } from './status';
import { CommandContext } from './types';

describe('StatusCommand', () => {
  let statusCommand: StatusCommand;
  let mockContext: CommandContext;

  beforeEach(() => {
    statusCommand = new StatusCommand();
    mockContext = {
      verbose: false,
      logger: { debug: jest.fn(), error: jest.fn() },
    };

    // Mock Math.random to make tests deterministic
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('command properties', () => {
    it('should have correct properties', () => {
      expect(statusCommand.name).toBe('status');
      expect(statusCommand.description).toBe('Check infrastructure health and service states');
      expect(statusCommand.usage).toBe('[options]');
      expect(statusCommand.aliases).toEqual(['st']);
      expect(statusCommand.examples).toContain('otp status');
    });
  });

  describe('execute', () => {
    it('should check all services by default', async () => {
      const result = await statusCommand.execute({}, mockContext);
      
      expect(result.success).toBeDefined();
      expect(result.message).toContain('OTP Infrastructure Status');
      expect(result.message).toContain('Services:');
      expect(result.data).toHaveProperty('overall');
      expect(result.data).toHaveProperty('services');
    });

    it('should check specific service when requested', async () => {
      const result = await statusCommand.execute({ service: 'grafana' }, mockContext);
      
      expect(result.success).toBeDefined();
      expect(result.message).toContain('Service: grafana');
      expect(result.message).toContain('Status:');
      expect(result.message).toContain('Health:');
      expect(result.data).toHaveProperty('name', 'grafana');
    });

    it('should handle unknown service', async () => {
      const result = await statusCommand.execute({ service: 'unknown' }, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe("Service 'unknown' not found");
    });

    it('should show detailed information when verbose', async () => {
      const verboseContext = { ...mockContext, verbose: true };
      const result = await statusCommand.execute({}, verboseContext);
      
      expect(result.success).toBeDefined();
      expect(result.message).toContain('OTP Infrastructure Status');
      // Should include port information in verbose mode
      expect(result.message).toMatch(/:\d+/); // Port numbers
    });

    it('should show detailed information with verbose flag', async () => {
      const result = await statusCommand.execute({ verbose: true }, mockContext);
      
      expect(result.success).toBeDefined();
      expect(result.message).toContain('OTP Infrastructure Status');
    });

    it('should handle errors gracefully', async () => {
      // Mock a method to throw an error
      jest.spyOn(statusCommand as any, 'getInfrastructureStatus').mockRejectedValue(new Error('Connection failed'));

      const result = await statusCommand.execute({}, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection failed');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('service status checking', () => {
    it('should return service status for known services', async () => {
      const getServiceStatus = (statusCommand as any).getServiceStatus.bind(statusCommand);
      const status = await getServiceStatus('grafana');
      
      expect(status).not.toBeNull();
      expect(status.name).toBe('grafana');
      expect(status.ports).toContain(3000);
      expect(['running', 'stopped']).toContain(status.status);
      expect(['healthy', 'unhealthy', 'unknown']).toContain(status.health);
    });

    it('should return null for unknown services', async () => {
      const getServiceStatus = (statusCommand as any).getServiceStatus.bind(statusCommand);
      const status = await getServiceStatus('unknown');
      
      expect(status).toBeNull();
    });

    it('should include endpoint for services that have one', async () => {
      const getServiceStatus = (statusCommand as any).getServiceStatus.bind(statusCommand);
      const status = await getServiceStatus('grafana');
      
      expect(status.endpoint).toBe('http://localhost:3000/api/health');
    });

    it('should not include endpoint for services without one', async () => {
      const getServiceStatus = (statusCommand as any).getServiceStatus.bind(statusCommand);
      const status = await getServiceStatus('postgres');
      
      expect(status.endpoint).toBeUndefined();
    });
  });

  describe('infrastructure status aggregation', () => {
    it('should calculate overall health correctly', async () => {
      // Mock all services as healthy
      jest.spyOn(Math, 'random')
        .mockReturnValueOnce(0.9) // grafana running
        .mockReturnValueOnce(0.9) // grafana healthy
        .mockReturnValueOnce(0.9) // prometheus running
        .mockReturnValueOnce(0.9) // prometheus healthy
        .mockReturnValueOnce(0.9) // loki running
        .mockReturnValueOnce(0.9) // loki healthy
        .mockReturnValueOnce(0.9) // tempo running
        .mockReturnValueOnce(0.9) // tempo healthy
        .mockReturnValueOnce(0.9) // postgres running
        .mockReturnValueOnce(0.9) // postgres healthy
        .mockReturnValueOnce(0.9) // minio running
        .mockReturnValueOnce(0.9); // minio healthy

      const getInfrastructureStatus = (statusCommand as any).getInfrastructureStatus.bind(statusCommand);
      const status = await getInfrastructureStatus();
      
      expect(status.overall).toBe('healthy');
      expect(status.services).toHaveLength(6);
    });

    it('should detect degraded state', async () => {
      // Mock some services as unhealthy - need to make more services unhealthy
      jest.spyOn(Math, 'random')
        .mockReturnValueOnce(0.9) // grafana running
        .mockReturnValueOnce(0.05) // grafana unhealthy
        .mockReturnValueOnce(0.9) // prometheus running
        .mockReturnValueOnce(0.05) // prometheus unhealthy
        .mockReturnValueOnce(0.9) // loki running
        .mockReturnValueOnce(0.9) // loki healthy
        .mockReturnValueOnce(0.1) // tempo stopped
        .mockReturnValueOnce(0.9) // tempo health (irrelevant)
        .mockReturnValueOnce(0.9) // postgres running
        .mockReturnValueOnce(0.9) // postgres healthy
        .mockReturnValueOnce(0.9) // minio running
        .mockReturnValueOnce(0.9); // minio healthy

      const getInfrastructureStatus = (statusCommand as any).getInfrastructureStatus.bind(statusCommand);
      const status = await getInfrastructureStatus();
      
      expect(status.overall).toBe('degraded');
    });
  });

  describe('output formatting', () => {
    it('should format infrastructure status correctly', () => {
      const mockStatus: InfrastructureStatus = {
        overall: 'healthy',
        services: [
          {
            name: 'grafana',
            status: 'running',
            health: 'healthy',
            ports: [3000],
            uptime: '2h 30m',
            lastCheck: new Date('2023-12-01T10:00:00Z'),
          },
          {
            name: 'prometheus',
            status: 'stopped',
            health: 'unknown',
            ports: [9090],
            lastCheck: new Date('2023-12-01T10:00:00Z'),
          },
        ],
        lastUpdated: new Date('2023-12-01T10:00:00Z'),
        profile: 'local',
      };

      const formatInfrastructureStatus = (statusCommand as any).formatInfrastructureStatus.bind(statusCommand);
      const output = formatInfrastructureStatus(mockStatus, false);
      
      expect(output).toContain('OTP Infrastructure Status');
      expect(output).toContain('Profile: local');
      expect(output).toContain('Services: 1/2 running, 1/2 healthy');
      expect(output).toContain('grafana');
      expect(output).toContain('prometheus');
    });

    it('should format single service status correctly', () => {
      const mockService: ServiceStatus = {
        name: 'grafana',
        status: 'running',
        health: 'healthy',
        ports: [3000],
        uptime: '2h 30m',
        lastCheck: new Date('2023-12-01T10:00:00Z'),
        endpoint: 'http://localhost:3000/api/health',
      };

      const formatServiceStatus = (statusCommand as any).formatServiceStatus.bind(statusCommand);
      const output = formatServiceStatus(mockService, false);
      
      expect(output).toContain('Service: grafana');
      expect(output).toContain('Status: running');
      expect(output).toContain('Health: healthy');
      expect(output).toContain('Ports: 3000');
      expect(output).toContain('Uptime: 2h 30m');
      expect(output).toContain('Endpoint: http://localhost:3000/api/health');
    });

    it('should include troubleshooting info for unhealthy services', () => {
      const mockService: ServiceStatus = {
        name: 'grafana',
        status: 'running',
        health: 'unhealthy',
        ports: [3000],
        error: 'Connection timeout',
        lastCheck: new Date('2023-12-01T10:00:00Z'),
      };

      const formatServiceStatus = (statusCommand as any).formatServiceStatus.bind(statusCommand);
      const output = formatServiceStatus(mockService, true);
      
      expect(output).toContain('Diagnostic Information:');
      expect(output).toContain('Troubleshooting Steps:');
      expect(output).toContain('Check if the service container is running');
      expect(output).toContain('otp restart grafana');
    });
  });

  describe('status icons', () => {
    it('should return correct status icons', () => {
      const getStatusIcon = (statusCommand as any).getStatusIcon.bind(statusCommand);
      
      expect(getStatusIcon('running')).toBe('✅');
      expect(getStatusIcon('healthy')).toBe('✅');
      expect(getStatusIcon('starting')).toBe('⚠️');
      expect(getStatusIcon('degraded')).toBe('⚠️');
      expect(getStatusIcon('stopped')).toBe('❌');
      expect(getStatusIcon('unhealthy')).toBe('❌');
      expect(getStatusIcon('unknown')).toBe('❓');
    });

    it('should return correct health icons', () => {
      const getHealthIcon = (statusCommand as any).getHealthIcon.bind(statusCommand);
      
      expect(getHealthIcon('healthy')).toBe('🟢');
      expect(getHealthIcon('unhealthy')).toBe('🔴');
      expect(getHealthIcon('unknown')).toBe('🟡');
    });
  });
});