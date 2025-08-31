/**
 * Report Manager - Coordinates result processing, formatting, and API integration
 */

import { createLogger } from '../utils/logger';
import { OTPConfig } from '../config/types';
import { TestResult } from '../runners/types';
import {
  ResultProcessor,
  ProcessedResult,
  AggregatedResult,
  ResultFormat,
  ResultsApiClient,
  PublishResult,
  ResultQuery,
  AggregationQuery
} from './types';
import { DefaultResultProcessor } from './processor';
import { DefaultResultsApiClient } from './api-client';

export interface ReportManager {
  processAndPublishResult(result: TestResult): Promise<ProcessedResult>;
  formatResult(result: ProcessedResult, format: ResultFormat): Promise<string>;
  publishResult(result: ProcessedResult): Promise<PublishResult>;
  getResult(runId: string): Promise<ProcessedResult | null>;
  queryResults(query: ResultQuery): Promise<ProcessedResult[]>;
  getAggregatedResults(query: AggregationQuery): Promise<AggregatedResult>;
  validateApiConnection(): Promise<boolean>;
}

export class DefaultReportManager implements ReportManager {
  private logger = createLogger('ReportManager');
  private processor: ResultProcessor;
  private apiClient: ResultsApiClient;
  private config: OTPConfig;

  constructor(config: OTPConfig) {
    this.config = config;
    this.processor = new DefaultResultProcessor();
    this.apiClient = new DefaultResultsApiClient(config.reporting.resultsApi);
  }

  /**
   * Process a test result and publish it to the Results API
   */
  async processAndPublishResult(result: TestResult): Promise<ProcessedResult> {
    this.logger.info(`Processing and publishing result for run ${result.runId}`);

    try {
      // Process the result with enrichment
      const processedResult = await this.processor.processResult(result);
      
      // Attempt to publish to Results API
      const publishResult = await this.publishResult(processedResult);
      
      if (!publishResult.success) {
        this.logger.warn(`Failed to publish result for run ${result.runId}: ${publishResult.error}`);
        // Continue with processed result even if publishing fails
      }

      this.logger.info(`Result processing completed for run ${result.runId}`);
      return processedResult;

    } catch (error) {
      this.logger.error(`Failed to process result for run ${result.runId}:`, error);
      throw error;
    }
  }

  /**
   * Format a processed result in the specified format
   */
  async formatResult(result: ProcessedResult, format: ResultFormat): Promise<string> {
    this.logger.debug(`Formatting result ${result.runId} as ${format}`);
    
    try {
      return await this.processor.formatResult(result, format);
    } catch (error) {
      this.logger.error(`Failed to format result ${result.runId} as ${format}:`, error);
      throw error;
    }
  }

  /**
   * Publish a processed result to the Results API
   */
  async publishResult(result: ProcessedResult): Promise<PublishResult> {
    this.logger.debug(`Publishing result for run ${result.runId}`);

    try {
      // Validate API connection first
      const isConnected = await this.validateApiConnection();
      if (!isConnected) {
        return {
          success: false,
          runId: result.runId,
          error: 'Results API is not available'
        };
      }

      return await this.apiClient.publishResult(result);

    } catch (error) {
      this.logger.error(`Failed to publish result for run ${result.runId}:`, error);
      return {
        success: false,
        runId: result.runId,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Retrieve a specific test result by run ID
   */
  async getResult(runId: string): Promise<ProcessedResult | null> {
    this.logger.debug(`Retrieving result for run ${runId}`);

    try {
      return await this.apiClient.getResult(runId);
    } catch (error) {
      this.logger.error(`Failed to retrieve result for run ${runId}:`, error);
      throw error;
    }
  }

  /**
   * Query multiple test results based on criteria
   */
  async queryResults(query: ResultQuery): Promise<ProcessedResult[]> {
    this.logger.debug('Querying results with criteria:', query);

    try {
      return await this.apiClient.queryResults(query);
    } catch (error) {
      this.logger.error('Failed to query results:', error);
      throw error;
    }
  }

  /**
   * Get aggregated results based on query criteria
   */
  async getAggregatedResults(query: AggregationQuery): Promise<AggregatedResult> {
    this.logger.debug('Getting aggregated results with criteria:', query);

    try {
      return await this.apiClient.getAggregatedResults(query);
    } catch (error) {
      this.logger.error('Failed to get aggregated results:', error);
      throw error;
    }
  }

  /**
   * Validate connection to the Results API
   */
  async validateApiConnection(): Promise<boolean> {
    try {
      return await this.apiClient.validateConnection();
    } catch (error) {
      this.logger.debug('API connection validation failed:', error);
      return false;
    }
  }

  /**
   * Process multiple results and generate aggregated report
   */
  async processMultipleResults(results: TestResult[]): Promise<AggregatedResult> {
    this.logger.info(`Processing ${results.length} results for aggregation`);

    try {
      return await this.processor.aggregateResults(results);
    } catch (error) {
      this.logger.error('Failed to process multiple results:', error);
      throw error;
    }
  }

  /**
   * Upload artifacts for a specific run
   */
  async uploadArtifacts(runId: string, artifactPaths: string[]): Promise<string[]> {
    this.logger.info(`Uploading ${artifactPaths.length} artifacts for run ${runId}`);

    const uploadedUrls: string[] = [];
    const errors: string[] = [];

    for (const artifactPath of artifactPaths) {
      try {
        const url = await this.apiClient.uploadArtifact(runId, artifactPath);
        uploadedUrls.push(url);
        this.logger.debug(`Successfully uploaded artifact: ${artifactPath}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${artifactPath}: ${errorMessage}`);
        this.logger.error(`Failed to upload artifact ${artifactPath}:`, error);
      }
    }

    if (errors.length > 0) {
      this.logger.warn(`Some artifacts failed to upload: ${errors.join(', ')}`);
    }

    this.logger.info(`Uploaded ${uploadedUrls.length}/${artifactPaths.length} artifacts for run ${runId}`);
    return uploadedUrls;
  }

  /**
   * Generate a comprehensive report for a run
   */
  async generateReport(runId: string, format: ResultFormat = 'console'): Promise<string> {
    this.logger.info(`Generating ${format} report for run ${runId}`);

    try {
      // Try to get result from API first
      let result = await this.getResult(runId);
      
      if (!result) {
        throw new Error(`Result not found for run ID: ${runId}`);
      }

      return await this.formatResult(result, format);

    } catch (error) {
      this.logger.error(`Failed to generate report for run ${runId}:`, error);
      throw error;
    }
  }

  /**
   * Get the last run ID from the API
   */
  async getLastRunId(): Promise<string | null> {
    this.logger.debug('Getting last run ID');

    try {
      return await this.apiClient.getLatestRunId();
    } catch (error) {
      this.logger.error('Failed to get last run ID:', error);
      return null;
    }
  }

  /**
   * Clean up old results (if supported by API)
   */
  async cleanupOldResults(olderThanDays: number): Promise<number> {
    this.logger.info(`Cleaning up results older than ${olderThanDays} days`);

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const oldResults = await this.queryResults({
        dateRange: {
          start: new Date('2000-01-01'), // Very old date
          end: cutoffDate
        }
      });

      // Note: Actual deletion would require a delete endpoint in the API
      // For now, just return the count of results that would be deleted
      this.logger.info(`Found ${oldResults.length} results older than ${olderThanDays} days`);
      return oldResults.length;

    } catch (error) {
      this.logger.error('Failed to cleanup old results:', error);
      throw error;
    }
  }
}