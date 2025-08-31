/**
 * Tests for KubernetesClient
 */

import { KubernetesClient } from './client';
import { KubernetesClientConfig } from './types';

// Mock dependencies
jest.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  })
}));

// Mock the exec function at the top level
const mockExecAsync = jest.fn();

jest.mock('child_process', () => ({
  exec: jest.fn()
}));

jest.mock('util', () => {
  const actualUtil = jest.requireActual('util');
  return {
    ...actualUtil,
    promisify: jest.fn(() => mockExecAsync)
  };
});

describe('KubernetesClient', () => {
  let client: KubernetesClient;

  let mockConfig: KubernetesClientConfig;

  beforeEach(() => {
    mockConfig = {
      kubeconfig: '/path/to/kubeconfig',
      context: 'test-context',
      namespace: 'test-namespace',
      timeout: 30000
    };



    client = new KubernetesClient(mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(client).toBeDefined();
    });

    it('should apply default configuration values', () => {
      const defaultClient = new KubernetesClient();
      expect(defaultClient).toBeDefined();
    });
  });

  describe('validateConnection', () => {
    it('should return true when cluster is accessible', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: 'Kubernetes control plane is running at https://127.0.0.1:6443',
        stderr: ''
      });

      const result = await client.validateConnection();

      expect(result).toBe(true);
      expect(mockExecAsync).toHaveBeenCalledWith(
        'kubectl cluster-info',
        expect.objectContaining({
          env: expect.objectContaining({
            KUBECONFIG: '/path/to/kubeconfig',
            KUBECTL_CONTEXT: 'test-context'
          })
        })
      );
    });

    it('should return false when cluster is not accessible', async () => {
      mockExecAsync.mockRejectedValue(new Error('Unable to connect to the server'));

      const result = await client.validateConnection();

      expect(result).toBe(false);
    });
  });

  describe('getConnectionStatus', () => {
    it('should return connection status with version info', async () => {
      const mockVersionOutput = {
        clientVersion: { gitVersion: 'v1.25.0' },
        serverVersion: { gitVersion: 'v1.24.0' }
      };

      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify(mockVersionOutput),
        stderr: ''
      });

      const status = await client.getConnectionStatus();

      expect(status.connected).toBe(true);
      expect(status.version).toBe('v1.25.0');
      expect(status.serverVersion).toBe('v1.24.0');
    });

    it('should return error status when connection fails', async () => {
      mockExecAsync.mockRejectedValue(new Error('Connection refused'));

      const status = await client.getConnectionStatus();

      expect(status.connected).toBe(false);
      expect(status.error).toBe('Connection refused');
    });
  });

  describe('createNamespace', () => {
    it('should create namespace successfully', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: 'namespace/test-ns created',
        stderr: ''
      });

      await client.createNamespace('test-ns');

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('kubectl create namespace test-ns'),
        expect.any(Object)
      );
    });

    it('should handle namespace creation failure', async () => {
      mockExecAsync.mockRejectedValue(new Error('namespace already exists'));

      await expect(client.createNamespace('test-ns')).rejects.toThrow('Failed to create namespace');
    });
  });

  describe('deleteNamespace', () => {
    it('should delete namespace successfully', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: 'namespace "test-ns" deleted',
        stderr: ''
      });

      await client.deleteNamespace('test-ns');

      expect(mockExecAsync).toHaveBeenCalledWith(
        'kubectl delete namespace test-ns',
        expect.any(Object)
      );
    });

    it('should delete namespace with force option', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: 'namespace "test-ns" deleted',
        stderr: ''
      });

      await client.deleteNamespace('test-ns', true);

      expect(mockExecAsync).toHaveBeenCalledWith(
        'kubectl delete namespace test-ns --force --grace-period=0',
        expect.any(Object)
      );
    });
  });

  describe('listNamespaces', () => {
    it('should list namespaces successfully', async () => {
      const mockNamespacesOutput = {
        items: [
          {
            metadata: {
              name: 'default',
              creationTimestamp: '2023-01-01T00:00:00Z'
            },
            status: { phase: 'Active' }
          },
          {
            metadata: {
              name: 'kube-system',
              creationTimestamp: '2023-01-01T00:00:00Z'
            },
            status: { phase: 'Active' }
          }
        ]
      };

      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify(mockNamespacesOutput),
        stderr: ''
      });

      const namespaces = await client.listNamespaces();

      expect(namespaces).toHaveLength(2);
      expect(namespaces[0].name).toBe('default');
      expect(namespaces[0].status).toBe('Active');
      expect(namespaces[1].name).toBe('kube-system');
    });
  });

  describe('getResourceStatus', () => {
    it('should get resource status successfully', async () => {
      const mockResourceOutput = {
        kind: 'Pod',
        metadata: { name: 'test-pod' },
        status: {
          phase: 'Running',
          conditions: [
            { type: 'Ready', status: 'True' }
          ]
        }
      };

      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify(mockResourceOutput),
        stderr: ''
      });

      const status = await client.getResourceStatus('pod', 'test-pod', 'default');

      expect(status.phase).toBe('Running');
      expect(status.ready).toBe(true);
      expect(status.conditions).toHaveLength(1);
    });

    it('should handle resource not found', async () => {
      mockExecAsync.mockRejectedValue(new Error('pods "test-pod" not found'));

      await expect(client.getResourceStatus('pod', 'test-pod', 'default'))
        .rejects.toThrow('Failed to get resource status');
    });
  });

  describe('listPods', () => {
    it('should list pods successfully', async () => {
      const mockPodsOutput = {
        items: [
          {
            metadata: {
              name: 'test-pod-1',
              namespace: 'default',
              creationTimestamp: '2023-01-01T00:00:00Z'
            },
            spec: { nodeName: 'node-1' },
            status: {
              phase: 'Running',
              conditions: [{ type: 'Ready', status: 'True' }],
              containerStatuses: [{ restartCount: 0 }]
            }
          }
        ]
      };

      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify(mockPodsOutput),
        stderr: ''
      });

      const pods = await client.listPods('default');

      expect(pods).toHaveLength(1);
      expect(pods[0].name).toBe('test-pod-1');
      expect(pods[0].namespace).toBe('default');
      expect(pods[0].phase).toBe('Running');
      expect(pods[0].ready).toBe(true);
      expect(pods[0].restarts).toBe(0);
      expect(pods[0].node).toBe('node-1');
    });

    it('should list pods with label selector', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify({ items: [] }),
        stderr: ''
      });

      await client.listPods('default', 'app=test');

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('-l "app=test"'),
        expect.any(Object)
      );
    });

    it('should list pods across all namespaces', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify({ items: [] }),
        stderr: ''
      });

      await client.listPods();

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('--all-namespaces'),
        expect.any(Object)
      );
    });
  });

  describe('listServices', () => {
    it('should list services successfully', async () => {
      const mockServicesOutput = {
        items: [
          {
            metadata: {
              name: 'test-service',
              namespace: 'default'
            },
            spec: {
              type: 'ClusterIP',
              clusterIP: '10.96.0.1',
              ports: [
                {
                  name: 'http',
                  port: 80,
                  targetPort: 8080,
                  protocol: 'TCP'
                }
              ]
            },
            status: {}
          }
        ]
      };

      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify(mockServicesOutput),
        stderr: ''
      });

      const services = await client.listServices('default');

      expect(services).toHaveLength(1);
      expect(services[0].name).toBe('test-service');
      expect(services[0].namespace).toBe('default');
      expect(services[0].type).toBe('ClusterIP');
      expect(services[0].clusterIP).toBe('10.96.0.1');
      expect(services[0].ports).toHaveLength(1);
      expect(services[0].ports[0].port).toBe(80);
    });
  });

  describe('getPodLogs', () => {
    it('should get pod logs successfully', async () => {
      const mockLogs = '2023-01-01T00:00:00Z Starting application\n2023-01-01T00:00:01Z Application ready';

      mockExecAsync.mockResolvedValue({
        stdout: mockLogs,
        stderr: ''
      });

      const logs = await client.getPodLogs('test-pod', 'default', {
        tail: 100,
        timestamps: true
      });

      expect(logs).toBe(mockLogs);
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('kubectl logs test-pod -n default --tail=100 --timestamps'),
        expect.any(Object)
      );
    });

    it('should get logs with container specification', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: 'container logs',
        stderr: ''
      });

      await client.getPodLogs('test-pod', 'default', {
        container: 'app-container'
      });

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('-c app-container'),
        expect.any(Object)
      );
    });
  });

  describe('execInPod', () => {
    it('should execute command in pod successfully', async () => {
      const mockOutput = 'command output';

      mockExecAsync.mockResolvedValue({
        stdout: mockOutput,
        stderr: ''
      });

      const result = await client.execInPod('test-pod', 'default', 'ls -la');

      expect(result).toBe(mockOutput);
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('kubectl exec test-pod -n default -- ls -la'),
        expect.any(Object)
      );
    });

    it('should execute command with options', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: 'output',
        stderr: ''
      });

      await client.execInPod('test-pod', 'default', 'bash', {
        container: 'app',
        stdin: true,
        tty: true
      });

      const command = mockExecAsync.mock.calls[0][0];
      expect(command).toContain('-c app');
      expect(command).toContain('-i');
      expect(command).toContain('-t');
    });
  });

  describe('Helper Methods', () => {
    it('should calculate age correctly', () => {
      const client = new KubernetesClient();
      const calculateAge = (client as any).calculateAge.bind(client);
      
      // Test with a timestamp from 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const age = calculateAge(twoHoursAgo);
      
      expect(age).toBe('2h');
    });

    it('should determine pod readiness correctly', () => {
      const client = new KubernetesClient();
      const isPodReady = (client as any).isPodReady.bind(client);
      
      const readyPod = {
        status: {
          conditions: [
            { type: 'Ready', status: 'True' }
          ]
        }
      };
      
      const notReadyPod = {
        status: {
          conditions: [
            { type: 'Ready', status: 'False' }
          ]
        }
      };
      
      expect(isPodReady(readyPod)).toBe(true);
      expect(isPodReady(notReadyPod)).toBe(false);
    });

    it('should calculate pod restarts correctly', () => {
      const client = new KubernetesClient();
      const getPodRestarts = (client as any).getPodRestarts.bind(client);
      
      const pod = {
        status: {
          containerStatuses: [
            { restartCount: 2 },
            { restartCount: 1 }
          ]
        }
      };
      
      expect(getPodRestarts(pod)).toBe(3);
    });
  });
});