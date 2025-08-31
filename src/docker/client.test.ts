/**
 * Tests for Docker client implementation
 */

import { DockerClient } from './client';
import { DockerClientConfig, DockerClientOptions } from './types';

// Mock dockerode
jest.mock('dockerode');
import Docker from 'dockerode';

const MockedDocker = Docker as jest.MockedClass<typeof Docker>;

describe('DockerClient', () => {
  let dockerClient: DockerClient;
  let mockDocker: jest.Mocked<Docker>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockDocker = {
      version: jest.fn(),
      listContainers: jest.fn(),
      getContainer: jest.fn()
    } as any;

    MockedDocker.mockImplementation(() => mockDocker);
    
    dockerClient = new DockerClient();
  });

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      expect(MockedDocker).toHaveBeenCalledWith({
        socketPath: process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock',
        host: undefined,
        port: undefined,
        protocol: undefined,
        timeout: 30000
      });
    });

    it('should initialize with custom configuration', () => {
      const config: DockerClientConfig = {
        host: 'localhost',
        port: 2376,
        protocol: 'https',
        timeout: 60000
      };
      
      const options: DockerClientOptions = {
        retries: 5,
        retryDelay: 2000
      };

      new DockerClient(config, options);

      expect(MockedDocker).toHaveBeenCalledWith({
        socketPath: process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock',
        host: 'localhost',
        port: 2376,
        protocol: 'https',
        timeout: 60000
      });
    });
  });

  describe('validateConnection', () => {
    it('should return connected status when Docker is available', async () => {
      const mockVersion = {
        Version: '20.10.0',
        ApiVersion: '1.41',
        Arch: 'amd64',
        BuildTime: new Date('2021-01-01T00:00:00.000Z'),
        Components: [],
        GitCommit: 'abc123',
        GoVersion: 'go1.16',
        KernelVersion: '5.4.0',
        MinAPIVersion: '1.12',
        Os: 'linux',
        Platform: {
          Name: 'Docker Engine - Community'
        }
      };
      
      mockDocker.version.mockResolvedValue(mockVersion);

      const result = await dockerClient.validateConnection();

      expect(result).toEqual({
        connected: true,
        version: '20.10.0',
        apiVersion: '1.41'
      });
      expect(mockDocker.version).toHaveBeenCalled();
    });

    it('should return disconnected status when Docker is not available', async () => {
      const error = new Error('Docker daemon not running');
      mockDocker.version.mockRejectedValue(error);

      const result = await dockerClient.validateConnection();

      expect(result).toEqual({
        connected: false,
        error: 'Docker daemon not running'
      });
    });
  });

  describe('listContainers', () => {
    it('should list running containers by default', async () => {
      const mockContainers = [
        {
          Id: 'container1',
          Names: ['/test-container'],
          Image: 'nginx:latest',
          ImageID: 'sha256:abc123',
          Command: 'nginx -g daemon off;',
          State: 'running',
          Status: 'Up 5 minutes',
          Ports: [
            {
              PrivatePort: 80,
              PublicPort: 8080,
              Type: 'tcp',
              IP: '0.0.0.0'
            }
          ],
          Labels: {
            'com.docker.compose.service': 'web'
          },
          Created: 1640995200,
          SizeRw: 0,
          SizeRootFs: 0,
          HostConfig: {
            NetworkMode: 'default'
          },
          NetworkSettings: {
            Networks: {}
          },
          Mounts: []
        }
      ];

      mockDocker.listContainers.mockResolvedValue(mockContainers);

      const result = await dockerClient.listContainers();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'container1',
        name: 'test-container',
        image: 'nginx:latest',
        status: 'running',
        state: 'running',
        ports: [
          {
            privatePort: 80,
            publicPort: 8080,
            type: 'tcp',
            ip: '0.0.0.0'
          }
        ],
        labels: {
          'com.docker.compose.service': 'web'
        },
        created: new Date(1640995200 * 1000)
      });

      expect(mockDocker.listContainers).toHaveBeenCalledWith({
        all: false,
        filters: undefined
      });
    });

    it('should list all containers when requested', async () => {
      mockDocker.listContainers.mockResolvedValue([]);

      await dockerClient.listContainers(true);

      expect(mockDocker.listContainers).toHaveBeenCalledWith({
        all: true,
        filters: undefined
      });
    });

    it('should apply filters when provided', async () => {
      const filters = { label: ['com.docker.compose.project=otp'] };
      mockDocker.listContainers.mockResolvedValue([]);

      await dockerClient.listContainers(false, filters);

      expect(mockDocker.listContainers).toHaveBeenCalledWith({
        all: false,
        filters: JSON.stringify(filters)
      });
    });

    it('should handle errors when listing containers', async () => {
      const error = new Error('Docker API error');
      mockDocker.listContainers.mockRejectedValue(error);

      await expect(dockerClient.listContainers()).rejects.toThrow('Failed to list containers: Docker API error');
    });
  });

  describe('getContainer', () => {
    it('should get container information', async () => {
      const mockContainer = {
        inspect: jest.fn().mockResolvedValue({
          Id: 'container1',
          Name: '/test-container',
          Config: {
            Image: 'nginx:latest',
            Labels: {
              'com.docker.compose.service': 'web'
            }
          },
          State: {
            Status: 'running',
            Running: true,
            ExitCode: 0
          },
          NetworkSettings: {
            Ports: {
              '80/tcp': [
                {
                  HostIp: '0.0.0.0',
                  HostPort: '8080'
                }
              ]
            }
          },
          Created: '2022-01-01T00:00:00.000Z'
        })
      };

      mockDocker.getContainer.mockReturnValue(mockContainer as any);

      const result = await dockerClient.getContainer('container1');

      expect(result).toEqual({
        id: 'container1',
        name: 'test-container',
        image: 'nginx:latest',
        status: 'running',
        state: 'running',
        ports: [
          {
            privatePort: 80,
            publicPort: 8080,
            type: 'tcp',
            ip: '0.0.0.0'
          }
        ],
        labels: {
          'com.docker.compose.service': 'web'
        },
        created: new Date('2022-01-01T00:00:00.000Z')
      });

      expect(mockDocker.getContainer).toHaveBeenCalledWith('container1');
    });

    it('should return null when container is not found', async () => {
      const mockContainer = {
        inspect: jest.fn().mockRejectedValue(new Error('404 - Container not found'))
      };

      mockDocker.getContainer.mockReturnValue(mockContainer as any);

      const result = await dockerClient.getContainer('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw error for other failures', async () => {
      const mockContainer = {
        inspect: jest.fn().mockRejectedValue(new Error('Docker API error'))
      };

      mockDocker.getContainer.mockReturnValue(mockContainer as any);

      await expect(dockerClient.getContainer('container1')).rejects.toThrow('Failed to get container info: Docker API error');
    });
  });

  describe('startContainer', () => {
    it('should start a container', async () => {
      const mockContainer = {
        start: jest.fn().mockResolvedValue(undefined)
      };

      mockDocker.getContainer.mockReturnValue(mockContainer as any);

      await dockerClient.startContainer('container1');

      expect(mockDocker.getContainer).toHaveBeenCalledWith('container1');
      expect(mockContainer.start).toHaveBeenCalled();
    });

    it('should handle start errors', async () => {
      const mockContainer = {
        start: jest.fn().mockRejectedValue(new Error('Container start failed'))
      };

      mockDocker.getContainer.mockReturnValue(mockContainer as any);

      await expect(dockerClient.startContainer('container1')).rejects.toThrow('Failed to start container: Container start failed');
    });
  });

  describe('stopContainer', () => {
    it('should stop a container with default timeout', async () => {
      const mockContainer = {
        stop: jest.fn().mockResolvedValue(undefined)
      };

      mockDocker.getContainer.mockReturnValue(mockContainer as any);

      await dockerClient.stopContainer('container1');

      expect(mockDocker.getContainer).toHaveBeenCalledWith('container1');
      expect(mockContainer.stop).toHaveBeenCalledWith({ t: 10 });
    });

    it('should stop a container with custom timeout', async () => {
      const mockContainer = {
        stop: jest.fn().mockResolvedValue(undefined)
      };

      mockDocker.getContainer.mockReturnValue(mockContainer as any);

      await dockerClient.stopContainer('container1', 30);

      expect(mockContainer.stop).toHaveBeenCalledWith({ t: 30 });
    });

    it('should handle stop errors', async () => {
      const mockContainer = {
        stop: jest.fn().mockRejectedValue(new Error('Container stop failed'))
      };

      mockDocker.getContainer.mockReturnValue(mockContainer as any);

      await expect(dockerClient.stopContainer('container1')).rejects.toThrow('Failed to stop container: Container stop failed');
    });
  });

  describe('removeContainer', () => {
    it('should remove a container', async () => {
      const mockContainer = {
        remove: jest.fn().mockResolvedValue(undefined)
      };

      mockDocker.getContainer.mockReturnValue(mockContainer as any);

      await dockerClient.removeContainer('container1');

      expect(mockDocker.getContainer).toHaveBeenCalledWith('container1');
      expect(mockContainer.remove).toHaveBeenCalledWith({ force: false });
    });

    it('should force remove a container when requested', async () => {
      const mockContainer = {
        remove: jest.fn().mockResolvedValue(undefined)
      };

      mockDocker.getContainer.mockReturnValue(mockContainer as any);

      await dockerClient.removeContainer('container1', true);

      expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
    });

    it('should handle remove errors', async () => {
      const mockContainer = {
        remove: jest.fn().mockRejectedValue(new Error('Container remove failed'))
      };

      mockDocker.getContainer.mockReturnValue(mockContainer as any);

      await expect(dockerClient.removeContainer('container1')).rejects.toThrow('Failed to remove container: Container remove failed');
    });
  });

  describe('getContainerLogs', () => {
    it('should get container logs', async () => {
      const mockLogs = Buffer.from('Log line 1\nLog line 2\n');
      const mockContainer = {
        logs: jest.fn().mockResolvedValue(mockLogs)
      };

      mockDocker.getContainer.mockReturnValue(mockContainer as any);

      const result = await dockerClient.getContainerLogs('container1', 50);

      expect(result).toBe('Log line 1\nLog line 2\n');
      expect(mockDocker.getContainer).toHaveBeenCalledWith('container1');
      expect(mockContainer.logs).toHaveBeenCalledWith({
        stdout: true,
        stderr: true,
        tail: 50,
        timestamps: true
      });
    });

    it('should handle log retrieval errors', async () => {
      const mockContainer = {
        logs: jest.fn().mockRejectedValue(new Error('Log retrieval failed'))
      };

      mockDocker.getContainer.mockReturnValue(mockContainer as any);

      await expect(dockerClient.getContainerLogs('container1')).rejects.toThrow('Failed to get container logs: Log retrieval failed');
    });
  });

  describe('getServices', () => {
    it('should group containers by service', async () => {
      const mockContainers = [
        {
          Id: 'container1',
          Names: ['/otp_web_1'],
          Image: 'nginx:latest',
          ImageID: 'sha256:abc123',
          Command: 'nginx -g daemon off;',
          State: 'running',
          Status: 'Up 5 minutes',
          Ports: [{ PrivatePort: 80, PublicPort: 8080, Type: 'tcp', IP: '0.0.0.0' }],
          Labels: {
            'com.docker.compose.project': 'otp',
            'com.docker.compose.service': 'web'
          },
          Created: 1640995200,
          SizeRw: 0,
          SizeRootFs: 0,
          HostConfig: { NetworkMode: 'default' },
          NetworkSettings: { Networks: {} },
          Mounts: []
        },
        {
          Id: 'container2',
          Names: ['/otp_db_1'],
          Image: 'postgres:13',
          ImageID: 'sha256:def456',
          Command: 'postgres',
          State: 'running',
          Status: 'Up 5 minutes',
          Ports: [{ PrivatePort: 5432, PublicPort: 5432, Type: 'tcp', IP: '0.0.0.0' }],
          Labels: {
            'com.docker.compose.project': 'otp',
            'com.docker.compose.service': 'db'
          },
          Created: 1640995200,
          SizeRw: 0,
          SizeRootFs: 0,
          HostConfig: { NetworkMode: 'default' },
          NetworkSettings: { Networks: {} },
          Mounts: []
        }
      ];

      mockDocker.listContainers.mockResolvedValue(mockContainers);

      const result = await dockerClient.getServices('otp');

      expect(result).toHaveLength(2);
      
      const webService = result.find(s => s.name === 'web');
      expect(webService).toBeDefined();
      expect(webService!.containers).toHaveLength(1);
      expect(webService!.status).toBe('running');
      expect(webService!.health).toBe('healthy');
      expect(webService!.endpoints).toHaveLength(1);

      const dbService = result.find(s => s.name === 'db');
      expect(dbService).toBeDefined();
      expect(dbService!.containers).toHaveLength(1);
      expect(dbService!.status).toBe('running');
      expect(dbService!.health).toBe('healthy');
    });

    it('should handle services without project filter', async () => {
      mockDocker.listContainers.mockResolvedValue([]);

      const result = await dockerClient.getServices();

      expect(mockDocker.listContainers).toHaveBeenCalledWith({
        all: true,
        filters: '{}'
      });
      expect(result).toEqual([]);
    });
  });
});