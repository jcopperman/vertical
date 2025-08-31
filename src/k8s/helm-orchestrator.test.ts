/**
 * Tests for HelmOrchestrator
 */

import { HelmOrchestrator } from './helm-orchestrator';
import { KubernetesClient } from './client';
import { HelmConfig, HelmDeploymentOptions, HelmDeploymentResult } from './types';

// Mock dependencies
jest.mock('./client');
jest.mock('fs/promises');
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

const MockKubernetesClient = KubernetesClient as jest.MockedClass<typeof KubernetesClient>;

describe('HelmOrchestrator', () => {
  let orchestrator: HelmOrchestrator;
  let mockK8sClient: jest.Mocked<KubernetesClient>;
  let mockConfig: HelmConfig;


  beforeEach(() => {
    // Setup mocks
    mockK8sClient = {
      validateConnection: jest.fn(),
      createNamespace: jest.fn(),
      getResourceStatus: jest.fn()
    } as any;

    mockConfig = {
      chartPath: './charts/otp',
      releaseName: 'otp-test',
      namespace: 'otp-testing',
      valuesFiles: ['values.yaml'],
      values: { global: { environment: 'test' } },
      timeout: 300,
      wait: true,
      atomic: true
    };



    // Mock fs access
    const fs = require('fs/promises');
    fs.access = jest.fn().mockResolvedValue(undefined);

    MockKubernetesClient.mockImplementation(() => mockK8sClient);

    orchestrator = new HelmOrchestrator(mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(orchestrator).toBeDefined();
      expect(MockKubernetesClient).toHaveBeenCalledWith({
        kubeconfig: undefined
      });
    });

    it('should apply default configuration values', () => {
      const minimalConfig: HelmConfig = {
        chartPath: './charts/test',
        releaseName: 'test-release',
        namespace: 'test-ns'
      };

      const testOrchestrator = new HelmOrchestrator(minimalConfig);
      expect(testOrchestrator).toBeDefined();
    });
  });

  describe('Deploy', () => {
    beforeEach(() => {
      mockK8sClient.validateConnection.mockResolvedValue(true);
      mockExecAsync.mockResolvedValue({
        stdout: 'Release "otp-test" has been upgraded. Happy Helming!',
        stderr: ''
      });
    });

    it('should deploy successfully with default options', async () => {
      // Mock getStatus and getResources
      const mockStatus = {
        releaseName: 'otp-test',
        namespace: 'otp-testing',
        status: 'deployed',
        revision: 1,
        lastDeployed: new Date(),
        resources: []
      };

      const mockResources = [
        {
          kind: 'Deployment',
          name: 'grafana',
          namespace: 'otp-testing',
          status: 'Running',
          ready: true
        }
      ];

      // Mock the private methods
      (orchestrator as any).getStatus = jest.fn().mockResolvedValue(mockStatus);
      (orchestrator as any).getResources = jest.fn().mockResolvedValue(mockResources);

      const result = await orchestrator.deploy();

      expect(result.success).toBe(true);
      expect(result.releaseName).toBe('otp-test');
      expect(result.namespace).toBe('otp-testing');
      expect(result.resources).toEqual(mockResources);
      expect(mockK8sClient.validateConnection).toHaveBeenCalled();
    });

    it('should handle deployment with createNamespace option', async () => {
      const options: HelmDeploymentOptions = {
        createNamespace: true
      };

      // Mock the private methods
      (orchestrator as any).getStatus = jest.fn().mockResolvedValue({
        releaseName: 'otp-test',
        namespace: 'otp-testing',
        status: 'deployed',
        revision: 1,
        lastDeployed: new Date(),
        resources: []
      });
      (orchestrator as any).getResources = jest.fn().mockResolvedValue([]);

      const result = await orchestrator.deploy(options);

      expect(result.success).toBe(true);
      expect(mockK8sClient.createNamespace).toHaveBeenCalledWith('otp-testing');
    });

    it('should handle deployment failure', async () => {
      mockExecAsync.mockRejectedValue(new Error('Helm deployment failed'));

      const result = await orchestrator.deploy();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Helm deployment failed');
    });

    it('should handle Kubernetes connection failure', async () => {
      mockK8sClient.validateConnection.mockResolvedValue(false);

      const result = await orchestrator.deploy();

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Cannot connect to Kubernetes cluster');
    });

    it('should build correct Helm command with options', async () => {
      const options: HelmDeploymentOptions = {
        upgrade: true,
        install: true,
        createNamespace: true,

        timeout: 600,
        values: { replicas: 3 },
        setValues: { 'image.tag': 'v1.2.3' }
      };

      // Mock the private methods
      (orchestrator as any).getStatus = jest.fn().mockResolvedValue({
        releaseName: 'otp-test',
        namespace: 'otp-testing',
        status: 'deployed',
        revision: 1,
        lastDeployed: new Date(),
        resources: []
      });
      (orchestrator as any).getResources = jest.fn().mockResolvedValue([]);

      await orchestrator.deploy(options);

      expect(mockExecAsync).toHaveBeenCalled();
      const helmCommand = mockExecAsync.mock.calls[0][0];
      expect(helmCommand).toContain('helm upgrade');
      expect(helmCommand).toContain('--install');
      expect(helmCommand).toContain('--create-namespace');
      expect(helmCommand).toContain('--wait');
      expect(helmCommand).toContain('--timeout 600s');
      expect(helmCommand).toContain('--set image.tag=v1.2.3');
    });
  });

  describe('Uninstall', () => {
    it('should uninstall successfully', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: 'release "otp-test" uninstalled',
        stderr: ''
      });

      await orchestrator.uninstall();

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('helm uninstall otp-test'),
        expect.any(Object)
      );
    });

    it('should handle uninstall with options', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: 'release "otp-test" uninstalled',
        stderr: ''
      });

      await orchestrator.uninstall({
        keepHistory: true,
        timeout: 120
      });

      const helmCommand = mockExecAsync.mock.calls[0][0];
      expect(helmCommand).toContain('--keep-history');
      expect(helmCommand).toContain('--timeout 120s');
    });

    it('should handle uninstall failure', async () => {
      mockExecAsync.mockRejectedValue(new Error('Uninstall failed'));

      await expect(orchestrator.uninstall()).rejects.toThrow('Failed to uninstall release: Uninstall failed');
    });
  });

  describe('GetStatus', () => {
    it('should get release status successfully', async () => {
      const mockStatusOutput = {
        name: 'otp-test',
        namespace: 'otp-testing',
        info: {
          status: 'deployed',
          last_deployed: '2023-01-01T00:00:00Z',
          notes: 'Release notes here'
        },
        version: 1
      };

      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify(mockStatusOutput),
        stderr: ''
      });

      // Mock getResources
      (orchestrator as any).getResources = jest.fn().mockResolvedValue([]);

      const status = await orchestrator.getStatus();

      expect(status.releaseName).toBe('otp-test');
      expect(status.namespace).toBe('otp-testing');
      expect(status.status).toBe('deployed');
      expect(status.revision).toBe(1);
      expect(status.notes).toBe('Release notes here');
    });

    it('should handle status retrieval failure', async () => {
      mockExecAsync.mockRejectedValue(new Error('Release not found'));

      await expect(orchestrator.getStatus()).rejects.toThrow('Failed to get release status: Release not found');
    });
  });

  describe('ListReleases', () => {
    it('should list releases successfully', async () => {
      const mockReleasesOutput = [
        {
          name: 'otp-test',
          namespace: 'otp-testing',
          revision: 1,
          updated: '2023-01-01T00:00:00Z',
          status: 'deployed',
          chart: 'otp-1.0.0',
          app_version: '1.0.0'
        }
      ];

      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify(mockReleasesOutput),
        stderr: ''
      });

      const releases = await orchestrator.listReleases();

      expect(releases).toHaveLength(1);
      expect(releases[0].name).toBe('otp-test');
      expect(releases[0].status).toBe('deployed');
    });

    it('should handle empty releases list', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: '[]',
        stderr: ''
      });

      const releases = await orchestrator.listReleases();

      expect(releases).toHaveLength(0);
    });
  });

  describe('Rollback', () => {
    it('should rollback successfully', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: 'Rollback was a success!',
        stderr: ''
      });

      await orchestrator.rollback(2);

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('helm rollback otp-test 2'),
        expect.any(Object)
      );
    });

    it('should rollback to previous revision when no revision specified', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: 'Rollback was a success!',
        stderr: ''
      });

      await orchestrator.rollback();

      const helmCommand = mockExecAsync.mock.calls[0][0];
      expect(helmCommand).toContain('helm rollback otp-test');
      expect(helmCommand).not.toMatch(/helm rollback otp-test \d+/);
    });

    it('should handle rollback failure', async () => {
      mockExecAsync.mockRejectedValue(new Error('Rollback failed'));

      await expect(orchestrator.rollback(1)).rejects.toThrow('Failed to rollback release: Rollback failed');
    });
  });

  describe('Test', () => {
    it('should run Helm tests successfully', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: 'Pod otp-test-test completed successfully',
        stderr: ''
      });

      const result = await orchestrator.test();

      expect(result).toContain('Pod otp-test-test completed successfully');
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('helm test otp-test'),
        expect.any(Object)
      );
    });

    it('should run tests with options', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: 'Test output with logs',
        stderr: ''
      });

      await orchestrator.test({
        timeout: 300,
        logs: true
      });

      const helmCommand = mockExecAsync.mock.calls[0][0];
      expect(helmCommand).toContain('--timeout 300s');
      expect(helmCommand).toContain('--logs');
    });

    it('should handle test failure', async () => {
      mockExecAsync.mockRejectedValue(new Error('Tests failed'));

      await expect(orchestrator.test()).rejects.toThrow('Helm test failed: Tests failed');
    });
  });

  describe('Validation', () => {
    it('should validate prerequisites successfully', async () => {
      // Mock Helm version check
      mockExecAsync.mockResolvedValueOnce({
        stdout: 'version.BuildInfo{Version:"v3.10.0"}',
        stderr: ''
      });

      mockK8sClient.validateConnection.mockResolvedValue(true);

      // This should not throw
      await expect((orchestrator as any).validatePrerequisites()).resolves.not.toThrow();
    });

    it('should fail validation when Helm is not installed', async () => {
      mockExecAsync.mockRejectedValueOnce(new Error('helm: command not found'));

      await expect((orchestrator as any).validatePrerequisites()).rejects.toThrow('Helm is not installed');
    });

    it('should fail validation when chart path does not exist', async () => {
      // Mock Helm version check success
      mockExecAsync.mockResolvedValueOnce({
        stdout: 'version.BuildInfo{Version:"v3.10.0"}',
        stderr: ''
      });

      mockK8sClient.validateConnection.mockResolvedValue(true);

      // Mock fs access failure
      const fs = require('fs/promises');
      fs.access.mockRejectedValue(new Error('ENOENT: no such file or directory'));

      await expect((orchestrator as any).validatePrerequisites()).rejects.toThrow('Chart path not found');
    });
  });
});