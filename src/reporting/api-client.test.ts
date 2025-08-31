/**
 * Tests for DefaultResultsApiClient
 */

import axios, { AxiosError } from 'axios';
import { DefaultResultsApiClient } from './api-client';
import { ProcessedResult, ResultQuery, AggregationQuery } from './types';
import { ResultsApiConfig } from '../config/types';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DefaultResultsApiClient', () => {
  let client: DefaultResultsApiClient;
  let config: ResultsApiConfig;
  let mockProcessedResult: ProcessedResult;

  beforeEach(() => {
    config = {
      url: 'http://localhost:8080/api',
      timeout: 30
    };

    // Reset axios mocks
    jest.clearAllMocks();
    
    // Create a proper mock axios instance
    const mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() }
      }
    };
    
    // Mock axios.create to return the mock instance
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any);

    client = new DefaultResultsApiClient(config);

    mockProcessedResult = {
      runId: 'test-run-123',
      suite: 'api-tests',
      status: 'passed',
      summary: {
        total: 10,
        passed: 8,
        failed: 1,
        skipped: 1,
        errors: 0
      },
      enrichedSummary: {
        total: 10,
        passed: 8,
        failed: 1,
        skipped: 1,
        errors: 0,
        passRate: 80,
        failureRate: 10,
        executionRate: 90
      },
      artifacts: ['test-report.json'],
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:05:00Z'),
      duration: 300000,
      processed: true,
      processedAt: new Date('2024-01-01T10:05:01Z'),
      metadata: {
        environment: 'local',
        profile: 'test',
        hostname: 'test-host',
        platform: 'linux',
        nodeVersion: 'v18.0.0'
      }
    };


  });

  describe('publishResult', () => {
    it('should successfully publish a result', async () => {
      const mockAxiosInstance = (client as any).client;
      mockAxiosInstance.post.mockResolvedValue({
        data: { url: 'http://localhost:8080/api/runs/test-run-123' }
      });

      const result = await client.publishResult(mockProcessedResult);

      expect(result).toEqual({
        success: true,
        runId: 'test-run-123',
        url: 'http://localhost:8080/api/runs/test-run-123'
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/runs', {
        runId: 'test-run-123',
        suite: 'api-tests',
        status: 'passed',
        summary: mockProcessedResult.enrichedSummary,
        metadata: mockProcessedResult.metadata,
        startTime: '2024-01-01T10:00:00.000Z',
        endTime: '2024-01-01T10:05:00.000Z',
        duration: 300000,
        artifacts: ['test-report.json'],
        traceId: undefined
      });
    });

    it('should handle publish errors gracefully', async () => {
      const mockAxiosInstance = (client as any).client;
      mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

      const result = await client.publishResult(mockProcessedResult);

      expect(result).toEqual({
        success: false,
        runId: 'test-run-123',
        error: 'Network error'
      });
    });

    it('should generate default URL when not provided', async () => {
      const mockAxiosInstance = (client as any).client;
      mockAxiosInstance.post.mockResolvedValue({
        data: {}
      });

      const result = await client.publishResult(mockProcessedResult);

      expect(result).toEqual({
        success: true,
        runId: 'test-run-123',
        url: 'http://localhost:8080/api/runs/test-run-123'
      });
    });
  });

  describe('getResult', () => {
    it('should retrieve a result by run ID', async () => {
      const mockAxiosInstance = (client as any).client;
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          ...mockProcessedResult,
          startTime: '2024-01-01T10:00:00.000Z',
          endTime: '2024-01-01T10:05:00.000Z',
          processedAt: '2024-01-01T10:05:01.000Z'
        }
      });

      const result = await client.getResult('test-run-123');

      expect(result).toMatchObject({
        runId: 'test-run-123',
        suite: 'api-tests',
        status: 'passed'
      });

      expect(result?.startTime).toBeInstanceOf(Date);
      expect(result?.endTime).toBeInstanceOf(Date);
      expect(result?.processedAt).toBeInstanceOf(Date);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/runs/test-run-123');
    });

    it('should return null for 404 errors', async () => {
      const mockAxiosInstance = (client as any).client;
      const error = new AxiosError('Not found');
      error.response = { status: 404 } as any;
      mockAxiosInstance.get.mockRejectedValue(error);

      const result = await client.getResult('nonexistent-run');

      expect(result).toBeNull();
    });

    it('should throw error for other HTTP errors', async () => {
      const mockAxiosInstance = (client as any).client;
      const error = new AxiosError('Server error');
      error.response = { status: 500 } as any;
      mockAxiosInstance.get.mockRejectedValue(error);

      await expect(client.getResult('test-run-123')).rejects.toThrow('Failed to retrieve result');
    });
  });

  describe('queryResults', () => {
    it('should query results with filters', async () => {
      const mockAxiosInstance = (client as any).client;
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          results: [{
            ...mockProcessedResult,
            startTime: '2024-01-01T10:00:00.000Z',
            endTime: '2024-01-01T10:05:00.000Z',
            processedAt: '2024-01-01T10:05:01.000Z'
          }]
        }
      });

      const query: ResultQuery = {
        suites: ['api-tests'],
        status: ['passed'],
        environment: 'local',
        limit: 10
      };

      const results = await client.queryResults(query);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        runId: 'test-run-123',
        suite: 'api-tests'
      });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/runs', {
        params: {
          suites: 'api-tests',
          status: 'passed',
          environment: 'local',
          limit: 10
        }
      });
    });

    it('should handle date range queries', async () => {
      const mockAxiosInstance = (client as any).client;
      mockAxiosInstance.get.mockResolvedValue({
        data: { results: [] }
      });

      const query: ResultQuery = {
        dateRange: {
          start: new Date('2024-01-01'),
          end: new Date('2024-01-02')
        }
      };

      await client.queryResults(query);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/runs', {
        params: {
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2024-01-02T00:00:00.000Z'
        }
      });
    });
  });

  describe('getAggregatedResults', () => {
    it('should get aggregated results', async () => {
      const mockAxiosInstance = (client as any).client;
      const mockAggregated = {
        runIds: ['run-1', 'run-2'],
        totalRuns: 2,
        overallSummary: {
          total: 20,
          passed: 18,
          failed: 2,
          skipped: 0,
          errors: 0,
          passRate: 90,
          failureRate: 10,
          executionRate: 100
        },
        suiteBreakdown: {},
        trends: {
          passRateHistory: [90, 85],
          durationHistory: [300000, 250000],
          failurePatterns: []
        },
        metadata: {
          timeRange: {
            start: '2024-01-01T00:00:00.000Z',
            end: '2024-01-02T00:00:00.000Z'
          },
          environments: ['local'],
          profiles: ['test'],
          uniqueTags: []
        }
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: mockAggregated
      });

      const query: AggregationQuery = {
        suites: ['api-tests'],
        groupBy: ['suite'],
        metrics: ['summary', 'trends']
      };

      const result = await client.getAggregatedResults(query);

      expect(result).toMatchObject({
        runIds: ['run-1', 'run-2'],
        totalRuns: 2
      });

      expect(result.metadata.timeRange.start).toBeInstanceOf(Date);
      expect(result.metadata.timeRange.end).toBeInstanceOf(Date);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/runs/aggregate', {
        params: {
          suites: 'api-tests',
          groupBy: 'suite',
          metrics: 'summary,trends'
        }
      });
    });
  });

  describe('validateConnection', () => {
    it('should return true for healthy API', async () => {
      const mockAxiosInstance = (client as any).client;
      mockAxiosInstance.get.mockResolvedValue({
        status: 200,
        data: { status: 'healthy' }
      });

      const isValid = await client.validateConnection();

      expect(isValid).toBe(true);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/health');
    });

    it('should return false for unhealthy API', async () => {
      const mockAxiosInstance = (client as any).client;
      mockAxiosInstance.get.mockResolvedValue({
        status: 200,
        data: { status: 'unhealthy' }
      });

      const isValid = await client.validateConnection();

      expect(isValid).toBe(false);
    });

    it('should return false for connection errors', async () => {
      const mockAxiosInstance = (client as any).client;
      mockAxiosInstance.get.mockRejectedValue(new Error('Connection refused'));

      const isValid = await client.validateConnection();

      expect(isValid).toBe(false);
    });
  });

  describe('uploadArtifact', () => {
    it('should upload artifact successfully', async () => {
      // Mock fs.access and fs.readFile
      const fs = require('fs/promises');
      jest.spyOn(fs, 'access').mockResolvedValue(undefined);
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('test content'));

      const mockAxiosInstance = (client as any).client;
      mockAxiosInstance.post.mockResolvedValue({
        data: { url: 'http://localhost:8080/api/runs/test-run-123/artifacts/test.json' }
      });

      const url = await client.uploadArtifact('test-run-123', '/path/to/test.json');

      expect(url).toBe('http://localhost:8080/api/runs/test-run-123/artifacts/test.json');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/runs/test-run-123/artifacts',
        expect.any(Object), // FormData
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'multipart/form-data'
          })
        })
      );
    });

    it('should throw error if file does not exist', async () => {
      const fs = require('fs/promises');
      jest.spyOn(fs, 'access').mockRejectedValue(new Error('File not found'));

      await expect(
        client.uploadArtifact('test-run-123', '/nonexistent/file.json')
      ).rejects.toThrow('Failed to upload artifact');
    });
  });

  describe('getRunMetadata', () => {
    it('should retrieve run metadata', async () => {
      const mockAxiosInstance = (client as any).client;
      const mockMetadata = {
        environment: 'production',
        branch: 'main',
        commit: 'abc123',
        buildId: 'build-456'
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: mockMetadata
      });

      const result = await client.getRunMetadata('test-run-123');

      expect(result).toEqual(mockMetadata);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/runs/test-run-123/metadata');
    });

    it('should return null for 404 errors', async () => {
      const mockAxiosInstance = (client as any).client;
      const error = new AxiosError('Not found');
      error.response = { status: 404 } as any;
      mockAxiosInstance.get.mockRejectedValue(error);

      const result = await client.getRunMetadata('nonexistent-run');

      expect(result).toBeNull();
    });
  });

  describe('updateRunMetadata', () => {
    it('should update run metadata successfully', async () => {
      const mockAxiosInstance = (client as any).client;
      mockAxiosInstance.patch.mockResolvedValue({ data: {} });

      const metadata = { branch: 'feature-branch', commit: 'def456' };
      const result = await client.updateRunMetadata('test-run-123', metadata);

      expect(result).toBe(true);
      expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/runs/test-run-123/metadata', metadata);
    });

    it('should throw error on update failure', async () => {
      const mockAxiosInstance = (client as any).client;
      mockAxiosInstance.patch.mockRejectedValue(new Error('Update failed'));

      const metadata = { branch: 'feature-branch' };

      await expect(
        client.updateRunMetadata('test-run-123', metadata)
      ).rejects.toThrow('Failed to update run metadata');
    });
  });

  describe('deleteRun', () => {
    it('should delete run successfully', async () => {
      const mockAxiosInstance = (client as any).client;
      mockAxiosInstance.delete.mockResolvedValue({ data: {} });

      const result = await client.deleteRun('test-run-123');

      expect(result).toBe(true);
      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/runs/test-run-123');
    });

    it('should return false for 404 errors', async () => {
      const mockAxiosInstance = (client as any).client;
      const error = new AxiosError('Not found');
      error.response = { status: 404 } as any;
      mockAxiosInstance.delete.mockRejectedValue(error);

      const result = await client.deleteRun('nonexistent-run');

      expect(result).toBe(false);
    });
  });

  describe('getRunArtifacts', () => {
    it('should retrieve run artifacts', async () => {
      const mockAxiosInstance = (client as any).client;
      const mockArtifacts = ['report.json', 'coverage.xml', 'screenshots.zip'];

      mockAxiosInstance.get.mockResolvedValue({
        data: { artifacts: mockArtifacts }
      });

      const result = await client.getRunArtifacts('test-run-123');

      expect(result).toEqual(mockArtifacts);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/runs/test-run-123/artifacts');
    });

    it('should return empty array for 404 errors', async () => {
      const mockAxiosInstance = (client as any).client;
      const error = new AxiosError('Not found');
      error.response = { status: 404 } as any;
      mockAxiosInstance.get.mockRejectedValue(error);

      const result = await client.getRunArtifacts('nonexistent-run');

      expect(result).toEqual([]);
    });
  });

  describe('getLatestRunId', () => {
    it('should return latest run ID', async () => {
      const mockAxiosInstance = (client as any).client;
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          results: [{
            ...mockProcessedResult,
            runId: 'latest-run-456',
            startTime: '2024-01-01T10:00:00.000Z',
            endTime: '2024-01-01T10:05:00.000Z',
            processedAt: '2024-01-01T10:05:01.000Z'
          }]
        }
      });

      const result = await client.getLatestRunId();

      expect(result).toBe('latest-run-456');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/runs', {
        params: { limit: 1 }
      });
    });

    it('should return null when no runs exist', async () => {
      const mockAxiosInstance = (client as any).client;
      mockAxiosInstance.get.mockResolvedValue({
        data: { results: [] }
      });

      const result = await client.getLatestRunId();

      expect(result).toBeNull();
    });
  });

  describe('getApiStatus', () => {
    it('should retrieve API status', async () => {
      const mockAxiosInstance = (client as any).client;
      const mockStatus = {
        status: 'healthy',
        version: '1.0.0',
        uptime: 3600,
        totalRuns: 1234,
        diskUsage: '2.5GB'
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: mockStatus
      });

      const result = await client.getApiStatus();

      expect(result).toEqual(mockStatus);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/status');
    });

    it('should throw error on status retrieval failure', async () => {
      const mockAxiosInstance = (client as any).client;
      mockAxiosInstance.get.mockRejectedValue(new Error('Status unavailable'));

      await expect(client.getApiStatus()).rejects.toThrow('Failed to get API status');
    });
  });
});