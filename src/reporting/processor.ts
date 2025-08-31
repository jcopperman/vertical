/**
 * Test result processor - Handles result aggregation and enrichment
 */

import { createLogger } from '../utils/logger';
import { TestResult } from '../runners/types';
import {
  ResultProcessor,
  ProcessedResult,
  AggregatedResult,
  ResultFormat,
  ResultMetadata,
  EnrichedTestSummary,
  PerformanceMetrics,
  ResultTrends,
  FailurePattern
} from './types';
import { ResultFormatter } from './formatter';
import os from 'os';

export class DefaultResultProcessor implements ResultProcessor {
  private logger = createLogger('ResultProcessor');
  private formatter: ResultFormatter;

  constructor() {
    this.formatter = new ResultFormatter();
  }

  /**
   * Process a single test result with enrichment and metadata
   */
  async processResult(result: TestResult): Promise<ProcessedResult> {
    this.logger.debug(`Processing result for run ${result.runId}`);

    const metadata = await this.buildResultMetadata(result);
    const enrichedSummary = this.enrichTestSummary(result);

    const processedResult: ProcessedResult = {
      ...result,
      processed: true,
      processedAt: new Date(),
      metadata,
      enrichedSummary
    };

    this.logger.debug(`Result processing completed for run ${result.runId}`);
    return processedResult;
  }

  /**
   * Aggregate multiple test results into a comprehensive summary
   */
  async aggregateResults(results: TestResult[]): Promise<AggregatedResult> {
    this.logger.debug(`Aggregating ${results.length} test results`);

    if (results.length === 0) {
      throw new Error('Cannot aggregate empty results array');
    }

    const runIds = results.map(r => r.runId);
    const overallSummary = this.calculateOverallSummary(results);
    const suiteBreakdown = this.calculateSuiteBreakdown(results);
    const trends = this.calculateTrends(results);

    const aggregated: AggregatedResult = {
      runIds,
      totalRuns: results.length,
      overallSummary,
      suiteBreakdown,
      trends,
      metadata: {
        timeRange: {
          start: new Date(Math.min(...results.map(r => r.startTime.getTime()))),
          end: new Date(Math.max(...results.map(r => r.endTime.getTime())))
        },
        environments: [...new Set(results.map(r => 
          (r as any).metadata?.environment || 'unknown'
        ))],
        profiles: [...new Set(results.map(r => 
          (r as any).metadata?.profile || 'unknown'
        ))],
        uniqueTags: [...new Set(results.flatMap(r => 
          (r as any).metadata?.tags || []
        ))]
      }
    };

    this.logger.debug(`Aggregation completed for ${results.length} results`);
    return aggregated;
  }

  /**
   * Format a processed result in the specified format
   */
  async formatResult(result: ProcessedResult, format: ResultFormat): Promise<string> {
    this.logger.debug(`Formatting result ${result.runId} as ${format}`);

    switch (format) {
      case 'console':
        return this.formatter.formatConsole(result);
      case 'json':
        return this.formatter.formatJson(result);
      case 'html':
        return this.formatter.formatHtml(result);
      case 'junit':
        return this.formatter.formatJunit(result);
      case 'markdown':
        return this.formatter.formatMarkdown(result);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Build metadata for a test result
   */
  private async buildResultMetadata(result: TestResult): Promise<ResultMetadata> {
    const metadata: ResultMetadata = {
      environment: process.env.OTP_TARGET || 'local',
      profile: process.env.OTP_PROFILE || 'local',
      hostname: os.hostname(),
      platform: os.platform(),
      nodeVersion: process.version
    };

    // Add optional metadata from environment
    if (process.env.OTP_TAGS) {
      metadata.tags = process.env.OTP_TAGS.split(',').map(tag => tag.trim());
    }

    if (process.env.GIT_BRANCH || process.env.GITHUB_REF_NAME) {
      metadata.branch = process.env.GIT_BRANCH || process.env.GITHUB_REF_NAME;
    }

    if (process.env.GIT_COMMIT || process.env.GITHUB_SHA) {
      metadata.commit = process.env.GIT_COMMIT || process.env.GITHUB_SHA;
    }

    if (process.env.BUILD_ID || process.env.GITHUB_RUN_ID) {
      metadata.buildId = process.env.BUILD_ID || process.env.GITHUB_RUN_ID;
    }

    if (process.env.USER || process.env.USERNAME) {
      metadata.userId = process.env.USER || process.env.USERNAME;
    }

    return metadata;
  }

  /**
   * Enrich test summary with calculated metrics
   */
  private enrichTestSummary(result: TestResult): EnrichedTestSummary {
    const { summary } = result;
    
    const passRate = summary.total > 0 ? (summary.passed / summary.total) * 100 : 0;
    const failureRate = summary.total > 0 ? (summary.failed / summary.total) * 100 : 0;
    const executionRate = summary.total > 0 ? 
      ((summary.passed + summary.failed) / summary.total) * 100 : 0;

    const enriched: EnrichedTestSummary = {
      ...summary,
      passRate: Math.round(passRate * 100) / 100,
      failureRate: Math.round(failureRate * 100) / 100,
      executionRate: Math.round(executionRate * 100) / 100
    };

    // Add performance metrics if duration is available
    if (result.duration > 0 && summary.total > 0) {
      enriched.performance = {
        averageTestDuration: Math.round(result.duration / summary.total),
        throughput: Math.round((summary.total / (result.duration / 1000)) * 100) / 100
      };
    }

    return enriched;
  }

  /**
   * Calculate overall summary from multiple results
   */
  private calculateOverallSummary(results: TestResult[]): EnrichedTestSummary {
    const totals = results.reduce((acc, result) => ({
      total: acc.total + result.summary.total,
      passed: acc.passed + result.summary.passed,
      failed: acc.failed + result.summary.failed,
      skipped: acc.skipped + result.summary.skipped,
      errors: acc.errors + result.summary.errors
    }), { total: 0, passed: 0, failed: 0, skipped: 0, errors: 0 });

    const totalDuration = results.reduce((acc, result) => acc + result.duration, 0);
    
    const passRate = totals.total > 0 ? (totals.passed / totals.total) * 100 : 0;
    const failureRate = totals.total > 0 ? (totals.failed / totals.total) * 100 : 0;
    const executionRate = totals.total > 0 ? 
      ((totals.passed + totals.failed) / totals.total) * 100 : 0;

    const enriched: EnrichedTestSummary = {
      ...totals,
      passRate: Math.round(passRate * 100) / 100,
      failureRate: Math.round(failureRate * 100) / 100,
      executionRate: Math.round(executionRate * 100) / 100
    };

    if (totalDuration > 0 && totals.total > 0) {
      enriched.performance = {
        averageTestDuration: Math.round(totalDuration / totals.total),
        throughput: Math.round((totals.total / (totalDuration / 1000)) * 100) / 100
      };
    }

    return enriched;
  }

  /**
   * Calculate breakdown by test suite
   */
  private calculateSuiteBreakdown(results: TestResult[]): Record<string, EnrichedTestSummary> {
    const breakdown: Record<string, EnrichedTestSummary> = {};

    for (const result of results) {
      if (!breakdown[result.suite]) {
        breakdown[result.suite] = this.enrichTestSummary(result);
      } else {
        // Aggregate multiple runs of the same suite
        const existing = breakdown[result.suite];
        const enriched = this.enrichTestSummary(result);
        
        breakdown[result.suite] = {
          total: existing.total + enriched.total,
          passed: existing.passed + enriched.passed,
          failed: existing.failed + enriched.failed,
          skipped: existing.skipped + enriched.skipped,
          errors: existing.errors + enriched.errors,
          passRate: 0, // Will be recalculated
          failureRate: 0, // Will be recalculated
          executionRate: 0 // Will be recalculated
        };

        // Recalculate rates
        const total = breakdown[result.suite].total;
        if (total > 0) {
          breakdown[result.suite].passRate = 
            Math.round((breakdown[result.suite].passed / total) * 10000) / 100;
          breakdown[result.suite].failureRate = 
            Math.round((breakdown[result.suite].failed / total) * 10000) / 100;
          breakdown[result.suite].executionRate = 
            Math.round(((breakdown[result.suite].passed + breakdown[result.suite].failed) / total) * 10000) / 100;
        }
      }
    }

    return breakdown;
  }

  /**
   * Calculate trends from historical results
   */
  private calculateTrends(results: TestResult[]): ResultTrends {
    // Sort results by start time
    const sortedResults = [...results].sort((a, b) => 
      a.startTime.getTime() - b.startTime.getTime()
    );

    const passRateHistory = sortedResults.map(result => {
      const { summary } = result;
      return summary.total > 0 ? (summary.passed / summary.total) * 100 : 0;
    });

    const durationHistory = sortedResults.map(result => result.duration);

    // Identify failure patterns (simplified)
    const failurePatterns: FailurePattern[] = [];
    const failedSuites = sortedResults.filter(r => r.status === 'failed');
    
    const suiteFailureCounts: Record<string, number> = {};
    for (const result of failedSuites) {
      suiteFailureCounts[result.suite] = (suiteFailureCounts[result.suite] || 0) + 1;
    }

    for (const [suite, frequency] of Object.entries(suiteFailureCounts)) {
      if (frequency > 1) { // Only include patterns that occur more than once
        const lastFailure = failedSuites
          .filter(r => r.suite === suite)
          .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())[0];
        
        failurePatterns.push({
          suite,
          pattern: 'recurring_failure',
          frequency,
          lastSeen: lastFailure.startTime
        });
      }
    }

    return {
      passRateHistory,
      durationHistory,
      failurePatterns
    };
  }
}