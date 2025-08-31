/**
 * Tests for DefaultResultProcessor
 */

import { DefaultResultProcessor } from './processor';
import { TestResult, TestSummary } from '../runners/types';
import { ProcessedResult, AggregatedResult } from './types';

describe('DefaultResultProcessor', () => {
  let processor: DefaultResultProcessor;
  let mockResult: TestResult;

  beforeEach(() => {
    processor = new DefaultResultProcessor();
    
    mockResult = {
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
      artifacts: ['test-report.json', 'coverage.xml'],
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:05:00Z'),
      duration: 300000, // 5 minutes
      traceId: 'trace-456'
    };

    // Mock environment variables
    process.env.OTP_TARGET = 'local';
    process.env.OTP_PROFILE = 'test';
    process.env.OTP_TAGS = 'smoke,regression';
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.OTP_TARGET;
    delete process.env.OTP_PROFILE;
    delete process.env.OTP_TAGS;
    delete process.env.GIT_BRANCH;
    delete process.env.GIT_COMMIT;
  });

  describe('processResult', () => {
    it('should process a test result with enrichment', async () => {
      const result = await processor.processResult(mockResult);

      expect(result).toMatchObject({
        ...mockResult,
        processed: true,
        processedAt: expect.any(Date)
      });

      expect(result.metadata).toMatchObject({
        environment: 'local',
        profile: 'test',
        tags: ['smoke', 'regression'],
        hostname: expect.any(String),
        platform: expect.any(String),
        nodeVersion: expect.any(String)
      });

      expect(result.enrichedSummary).toMatchObject({
        ...mockResult.summary,
        passRate: 80, // 8/10 * 100
        failureRate: 10, // 1/10 * 100
        executionRate: 90, // (8+1)/10 * 100
        performance: {
          averageTestDuration: 30000, // 300000ms / 10 tests
          throughput: 0.03 // 10 tests / 300 seconds
        }
      });
    });

    it('should handle results with zero tests', async () => {
      const emptyResult: TestResult = {
        ...mockResult,
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          errors: 0
        }
      };

      const result = await processor.processResult(emptyResult);

      expect(result.enrichedSummary).toMatchObject({
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        errors: 0,
        passRate: 0,
        failureRate: 0,
        executionRate: 0
      });
    });

    it('should include git metadata when available', async () => {
      process.env.GIT_BRANCH = 'feature/test-branch';
      process.env.GIT_COMMIT = 'abc123def456';

      const result = await processor.processResult(mockResult);

      expect(result.metadata).toMatchObject({
        branch: 'feature/test-branch',
        commit: 'abc123def456'
      });
    });

    it('should handle missing environment variables gracefully', async () => {
      delete process.env.OTP_TARGET;
      delete process.env.OTP_PROFILE;
      delete process.env.OTP_TAGS;

      const result = await processor.processResult(mockResult);

      expect(result.metadata).toMatchObject({
        environment: 'local',
        profile: 'local',
        hostname: expect.any(String),
        platform: expect.any(String),
        nodeVersion: expect.any(String)
      });

      expect(result.metadata.tags).toBeUndefined();
    });
  });

  describe('aggregateResults', () => {
    let results: TestResult[];

    beforeEach(() => {
      results = [
        {
          ...mockResult,
          runId: 'run-1',
          suite: 'api-tests',
          summary: { total: 10, passed: 8, failed: 2, skipped: 0, errors: 0 }
        },
        {
          ...mockResult,
          runId: 'run-2',
          suite: 'e2e-tests',
          summary: { total: 5, passed: 4, failed: 1, skipped: 0, errors: 0 }
        },
        {
          ...mockResult,
          runId: 'run-3',
          suite: 'api-tests',
          summary: { total: 8, passed: 6, failed: 1, skipped: 1, errors: 0 }
        }
      ];
    });

    it('should aggregate multiple test results', async () => {
      const aggregated = await processor.aggregateResults(results);

      expect(aggregated).toMatchObject({
        runIds: ['run-1', 'run-2', 'run-3'],
        totalRuns: 3,
        overallSummary: {
          total: 23, // 10 + 5 + 8
          passed: 18, // 8 + 4 + 6
          failed: 4, // 2 + 1 + 1
          skipped: 1, // 0 + 0 + 1
          errors: 0,
          passRate: 78.26, // 18/23 * 100
          failureRate: 17.39, // 4/23 * 100
          executionRate: 95.65 // (18+4)/23 * 100
        }
      });

      expect(aggregated.suiteBreakdown).toHaveProperty('api-tests');
      expect(aggregated.suiteBreakdown).toHaveProperty('e2e-tests');
      
      expect(aggregated.suiteBreakdown['api-tests']).toMatchObject({
        total: 18, // 10 + 8
        passed: 14, // 8 + 6
        failed: 3, // 2 + 1
        skipped: 1 // 0 + 1
      });
    });

    it('should calculate trends from historical data', async () => {
      const aggregated = await processor.aggregateResults(results);

      expect(aggregated.trends.passRateHistory).toHaveLength(3);
      expect(aggregated.trends.passRateHistory[0]).toBe(80); // 8/10 * 100
      expect(aggregated.trends.passRateHistory[1]).toBe(80); // 4/5 * 100
      expect(aggregated.trends.passRateHistory[2]).toBe(75); // 6/8 * 100

      expect(aggregated.trends.durationHistory).toEqual([300000, 300000, 300000]);
    });

    it('should identify failure patterns', async () => {
      // Add more failed runs for the same suite
      const failedResults = [
        ...results,
        {
          ...mockResult,
          runId: 'run-4',
          suite: 'api-tests',
          status: 'failed' as const,
          summary: { total: 10, passed: 5, failed: 5, skipped: 0, errors: 0 }
        },
        {
          ...mockResult,
          runId: 'run-5',
          suite: 'api-tests',
          status: 'failed' as const,
          summary: { total: 10, passed: 6, failed: 4, skipped: 0, errors: 0 }
        }
      ];

      const aggregated = await processor.aggregateResults(failedResults);

      expect(aggregated.trends.failurePatterns).toHaveLength(1);
      expect(aggregated.trends.failurePatterns[0]).toMatchObject({
        suite: 'api-tests',
        pattern: 'recurring_failure',
        frequency: 2
      });
    });

    it('should throw error for empty results array', async () => {
      await expect(processor.aggregateResults([])).rejects.toThrow('Cannot aggregate empty results array');
    });
  });

  describe('formatResult', () => {
    let processedResult: ProcessedResult;

    beforeEach(async () => {
      processedResult = await processor.processResult(mockResult);
    });

    it('should format result as console output', async () => {
      const formatted = await processor.formatResult(processedResult, 'console');

      expect(formatted).toContain('Test Results');
      expect(formatted).toContain('test-run-123');
      expect(formatted).toContain('api-tests');
      expect(formatted).toContain('PASSED');
      expect(formatted).toContain('80.0%'); // Pass rate
      expect(formatted).toContain('Next steps');
    });

    it('should format result as JSON', async () => {
      const formatted = await processor.formatResult(processedResult, 'json');
      const parsed = JSON.parse(formatted);

      expect(parsed).toMatchObject({
        runId: 'test-run-123',
        suite: 'api-tests',
        status: 'passed',
        processed: true
      });
    });

    it('should format result as HTML', async () => {
      const formatted = await processor.formatResult(processedResult, 'html');

      expect(formatted).toContain('<!DOCTYPE html>');
      expect(formatted).toContain('<title>Test Report - api-tests');
      expect(formatted).toContain('test-run-123');
      expect(formatted).toContain('PASSED');
    });

    it('should format result as JUnit XML', async () => {
      const formatted = await processor.formatResult(processedResult, 'junit');

      expect(formatted).toContain('<?xml version="1.0"');
      expect(formatted).toContain('<testsuites');
      expect(formatted).toContain('name="api-tests"');
      expect(formatted).toContain('tests="10"');
      expect(formatted).toContain('failures="1"');
    });

    it('should format result as Markdown', async () => {
      const formatted = await processor.formatResult(processedResult, 'markdown');

      expect(formatted).toContain('# Test Report');
      expect(formatted).toContain('## Overview');
      expect(formatted).toContain('## Summary');
      expect(formatted).toContain('| Metric | Count | Percentage |');
      expect(formatted).toContain('test-run-123');
    });

    it('should throw error for unsupported format', async () => {
      await expect(
        processor.formatResult(processedResult, 'unsupported' as any)
      ).rejects.toThrow('Unsupported format: unsupported');
    });
  });
});