/**
 * Tests for Docker service manager
 */

import { ServiceManager } from './service-manager';
import { DockerClient } from './client';
import { ServiceInfo, ContainerInfo } from './types';

// Mock the DockerClient
jest.mock('./client');
const MockedDockerClient = DockerClient as jest.MockedClass<typeof DockerClient>;

describe('ServiceManager', () => {
  let serviceManager: ServiceManager;
  let mockDockerClient: jest.Mocked<DockerClient>;

  const mockContainerInfo: ContainerInfo = {
    id: 'container1',
    name: 'test-container',
    image: 'nginx:latest',
    status: 'running',
    state: 'running',
    ports: [{ privatePort: 80, publicPort: 8080, type: 'tcp' }],
    labels: { 'com.docker.compose.service': 'web' },
    created: new Date()
  };

  const mockServiceInfo: ServiceInfo = {
    name: 'web',
    containers: [mockContainerInfo],
    status: 'running',
    health: 'healthy',
    endpoints: [
      {
        name: 'test-container:80',
        url: 'http://localhost:8080',
        port: 8080,
        protocol: 'http'
      }
    ]
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockDockerClient = {
      getServices: jest.fn(),
      startContainer: jest.fn(),
      stopContainer: jest.fn(),
      removeContainer: jest.fn(),
      getContainerLogs: jest.fn(),
      validateConnection: jest.fn()
    } as any;

    MockedDockerClient.mockImplementation(() => mockDockerClient);
    
    serviceManager = new ServiceManager({}, {}, { projectName: 'otp' });
  });

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      expect(MockedDockerClient).toHaveBeenCalledWith({}, {});
    });

    it('should initialize with custom configuration', () => {
      const dockerConfig = { host: 'localhost', port: 2376 };
      const dockerOptions = { timeout: 60000 };
      const config = { projectName: 'test', timeout: 45000 };

      new ServiceManager(dockerConfig, dockerOptions, config);

      expect(MockedDockerClient).toHaveBeenCalledWith(dockerConfig, dockerOptions);
    });
  });

  describe('getServices', () => {
    it('should return all services for the project', async () => {
      mockDockerClient.getServices.mockResolvedValue([mockServiceInfo]);

      const result = await serviceManager.getServices();

      expect(result).toEqual([mockServiceInfo]);
      expect(mockDockerClient.getServices).toHaveBeenCalledWith('otp');
    });

    it('should handle errors when getting services', async () => {
      const error = new Error('Docker API error');
      mockDockerClient.getServices.mockRejectedValue(error);

      await expect(serviceManager.getServices()).rejects.toThrow('Failed to get services: Docker API error');
    });
  });

  describe('getService', () => {
    it('should return a specific service by name', async () => {
      mockDockerClient.getServices.mockResolvedValue([mockServiceInfo]);

      const result = await serviceManager.getService('web');

      expect(result).toEqual(mockServiceInfo);
    });

    it('should return null when service is not found', async () => {
      mockDockerClient.getServices.mockResolvedValue([mockServiceInfo]);

      const result = await serviceManager.getService('nonexistent');

      expect(result).toBeNull();
    });

    it('should handle errors when getting service', async () => {
      const error = new Error('Docker API error');
      mockDockerClient.getServices.mockRejectedValue(error);

      await expect(serviceManager.getService('web')).rejects.toThrow('Failed to get service: Failed to get services: Docker API error');
    });
  });

  describe('startService', () => {
    it('should start all stopped containers in a service', async () => {
      const stoppedContainer: ContainerInfo = {
        ...mockContainerInfo,
        id: 'container2',
        state: 'stopped'
      };
      
      const serviceWithStoppedContainer: ServiceInfo = {
        ...mockServiceInfo,
        containers: [mockContainerInfo, stoppedContainer]
      };

      mockDockerClient.getServices.mockResolvedValue([serviceWithStoppedContainer]);
      mockDockerClient.startContainer.mockResolvedValue(undefined);

      const result = await serviceManager.startService('web');

      expect(result).toEqual({
        service: 'web',
        operation: 'start',
        success: true
      });
      expect(mockDockerClient.startContainer).toHaveBeenCalledWith('container2');
      expect(mockDockerClient.startContainer).toHaveBeenCalledTimes(1);
    });

    it('should handle service not found', async () => {
      mockDockerClient.getServices.mockResolvedValue([]);

      const result = await serviceManager.startService('nonexistent');

      expect(result).toEqual({
        service: 'nonexistent',
        operation: 'start',
        success: false,
        error: "Service 'nonexistent' not found"
      });
    });

    it('should handle container start errors', async () => {
      const stoppedContainer: ContainerInfo = {
        ...mockContainerInfo,
        state: 'stopped'
      };
      
      const serviceWithStoppedContainer: ServiceInfo = {
        ...mockServiceInfo,
        containers: [stoppedContainer]
      };

      mockDockerClient.getServices.mockResolvedValue([serviceWithStoppedContainer]);
      mockDockerClient.startContainer.mockRejectedValue(new Error('Container start failed'));

      const result = await serviceManager.startService('web');

      expect(result).toEqual({
        service: 'web',
        operation: 'start',
        success: false,
        error: 'Container start failed'
      });
    });
  });

  describe('stopService', () => {
    it('should stop all running containers in a service', async () => {
      mockDockerClient.getServices.mockResolvedValue([mockServiceInfo]);
      mockDockerClient.stopContainer.mockResolvedValue(undefined);

      const result = await serviceManager.stopService('web', 15);

      expect(result).toEqual({
        service: 'web',
        operation: 'stop',
        success: true
      });
      expect(mockDockerClient.stopContainer).toHaveBeenCalledWith('container1', 15);
    });

    it('should handle service not found', async () => {
      mockDockerClient.getServices.mockResolvedValue([]);

      const result = await serviceManager.stopService('nonexistent');

      expect(result).toEqual({
        service: 'nonexistent',
        operation: 'stop',
        success: false,
        error: "Service 'nonexistent' not found"
      });
    });

    it('should handle container stop errors', async () => {
      mockDockerClient.getServices.mockResolvedValue([mockServiceInfo]);
      mockDockerClient.stopContainer.mockRejectedValue(new Error('Container stop failed'));

      const result = await serviceManager.stopService('web');

      expect(result).toEqual({
        service: 'web',
        operation: 'stop',
        success: false,
        error: 'Container stop failed'
      });
    });
  });

  describe('restartService', () => {
    it('should restart a service successfully', async () => {
      // Mock for stop operation
      mockDockerClient.getServices.mockResolvedValueOnce([mockServiceInfo]);
      mockDockerClient.stopContainer.mockResolvedValue(undefined);
      
      // Mock for start operation - need stopped container for start to work
      const stoppedContainer: ContainerInfo = {
        ...mockContainerInfo,
        state: 'stopped'
      };
      const stoppedService: ServiceInfo = {
        ...mockServiceInfo,
        containers: [stoppedContainer]
      };
      mockDockerClient.getServices.mockResolvedValueOnce([stoppedService]);
      mockDockerClient.startContainer.mockResolvedValue(undefined);

      const result = await serviceManager.restartService('web');

      expect(result).toEqual({
        service: 'web',
        operation: 'restart',
        success: true
      });
      expect(mockDockerClient.stopContainer).toHaveBeenCalledWith('container1', 10);
      expect(mockDockerClient.startContainer).toHaveBeenCalledWith('container1');
    });

    it('should handle stop failure during restart', async () => {
      mockDockerClient.getServices.mockResolvedValue([mockServiceInfo]);
      mockDockerClient.stopContainer.mockRejectedValue(new Error('Stop failed'));

      const result = await serviceManager.restartService('web');

      expect(result).toEqual({
        service: 'web',
        operation: 'restart',
        success: false,
        error: 'Failed to stop service: Stop failed'
      });
    });

    it('should handle start failure during restart', async () => {
      mockDockerClient.getServices
        .mockResolvedValueOnce([mockServiceInfo]) // For stop
        .mockResolvedValueOnce([]); // For start (service not found)

      const result = await serviceManager.restartService('web');

      expect(result).toEqual({
        service: 'web',
        operation: 'restart',
        success: false,
        error: "Failed to start service: Service 'web' not found"
      });
    });
  });

  describe('removeService', () => {
    it('should remove all containers in a service', async () => {
      mockDockerClient.getServices.mockResolvedValue([mockServiceInfo]);
      mockDockerClient.stopContainer.mockResolvedValue(undefined);
      mockDockerClient.removeContainer.mockResolvedValue(undefined);

      const result = await serviceManager.removeService('web');

      expect(result).toEqual({
        service: 'web',
        operation: 'remove',
        success: true
      });
      expect(mockDockerClient.stopContainer).toHaveBeenCalledWith('container1');
      expect(mockDockerClient.removeContainer).toHaveBeenCalledWith('container1', false);
    });

    it('should force remove without stopping when requested', async () => {
      mockDockerClient.getServices.mockResolvedValue([mockServiceInfo]);
      mockDockerClient.removeContainer.mockResolvedValue(undefined);

      const result = await serviceManager.removeService('web', true);

      expect(result).toEqual({
        service: 'web',
        operation: 'remove',
        success: true
      });
      expect(mockDockerClient.stopContainer).not.toHaveBeenCalled();
      expect(mockDockerClient.removeContainer).toHaveBeenCalledWith('container1', true);
    });

    it('should handle service not found', async () => {
      mockDockerClient.getServices.mockResolvedValue([]);

      const result = await serviceManager.removeService('nonexistent');

      expect(result).toEqual({
        service: 'nonexistent',
        operation: 'remove',
        success: false,
        error: "Service 'nonexistent' not found"
      });
    });
  });

  describe('startServices', () => {
    it('should start multiple services successfully', async () => {
      const service2: ServiceInfo = {
        ...mockServiceInfo,
        name: 'db',
        containers: [{ ...mockContainerInfo, id: 'container2', state: 'stopped' }]
      };

      mockDockerClient.getServices
        .mockResolvedValueOnce([mockServiceInfo])
        .mockResolvedValueOnce([service2]);
      mockDockerClient.startContainer.mockResolvedValue(undefined);

      const result = await serviceManager.startServices(['web', 'db']);

      expect(result.success).toBe(true);
      expect(result.operations).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle partial failures', async () => {
      mockDockerClient.getServices
        .mockResolvedValueOnce([mockServiceInfo])
        .mockResolvedValueOnce([]);

      const result = await serviceManager.startServices(['web', 'nonexistent']);

      expect(result.success).toBe(false);
      expect(result.operations).toHaveLength(2);
      expect(result.operations[0].success).toBe(true);
      expect(result.operations[1].success).toBe(false);
      expect(result.errors).toContain("nonexistent: Service 'nonexistent' not found");
    });
  });

  describe('stopServices', () => {
    it('should stop multiple services successfully', async () => {
      const service2: ServiceInfo = {
        ...mockServiceInfo,
        name: 'db',
        containers: [{ ...mockContainerInfo, id: 'container2' }]
      };

      mockDockerClient.getServices
        .mockResolvedValueOnce([mockServiceInfo])
        .mockResolvedValueOnce([service2]);
      mockDockerClient.stopContainer.mockResolvedValue(undefined);

      const result = await serviceManager.stopServices(['web', 'db'], 20);

      expect(result.success).toBe(true);
      expect(result.operations).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
      expect(mockDockerClient.stopContainer).toHaveBeenCalledWith('container1', 20);
      expect(mockDockerClient.stopContainer).toHaveBeenCalledWith('container2', 20);
    });
  });

  describe('getServiceLogs', () => {
    it('should get logs for all containers in a service', async () => {
      const container2: ContainerInfo = {
        ...mockContainerInfo,
        id: 'container2',
        name: 'test-container-2'
      };
      
      const serviceWithMultipleContainers: ServiceInfo = {
        ...mockServiceInfo,
        containers: [mockContainerInfo, container2]
      };

      mockDockerClient.getServices.mockResolvedValue([serviceWithMultipleContainers]);
      mockDockerClient.getContainerLogs
        .mockResolvedValueOnce('Logs from container 1')
        .mockResolvedValueOnce('Logs from container 2');

      const result = await serviceManager.getServiceLogs('web', 50);

      expect(result).toEqual({
        'test-container': 'Logs from container 1',
        'test-container-2': 'Logs from container 2'
      });
      expect(mockDockerClient.getContainerLogs).toHaveBeenCalledWith('container1', 50);
      expect(mockDockerClient.getContainerLogs).toHaveBeenCalledWith('container2', 50);
    });

    it('should handle log retrieval errors for individual containers', async () => {
      mockDockerClient.getServices.mockResolvedValue([mockServiceInfo]);
      mockDockerClient.getContainerLogs.mockRejectedValue(new Error('Log error'));

      const result = await serviceManager.getServiceLogs('web');

      expect(result).toEqual({
        'test-container': 'Error getting logs: Log error'
      });
    });

    it('should handle service not found', async () => {
      mockDockerClient.getServices.mockResolvedValue([]);

      await expect(serviceManager.getServiceLogs('nonexistent')).rejects.toThrow("Service 'nonexistent' not found");
    });
  });

  describe('waitForServiceHealth', () => {
    it('should return true when service becomes healthy', async () => {
      const healthyService: ServiceInfo = {
        ...mockServiceInfo,
        health: 'healthy'
      };

      mockDockerClient.getServices.mockResolvedValue([healthyService]);

      const result = await serviceManager.waitForServiceHealth('web', 5000, 1000);

      expect(result).toBe(true);
    });

    it('should return false when timeout is reached', async () => {
      const unhealthyService: ServiceInfo = {
        ...mockServiceInfo,
        health: 'unhealthy'
      };

      mockDockerClient.getServices.mockResolvedValue([unhealthyService]);

      const result = await serviceManager.waitForServiceHealth('web', 2000, 1000);

      expect(result).toBe(false);
    }, 10000);

    it('should handle errors during health checking', async () => {
      mockDockerClient.getServices.mockRejectedValue(new Error('API error'));

      const result = await serviceManager.waitForServiceHealth('web', 2000, 1000);

      expect(result).toBe(false);
    }, 10000);
  });

  describe('validateDockerConnection', () => {
    it('should validate Docker connection', async () => {
      const connectionStatus = { connected: true, version: '20.10.0' };
      mockDockerClient.validateConnection.mockResolvedValue(connectionStatus);

      const result = await serviceManager.validateDockerConnection();

      expect(result).toEqual(connectionStatus);
      expect(mockDockerClient.validateConnection).toHaveBeenCalled();
    });
  });
});