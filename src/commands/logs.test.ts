/**
 * Tests for the logs command
 */

import { LogsCommand, LogsOptions, ServiceLogs, ContainerLogs } from './logs';
import { CommandContext } from './types';
import { ServiceManager } from '../docker/service-manager';
import { DefaultConfigurationManager } from '../config/manager';

// Mock dependencies
jest.mock('../docker/service-manager');
jest.mock('../config/manager');
jest.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  })
}));

const MockServiceManager = ServiceManager as jest.MockedClass<typeof ServiceManager>;
const MockConfigurationManager = DefaultConfigurationManager as jest.MockedClass<typeof DefaultConfigurationManager>;

describe('LogsCommand', () => {
  let command: LogsCommand;
  let mockServiceManager: jest.Mocked<ServiceManager>;
  let mockConfigManager: jest.Mocked<DefaultConfigurationManager>;
  let mockContext: CommandContext;

  beforeEach(() => {
    command = new LogsCommand();
    
    // Setup mocks
    mockConfigManager = {
      loadConfig: jest.fn(),
      validateConfig: jest.fn(),
      getActiveProfile: jest.fn()
    } as any;

    mockServiceManager = {
      getService: jest.fn(),
      getServices: jest.fn(),
      getServiceLogs: jest.fn(),
      validateDockerConnection: jest.fn()
    } as any;
    
    mockContext = {
      verbose: false,
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    };

    // Setup default mocks
    mockConfigManager.loadConfig.mockResolvedValue({
      infrastructure: {
        compose: {
          projectName: 'otp-test',
        },
      },
    } as any);

    mockServiceManager.validateDockerConnection.mockResolvedValue({
      connected: true,
      version: '20.10.0',
      apiVersion: '1.41',
    });

    // Mock the constructor calls
    MockConfigurationManager.mockImplementation(() => mockConfigManager);
    MockServiceManager.mockImplementation(() => mockServiceManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Command Properties', () => {
    it('should have correct command properties', () => {
      expect(command.name).toBe('logs');
      expect(command.description).toBe('Retrieve and display service logs for debugging');
      expect(command.aliases).toContain('log');
      expect(command.examples).toHaveLength(7);
      expect(command.options).toHaveLength(6);
    });
  });

  describe('Single Service Logs', () => {
    it('should retrieve logs for a specific service', async () => {
      const mockService = {
        name: 'grafana',
        containers: [
          { id: 'container1', name: 'grafana-1', state: 'running' },
        ],
        status: 'running',
        health: 'healthy',
        endpoints: [],
      };

      const mockLogs = {
        'grafana-1': '2023-01-01T00:00:00Z Starting Grafana\n2023-01-01T00:00:01Z Server started',
      };

      mockServiceManager.getService.mockResolvedValue(mockService as any);
      mockServiceManager.getServiceLogs.mockResolvedValue(mockLogs);

      const result = await command.execute({ service: 'grafana' }, mockContext);

      expect(result.success).toBe(true);
      expect(result.message).toContain('=== Logs for service: grafana ===');
      expect(result.message).toContain('📦 Container: grafana-1');
      expect(result.message).toContain('Starting Grafana');
      expect(mockServiceManager.getService).toHaveBeenCalledWith('grafana');
      expect(mockServiceManager.getServiceLogs).toHaveBeenCalledWith('grafana', 100);
    });

    it('should handle service not found', async () => {
      mockServiceManager.getService.mockResolvedValue(null);

      const result = await command.execute({ service: 'nonexistent' }, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toBe("Service 'nonexistent' not found");
    });

    it('should handle service with no containers', async () => {
      const mockService = {
        name: 'grafana',
        containers: [],
        status: 'stopped',
        health: 'unknown',
        endpoints: [],
      };

      mockServiceManager.getService.mockResolvedValue(mockService as any);

      const result = await command.execute({ service: 'grafana' }, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toBe("No containers found for service 'grafana'");
    });
  });

  describe('All Services Logs', () => {
    it('should retrieve logs for all services', async () => {
      const mockServices = [
        {
          name: 'grafana',
          containers: [{ id: 'container1', name: 'grafana-1', state: 'running' }],
          status: 'running',
          health: 'healthy',
          endpoints: [],
        },
        {
          name: 'prometheus',
          containers: [{ id: 'container2', name: 'prometheus-1', state: 'running' }],
          status: 'running',
          health: 'healthy',
          endpoints: [],
        },
      ];

      const mockGrafanaLogs = {
        'grafana-1': '2023-01-01T00:00:00Z Grafana log line 1\n2023-01-01T00:00:01Z Grafana log line 2',
      };

      const mockPrometheusLogs = {
        'prometheus-1': '2023-01-01T00:00:00Z Prometheus log line 1\n2023-01-01T00:00:01Z Prometheus log line 2',
      };

      mockServiceManager.getServices.mockResolvedValue(mockServices as any);
      mockServiceManager.getServiceLogs
        .mockResolvedValueOnce(mockGrafanaLogs)
        .mockResolvedValueOnce(mockPrometheusLogs);

      const result = await command.execute({}, mockContext);

      expect(result.success).toBe(true);
      expect(result.message).toContain('=== Logs for all services ===');
      expect(result.message).toContain('🔧 Service: grafana');
      expect(result.message).toContain('🔧 Service: prometheus');
      expect(result.message).toContain('📦 grafana-1');
      expect(result.message).toContain('📦 prometheus-1');
    });

    it('should handle no services found', async () => {
      mockServiceManager.getServices.mockResolvedValue([]);

      const result = await command.execute({}, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toBe('No services found');
    });

    it('should handle errors for individual services gracefully', async () => {
      const mockServices = [
        {
          name: 'grafana',
          containers: [{ id: 'container1', name: 'grafana-1', state: 'running' }],
          status: 'running',
          health: 'healthy',
          endpoints: [],
        },
      ];

      mockServiceManager.getServices.mockResolvedValue(mockServices as any);
      mockServiceManager.getServiceLogs.mockRejectedValue(new Error('Container not accessible'));

      const result = await command.execute({}, mockContext);

      expect(result.success).toBe(true);
      expect(result.message).toContain('=== Logs for all services ===');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].containers[0].error).toBe('Container not accessible');
    });
  });

  describe('Log Filtering', () => {
    it('should filter logs by tail parameter', async () => {
      const mockService = {
        name: 'grafana',
        containers: [{ id: 'container1', name: 'grafana-1', state: 'running' }],
        status: 'running',
        health: 'healthy',
        endpoints: [],
      };

      mockServiceManager.getService.mockResolvedValue(mockService as any);
      mockServiceManager.getServiceLogs.mockResolvedValue({
        'grafana-1': 'log content',
      });

      await command.execute({ service: 'grafana', tail: 50 }, mockContext);

      expect(mockServiceManager.getServiceLogs).toHaveBeenCalledWith('grafana', 50);
    });

    it('should filter logs by pattern', async () => {
      const mockService = {
        name: 'grafana',
        containers: [{ id: 'container1', name: 'grafana-1', state: 'running' }],
        status: 'running',
        health: 'healthy',
        endpoints: [],
      };

      const mockLogs = {
        'grafana-1': '2023-01-01T00:00:00Z INFO: Starting server\n2023-01-01T00:00:01Z ERROR: Connection failed\n2023-01-01T00:00:02Z INFO: Retrying connection',
      };

      mockServiceManager.getService.mockResolvedValue(mockService as any);
      mockServiceManager.getServiceLogs.mockResolvedValue(mockLogs);

      const result = await command.execute({ service: 'grafana', filter: 'ERROR' }, mockContext);

      expect(result.success).toBe(true);
      expect(result.message).toContain('ERROR: Connection failed');
      expect(result.message).not.toContain('INFO: Starting server');
    });

    it('should remove timestamps when not requested', async () => {
      const mockService = {
        name: 'grafana',
        containers: [{ id: 'container1', name: 'grafana-1', state: 'running' }],
        status: 'running',
        health: 'healthy',
        endpoints: [],
      };

      const mockLogs = {
        'grafana-1': '2023-01-01T00:00:00.123456789Z Starting server\n2023-01-01T00:00:01.987654321Z Server ready',
      };

      mockServiceManager.getService.mockResolvedValue(mockService as any);
      mockServiceManager.getServiceLogs.mockResolvedValue(mockLogs);

      const result = await command.execute({ service: 'grafana', timestamps: false }, mockContext);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Starting server');
      expect(result.message).toContain('Server ready');
      expect(result.message).not.toContain('2023-01-01T00:00:00');
    });

    it('should preserve timestamps when requested', async () => {
      const mockService = {
        name: 'grafana',
        containers: [{ id: 'container1', name: 'grafana-1', state: 'running' }],
        status: 'running',
        health: 'healthy',
        endpoints: [],
      };

      const mockLogs = {
        'grafana-1': '2023-01-01T00:00:00.123456789Z Starting server\n2023-01-01T00:00:01.987654321Z Server ready',
      };

      mockServiceManager.getService.mockResolvedValue(mockService as any);
      mockServiceManager.getServiceLogs.mockResolvedValue(mockLogs);

      const result = await command.execute({ service: 'grafana', timestamps: true }, mockContext);

      expect(result.success).toBe(true);
      expect(result.message).toContain('2023-01-01T00:00:00.123456789Z Starting server');
      expect(result.message).toContain('2023-01-01T00:00:01.987654321Z Server ready');
    });
  });

  describe('Validation', () => {
    it('should validate tail parameter range', async () => {
      const result = await command.execute({ service: 'grafana', tail: 20000 }, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Tail value must be between 1 and 10000');
    });

    it('should validate since time format', async () => {
      // Mock service to exist so we get to validation
      const mockService = {
        name: 'grafana',
        containers: [{ id: 'container1', name: 'grafana-1', state: 'running' }],
        status: 'running',
        health: 'healthy',
        endpoints: [],
      };
      mockServiceManager.getService.mockResolvedValue(mockService as any);

      const result = await command.execute({ service: 'grafana', since: 'invalid-time' }, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid time format');
    });

    it('should accept valid relative time formats', async () => {
      const mockService = {
        name: 'grafana',
        containers: [{ id: 'container1', name: 'grafana-1', state: 'running' }],
        status: 'running',
        health: 'healthy',
        endpoints: [],
      };

      mockServiceManager.getService.mockResolvedValue(mockService as any);
      mockServiceManager.getServiceLogs.mockResolvedValue({ 'grafana-1': 'logs' });

      const validFormats = ['1h', '30m', '45s'];
      
      for (const format of validFormats) {
        const result = await command.execute({ service: 'grafana', since: format }, mockContext);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('Docker Connection', () => {
    it('should handle Docker connection failure', async () => {
      mockServiceManager.validateDockerConnection.mockResolvedValue({
        connected: false,
        error: 'Docker daemon not running',
      });

      const result = await command.execute({ service: 'grafana' }, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Docker is not available: Docker daemon not running');
    });
  });

  describe('Follow Mode', () => {
    it('should handle follow mode setup', async () => {
      const mockService = {
        name: 'grafana',
        containers: [{ id: 'container1', name: 'grafana-1', state: 'running' }],
        status: 'running',
        health: 'healthy',
        endpoints: [],
      };

      mockServiceManager.getService.mockResolvedValue(mockService as any);
      mockServiceManager.getServiceLogs.mockResolvedValue({
        'grafana-1': 'Initial log content',
      });

      // Mock process.on to prevent actual event listener setup in tests
      const originalProcessOn = process.on;
      const originalSetInterval = global.setInterval;
      const originalClearInterval = global.clearInterval;
      
      process.on = jest.fn();
      global.setInterval = jest.fn().mockReturnValue(123);
      global.clearInterval = jest.fn();

      // Since follow mode runs indefinitely, we'll test the initial setup
      const executePromise = command.execute({ service: 'grafana', follow: true }, mockContext);
      
      // Give it a moment to start
      await new Promise(resolve => setTimeout(resolve, 50));

      // Restore functions
      process.on = originalProcessOn;
      global.setInterval = originalSetInterval;
      global.clearInterval = originalClearInterval;

      // The follow mode should have started (we can't easily test the full flow in unit tests)
      expect(mockServiceManager.getService).toHaveBeenCalledWith('grafana');
    });
  });

  describe('Time Parsing', () => {
    it('should parse relative time formats correctly', () => {
      const command = new LogsCommand();
      const now = new Date();
      
      // Test private method through reflection for unit testing
      const parseSinceTime = (command as any).parseSinceTime.bind(command);
      
      const oneHourAgo = parseSinceTime('1h');
      const thirtyMinutesAgo = parseSinceTime('30m');
      const fortyFiveSecondsAgo = parseSinceTime('45s');
      
      expect(oneHourAgo.getTime()).toBeLessThan(now.getTime());
      expect(thirtyMinutesAgo.getTime()).toBeLessThan(now.getTime());
      expect(fortyFiveSecondsAgo.getTime()).toBeLessThan(now.getTime());
      
      // Check approximate correctness (within 1 second tolerance)
      expect(Math.abs(now.getTime() - oneHourAgo.getTime() - 3600000)).toBeLessThan(1000);
      expect(Math.abs(now.getTime() - thirtyMinutesAgo.getTime() - 1800000)).toBeLessThan(1000);
      expect(Math.abs(now.getTime() - fortyFiveSecondsAgo.getTime() - 45000)).toBeLessThan(1000);
    });

    it('should parse absolute timestamps correctly', () => {
      const command = new LogsCommand();
      const parseSinceTime = (command as any).parseSinceTime.bind(command);
      
      const timestamp = '2023-01-01T12:00:00Z';
      const parsed = parseSinceTime(timestamp);
      
      expect(parsed.toISOString()).toBe('2023-01-01T12:00:00.000Z');
    });
  });
});