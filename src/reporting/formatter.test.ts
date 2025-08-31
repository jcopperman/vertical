/**
 * Tests for ResultFormatter
 */

import { ResultFormatter } from './formatter';
import { ProcessedResult } from './types';

describe('ResultFormatter', () => {
  let formatter: ResultFormatter;
  let mockProcessedResult: ProcessedResult;

  beforeEach(() => {
    formatter = new ResultFormatter();

    mockProcessedResult = {
      runId: 'test-run-123',
      suite: 'api-tests',
      status: 'passed',
      summary: {
        total: 10,
        passed: 8,
        failed: 1,
        skipped: 1,
        errors: 0,
        coverage: {
          lines: 85,
          functions: 90,
          branches: 75,
          statements: 88
        }
      },
      enrichedSummary: {
        total: 10,
        passed: 8,
        failed: 1,
        skipped: 1,
        errors: 0,
        passRate: 80,
        failureRate: 10,
        executionRate: 90,
        performance: {
          averageTestDuration: 30000,
          throughput: 0.03,
          slowestTest: 'slow-test',
          fastestTest: 'fast-test'
        },
        coverage: {
          lines: 85,
          functions: 90,
          branches: 75,
          statements: 88
        }
      },
      artifacts: ['test-report.json', 'coverage.xml'],
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T10:05:00Z'),
      duration: 300000,
      traceId: 'trace-456',
      processed: true,
      processedAt: new Date('2024-01-01T10:05:01Z'),
      metadata: {
        environment: 'local',
        profile: 'test',
        tags: ['smoke', 'regression'],
        branch: 'feature/test',
        commit: 'abc123',
        hostname: 'test-host',
        platform: 'linux',
        nodeVersion: 'v18.0.0'
      }
    };
  });

  describe('formatConsole', () => {
    it('should format console output with colors enabled', () => {
      const output = formatter.formatConsole(mockProcessedResult, { colors: true });

      expect(output).toContain('Test Results');
      expect(output).toContain('test-run-123');
      expect(output).toContain('api-tests');
      expect(output).toContain('PASSED');
      expect(output).toContain('80.0%'); // Pass rate
      expect(output).toContain('10.0%'); // Failure rate
      expect(output).toContain('Summary');
      expect(output).toContain('Performance');
      expect(output).toContain('30000ms'); // Average test duration
      expect(output).toContain('0.03 tests/second'); // Throughput
      expect(output).toContain('Coverage');
      expect(output).toContain('85%'); // Lines coverage
      expect(output).toContain('Artifacts (2)');
      expect(output).toContain('test-report.json');
      expect(output).toContain('Next steps');
      expect(output).toContain('otp report open --run-id test-run-123');
    });

    it('should format console output without colors', () => {
      const output = formatter.formatConsole(mockProcessedResult, { colors: false });

      expect(output).toContain('Test Results');
      expect(output).toContain('PASSED');
      expect(output).not.toContain('\x1b['); // No ANSI color codes
    });

    it('should show metadata when requested', () => {
      const output = formatter.formatConsole(mockProcessedResult, { showMetadata: true });

      expect(output).toContain('Metadata');
      expect(output).toContain('Environment: local');
      expect(output).toContain('Profile: test');
      expect(output).toContain('Platform: linux');
      expect(output).toContain('Branch: feature/test');
      expect(output).toContain('Commit: abc123');
      expect(output).toContain('Tags: smoke, regression');
    });

    it('should hide artifacts when requested', () => {
      const output = formatter.formatConsole(mockProcessedResult, { showArtifacts: false });

      expect(output).not.toContain('Artifacts');
      expect(output).not.toContain('test-report.json');
    });

    it('should handle results without performance metrics', () => {
      const resultWithoutPerf = {
        ...mockProcessedResult,
        enrichedSummary: {
          ...mockProcessedResult.enrichedSummary,
          performance: undefined
        }
      };

      const output = formatter.formatConsole(resultWithoutPerf);

      expect(output).not.toContain('Performance');
      expect(output).not.toContain('Average Test Duration');
    });

    it('should handle results without coverage', () => {
      const resultWithoutCoverage = {
        ...mockProcessedResult,
        summary: {
          ...mockProcessedResult.summary,
          coverage: undefined
        }
      };

      const output = formatter.formatConsole(resultWithoutCoverage);

      expect(output).not.toContain('Coverage');
    });

    it('should include trace ID when available', () => {
      const output = formatter.formatConsole(mockProcessedResult);

      expect(output).toContain('Trace ID: trace-456');
    });
  });

  describe('formatJson', () => {
    it('should format result as valid JSON', () => {
      const output = formatter.formatJson(mockProcessedResult);
      const parsed = JSON.parse(output);

      expect(parsed).toMatchObject({
        runId: 'test-run-123',
        suite: 'api-tests',
        status: 'passed',
        processed: true
      });

      expect(parsed.enrichedSummary).toMatchObject({
        passRate: 80,
        failureRate: 10,
        executionRate: 90
      });
    });
  });

  describe('formatHtml', () => {
    it('should format result as valid HTML', () => {
      const output = formatter.formatHtml(mockProcessedResult);

      expect(output).toContain('<!DOCTYPE html>');
      expect(output).toContain('<html>');
      expect(output).toContain('<title>Test Report - api-tests (test-run-123)</title>');
      expect(output).toContain('<h1>Test Report</h1>');
      expect(output).toContain('test-run-123');
      expect(output).toContain('PASSED');
      expect(output).toContain('80.0%'); // Pass rate
      expect(output).toContain('test-report.json');
      expect(output).toContain('otp report open --run-id test-run-123');
    });

    it('should handle failed status with appropriate styling', () => {
      const failedResult = {
        ...mockProcessedResult,
        status: 'failed' as const
      };

      const output = formatter.formatHtml(failedResult);

      expect(output).toContain('FAILED');
      expect(output).toContain('Debug failed tests');
    });

    it('should show artifacts section when artifacts exist', () => {
      const output = formatter.formatHtml(mockProcessedResult);

      expect(output).toContain('<h2>Artifacts</h2>');
      expect(output).toContain('test-report.json');
      expect(output).toContain('coverage.xml');
    });

    it('should hide artifacts section when no artifacts', () => {
      const resultWithoutArtifacts = {
        ...mockProcessedResult,
        artifacts: []
      };

      const output = formatter.formatHtml(resultWithoutArtifacts);

      expect(output).not.toContain('<h2>Artifacts</h2>');
    });
  });

  describe('formatJunit', () => {
    it('should format result as valid JUnit XML', () => {
      const output = formatter.formatJunit(mockProcessedResult);

      expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(output).toContain('<testsuites');
      expect(output).toContain('name="api-tests"');
      expect(output).toContain('tests="10"');
      expect(output).toContain('failures="1"');
      expect(output).toContain('errors="0"');
      expect(output).toContain('time="300"'); // Duration in seconds
      expect(output).toContain('<property name="runId" value="test-run-123"/>');
      expect(output).toContain('<property name="environment" value="local"/>');
      expect(output).toContain('<property name="branch" value="feature/test"/>');
      expect(output).toContain('<property name="commit" value="abc123"/>');
    });

    it('should handle missing optional metadata', () => {
      const resultWithoutOptionalMeta = {
        ...mockProcessedResult,
        metadata: {
          ...mockProcessedResult.metadata,
          branch: undefined,
          commit: undefined
        }
      };

      const output = formatter.formatJunit(resultWithoutOptionalMeta);

      expect(output).toContain('<property name="runId" value="test-run-123"/>');
      expect(output).not.toContain('<property name="branch"');
      expect(output).not.toContain('<property name="commit"');
    });
  });

  describe('formatMarkdown', () => {
    it('should format result as valid Markdown', () => {
      const output = formatter.formatMarkdown(mockProcessedResult);

      expect(output).toContain('# Test Report ✅');
      expect(output).toContain('## Overview');
      expect(output).toContain('## Summary');
      expect(output).toContain('## Performance');
      expect(output).toContain('## Coverage');
      expect(output).toContain('## Artifacts');
      expect(output).toContain('## Next Steps');
      expect(output).toContain('| Metric | Count | Percentage |');
      expect(output).toContain('| Total | 10 | 100% |');
      expect(output).toContain('| Passed | 8 | 80.0% |');
      expect(output).toContain('| Failed | 1 | 10.0% |');
      expect(output).toContain('- **Suite:** api-tests');
      expect(output).toContain('- **Run ID:** `test-run-123`');
      expect(output).toContain('- **Average Test Duration:** 30000ms');
      expect(output).toContain('- **Throughput:** 0.03 tests/second');
      expect(output).toContain('- **Lines:** 85%');
      expect(output).toContain('- `test-report.json`');
      expect(output).toContain('`otp report open --run-id test-run-123`');
    });

    it('should use appropriate emoji for failed status', () => {
      const failedResult = {
        ...mockProcessedResult,
        status: 'failed' as const
      };

      const output = formatter.formatMarkdown(failedResult);

      expect(output).toContain('# Test Report ❌');
      expect(output).toContain('Debug failed tests');
    });

    it('should handle results without performance metrics', () => {
      const resultWithoutPerf = {
        ...mockProcessedResult,
        enrichedSummary: {
          ...mockProcessedResult.enrichedSummary,
          performance: undefined
        }
      };

      const output = formatter.formatMarkdown(resultWithoutPerf);

      expect(output).not.toContain('## Performance');
    });

    it('should handle results without coverage', () => {
      const resultWithoutCoverage = {
        ...mockProcessedResult,
        summary: {
          ...mockProcessedResult.summary,
          coverage: undefined
        }
      };

      const output = formatter.formatMarkdown(resultWithoutCoverage);

      expect(output).not.toContain('## Coverage');
    });

    it('should handle results without artifacts', () => {
      const resultWithoutArtifacts = {
        ...mockProcessedResult,
        artifacts: []
      };

      const output = formatter.formatMarkdown(resultWithoutArtifacts);

      expect(output).not.toContain('## Artifacts');
    });
  });
});