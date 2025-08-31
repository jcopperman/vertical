/**
 * Tests for DefaultReportManager
 */

import { DefaultReportManager } from './manager';
import { DefaultResultProcessor } from './processor';
import { DefaultResultsApiClient } from './api-client';
import { OTPConfig } from '../config/types';
import { TestResult } from '../runners/types';
import { ProcessedResult, PublishResult } from './types';

// Mock the dependencies
jest.mock('./processor');
jest.mock('./api-client');

const MockedResultProcessor = DefaultResultProcessor as jest.MockedClass<typeof DefaultResultProcessor>;
const MockedResultsApiClient = DefaultResultsApiClient as jest.MockedClass<typeof DefaultResultsApiClient>;

describe('DefaultReportManager', () => {
  let manager: DefaultReportManager;
  let mockConfig: OTPConfig;
  let mockProcessor: jest.Mocked<DefaultResultProcessor>;
  let mockApiClient: jest.Mocked<DefaultResultsApiClient>;
  let mockTestResult: TestResult;
  let mockProcessedResult: ProcessedResult;

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
          retries: 3,
          interval: 5
        }
      },
      runners: {},
      reporting: {
        grafana: {
          url: 'http://localhost:3000',
          dashboards: []
        },
        resultsApi: {
          url: 'http://localhost:8080/api',
          timeout: 30
        }
      },
      fixtures: {
        defaultSet: 'basic',
        sets: {}
      }
    };

    mockTestResult = {
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
      artifacts: ['test-report.json'],
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:05:00Z'),
      duration: 300000
    };

    mockProcessedResult = {
      ...mockTestResult,
      processed: true,
      processedAt: new Date('2024-01-01T10:05:01Z'),
      metadata: {
        environment: 'local',
        profile: 'test',
        hostname: 'test-host',
        platform: 'linux',
        nodeVersion: 'v18.0.0'
      },
      enrichedSummary: {
        ...mockTestResult.summary,
        passRate: 80,
        failureRate: 10,
        executionRate: 90
      }
    };

    // Create mock instances
    mockProcessor = {
      processResult: jest.fn(),
      aggregateResults: jest.fn(),
      formatResult: jest.fn()
    } as any;

    mockApiClient = {
      publishResult: jest.fn(),
      getResult: jest.fn(),
      queryResults: jest.fn(),
      getAggregatedResults: jest.fn(),
      uploadArtifact: jest.fn(),
      validateConnection: jest.fn(),
      getLatestRunId: jest.fn()
    } as any;

    // Mock the constructors
    MockedResultProcessor.mockImplementation(() => mockProcessor);
    MockedResultsApiClient.mockImplementation(() => mockApiClient);

    manager = new DefaultReportManager(mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processAndPublishResult', () => {
    it('should process and publish result successfully', async () => {
      const mockPublishResult: PublishResult = {
        success: true,
        runId: 'test-run-123',
        url: 'http://localhost:8080/api/runs/test-run-123'
      };

      mockProcessor.processResult.mockResolvedValue(mockProcessedResult);
      mockApiClient.validateConnection.mockResolvedValue(true);
      mockApiClient.publishResult.mockResolvedValue(mockPublishResult);

      const result = await manager.processAndPublishResult(mockTestResult);

      expect(result).toEqual(mockProcessedResult);
      expect(mockProcessor.processResult).toHaveBeenCalledWith(mockTestResult);
      expect(mockApiClient.publishResult).toHaveBeenCalledWith(mockProcessedResult);
    });

    it('should continue processing even if publishing fails', async () => {
      const mockPublishResult: PublishResult = {
        success: false,
        runId: 'test-run-123',
        error: 'API unavailable'
      };

      mockProcessor.processResult.mockResolvedValue(mockProcessedResult);
      mockApiClient.validateConnection.mockResolvedValue(true);
      mockApiClient.publishResult.mockResolvedValue(mockPublishResult);

      const result = await manager.processAndPublishResult(mockTestResult);

      expect(result).toEqual(mockProcessedResult);
      expect(mockProcessor.processResult).toHaveBeenCalledWith(mockTestResult);
      expect(mockApiClient.publishResult).toHaveBeenCalledWith(mockProcessedResult);
    });

    it('should throw error if processing fails', async () => {
      mockProcessor.processResult.mockRejectedValue(new Error('Processing failed'));

      await expect(manager.processAndPublishResult(mockTestResult)).rejects.toThrow('Processing failed');
    });
  });

  describe('formatResult', () => {
    it('should format result using processor', async () => {
      const mockFormattedResult = 'Formatted console output';
      mockProcessor.formatResult.mockResolvedValue(mockFormattedResult);

      const result = await manager.formatResult(mockProcessedResult, 'console');

      expect(result).toBe(mockFormattedResult);
      expect(mockProcessor.formatResult).toHaveBeenCalledWith(mockProcessedResult, 'console');
    });

    it('should throw error if formatting fails', async () => {
      mockProcessor.formatResult.mockRejectedValue(new Error('Formatting failed'));

      await expect(manager.formatResult(mockProcessedResult, 'json')).rejects.toThrow('Formatting failed');
    });
  });

  describe('publishResult', () => {
    it('should publish result when API is available', async () => {
      const mockPublishResult: PublishResult = {
        success: true,
        runId: 'test-run-123',
        url: 'http://localhost:8080/api/runs/test-run-123'
      };

      mockApiClient.validateConnection.mockResolvedValue(true);
      mockApiClient.publishResult.mockResolvedValue(mockPublishResult);

      const result = await manager.publishResult(mockProcessedResult);

      expect(result).toEqual(mockPublishResult);
      expect(mockApiClient.validateConnection).toHaveBeenCalled();
      expect(mockApiClient.publishResult).toHaveBeenCalledWith(mockProcessedResult);
    });

    it('should return failure when API is not available', async () => {
      mockApiClient.validateConnection.mockResolvedValue(false);

      const result = await manager.publishResult(mockProcessedResult);

      expect(result).toEqual({
        success: false,
        runId: 'test-run-123',
        error: 'Results API is not available'
      });

      expect(mockApiClient.publishResult).not.toHaveBeenCalled();
    });

    it('should handle publish errors gracefully', async () => {
      mockApiClient.validateConnection.mockResolvedValue(true);
      mockApiClient.publishResult.mockRejectedValue(new Error('Network error'));

      const result = await manager.publishResult(mockProcessedResult);

      expect(result).toEqual({
        success: false,
        runId: 'test-run-123',
        error: 'Network error'
      });
    });
  });

  describe('getResult', () => {
    it('should retrieve result from API', async () => {
      mockApiClient.getResult.mockResolvedValue(mockProcessedResult);

      const result = await manager.getResult('test-run-123');

      expect(result).toEqual(mockProcessedResult);
      expect(mockApiClient.getResult).toHaveBeenCalledWith('test-run-123');
    });

    it('should return null when result not found', async () => {
      mockApiClient.getResult.mockResolvedValue(null);

      const result = await manager.getResult('nonexistent-run');

      expect(result).toBeNull();
    });

    it('should throw error when API call fails', async () => {
      mockApiClient.getResult.mockRejectedValue(new Error('API error'));

      await expect(manager.getResult('test-run-123')).rejects.toThrow('API error');
    });
  });

  describe('queryResults', () => {
    it('should query results from API', async () => {
      const mockResults = [mockProcessedResult];
      const query = { suites: ['api-tests'], limit: 10 };

      mockApiClient.queryResults.mockResolvedValue(mockResults);

      const results = await manager.queryResults(query);

      expect(results).toEqual(mockResults);
      expect(mockApiClient.queryResults).toHaveBeenCalledWith(query);
    });
  });

  describe('validateApiConnection', () => {
    it('should validate API connection', async () => {
      mockApiClient.validateConnection.mockResolvedValue(true);

      const isValid = await manager.validateApiConnection();

      expect(isValid).toBe(true);
      expect(mockApiClient.validateConnection).toHaveBeenCalled();
    });

    it('should return false when validation throws error', async () => {
      mockApiClient.validateConnection.mockRejectedValue(new Error('Connection error'));

      const isValid = await manager.validateApiConnection();

      expect(isValid).toBe(false);
    });
  });

  describe('uploadArtifacts', () => {
    it('should upload multiple artifacts successfully', async () => {
      const artifactPaths = ['/path/to/report.json', '/path/to/coverage.xml'];
      const expectedUrls = [
        'http://localhost:8080/api/runs/test-run-123/artifacts/report.json',
        'http://localhost:8080/api/runs/test-run-123/artifacts/coverage.xml'
      ];

      mockApiClient.uploadArtifact
        .mockResolvedValueOnce(expectedUrls[0])
        .mockResolvedValueOnce(expectedUrls[1]);

      const urls = await manager.uploadArtifacts('test-run-123', artifactPaths);

      expect(urls).toEqual(expectedUrls);
      expect(mockApiClient.uploadArtifact).toHaveBeenCalledTimes(2);
      expect(mockApiClient.uploadArtifact).toHaveBeenCalledWith('test-run-123', artifactPaths[0]);
      expect(mockApiClient.uploadArtifact).toHaveBeenCalledWith('test-run-123', artifactPaths[1]);
    });

    it('should handle partial upload failures', async () => {
      const artifactPaths = ['/path/to/report.json', '/path/to/coverage.xml'];
      const expectedUrl = 'http://localhost:8080/api/runs/test-run-123/artifacts/report.json';

      mockApiClient.uploadArtifact
        .mockResolvedValueOnce(expectedUrl)
        .mockRejectedValueOnce(new Error('Upload failed'));

      const urls = await manager.uploadArtifacts('test-run-123', artifactPaths);

      expect(urls).toEqual([expectedUrl]);
      expect(mockApiClient.uploadArtifact).toHaveBeenCalledTimes(2);
    });
  });

  describe('generateReport', () => {
    it('should generate report for existing run', async () => {
      const mockFormattedReport = 'Formatted report content';

      mockApiClient.getResult.mockResolvedValue(mockProcessedResult);
      mockProcessor.formatResult.mockResolvedValue(mockFormattedReport);

      const report = await manager.generateReport('test-run-123', 'html');

      expect(report).toBe(mockFormattedReport);
      expect(mockApiClient.getResult).toHaveBeenCalledWith('test-run-123');
      expect(mockProcessor.formatResult).toHaveBeenCalledWith(mockProcessedResult, 'html');
    });

    it('should throw error when run not found', async () => {
      mockApiClient.getResult.mockResolvedValue(null);

      await expect(manager.generateReport('nonexistent-run')).rejects.toThrow('Result not found for run ID: nonexistent-run');
    });
  });

  describe('getLastRunId', () => {
    it('should return last run ID', async () => {
      mockApiClient.getLatestRunId.mockResolvedValue('test-run-123');

      const runId = await manager.getLastRunId();

      expect(runId).toBe('test-run-123');
      expect(mockApiClient.getLatestRunId).toHaveBeenCalled();
    });

    it('should return null when no runs found', async () => {
      mockApiClient.getLatestRunId.mockResolvedValue(null);

      const runId = await manager.getLastRunId();

      expect(runId).toBeNull();
    });

    it('should return null when API call fails', async () => {
      mockApiClient.getLatestRunId.mockRejectedValue(new Error('API error'));

      const runId = await manager.getLastRunId();

      expect(runId).toBeNull();
    });
  });
});