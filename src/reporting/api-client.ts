/**
 * Results API client - Handles communication with the Results API service
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { createLogger } from '../utils/logger';
import { ResultsApiConfig } from '../config/types';
import {
  ResultsApiClient,
  ProcessedResult,
  PublishResult,
  ResultQuery,
  AggregationQuery,
  AggregatedResult
} from './types';
import FormData from 'form-data';
import fs from 'fs/promises';
import path from 'path';

export class DefaultResultsApiClient implements ResultsApiClient {
  private logger = createLogger('ResultsApiClient');
  private client: AxiosInstance;
  private config: ResultsApiConfig;

  constructor(config: ResultsApiConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.url,
      timeout: config.timeout * 1000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'OTP-CLI/1.0.0'
      }
    });

    this.setupInterceptors();
  }

  /**
   * Publish a processed test result to the Results API
   */
  async publishResult(result: ProcessedResult): Promise<PublishResult> {
    this.logger.debug(`Publishing result for run ${result.runId}`);

    try {
      const response = await this.client.post('/runs', {
        runId: result.runId,
        suite: result.suite,
        status: result.status,
        summary: result.enrichedSummary,
        metadata: result.metadata,
        startTime: result.startTime.toISOString(),
        endTime: result.endTime.toISOString(),
        duration: result.duration,
        artifacts: result.artifacts,
        traceId: result.traceId
      });

      const publishResult: PublishResult = {
        success: true,
        runId: result.runId,
        url: response.data.url || `${this.config.url}/runs/${result.runId}`
      };

      this.logger.info(`Successfully published result for run ${result.runId}`);
      return publishResult;

    } catch (error) {
      this.logger.error(`Failed to publish result for run ${result.runId}:`, error);
      
      return {
        success: false,
        runId: result.runId,
        error: this.extractErrorMessage(error)
      };
    }
  }

  /**
   * Retrieve a specific test result by run ID
   */
  async getResult(runId: string): Promise<ProcessedResult | null> {
    this.logger.debug(`Retrieving result for run ${runId}`);

    try {
      const response = await this.client.get(`/runs/${runId}`);
      
      if (!response.data) {
        return null;
      }

      // Convert API response back to ProcessedResult format
      const result: ProcessedResult = {
        ...response.data,
        startTime: new Date(response.data.startTime),
        endTime: new Date(response.data.endTime),
        processedAt: new Date(response.data.processedAt || response.data.endTime),
        processed: true
      };

      this.logger.debug(`Successfully retrieved result for run ${runId}`);
      return result;

    } catch (error) {
      if (this.isNotFoundError(error)) {
        this.logger.debug(`Result not found for run ${runId}`);
        return null;
      }

      this.logger.error(`Failed to retrieve result for run ${runId}:`, error);
      throw new Error(`Failed to retrieve result: ${this.extractErrorMessage(error)}`);
    }
  }

  /**
   * Query multiple test results based on criteria
   */
  async queryResults(query: ResultQuery): Promise<ProcessedResult[]> {
    this.logger.debug('Querying results with criteria:', query);

    try {
      const params = this.buildQueryParams(query);
      const response = await this.client.get('/runs', { params });

      const results: ProcessedResult[] = (response.data.results || []).map((item: any) => ({
        ...item,
        startTime: new Date(item.startTime),
        endTime: new Date(item.endTime),
        processedAt: new Date(item.processedAt || item.endTime),
        processed: true
      }));

      this.logger.debug(`Retrieved ${results.length} results from query`);
      return results;

    } catch (error) {
      this.logger.error('Failed to query results:', error);
      throw new Error(`Failed to query results: ${this.extractErrorMessage(error)}`);
    }
  }

  /**
   * Get aggregated results based on query criteria
   */
  async getAggregatedResults(query: AggregationQuery): Promise<AggregatedResult> {
    this.logger.debug('Getting aggregated results with criteria:', query);

    try {
      const params = this.buildQueryParams(query);
      if (query.groupBy) {
        params.groupBy = query.groupBy.join(',');
      }
      if (query.metrics) {
        params.metrics = query.metrics.join(',');
      }

      const response = await this.client.get('/runs/aggregate', { params });

      const aggregated: AggregatedResult = {
        ...response.data,
        metadata: {
          ...response.data.metadata,
          timeRange: {
            start: new Date(response.data.metadata.timeRange.start),
            end: new Date(response.data.metadata.timeRange.end)
          }
        }
      };

      this.logger.debug('Successfully retrieved aggregated results');
      return aggregated;

    } catch (error) {
      this.logger.error('Failed to get aggregated results:', error);
      throw new Error(`Failed to get aggregated results: ${this.extractErrorMessage(error)}`);
    }
  }

  /**
   * Upload an artifact file for a specific run
   */
  async uploadArtifact(runId: string, artifactPath: string): Promise<string> {
    this.logger.debug(`Uploading artifact ${artifactPath} for run ${runId}`);

    try {
      // Check if file exists
      await fs.access(artifactPath);
      
      const fileName = path.basename(artifactPath);
      const fileBuffer = await fs.readFile(artifactPath);
      
      const formData = new FormData();
      formData.append('file', fileBuffer, fileName);
      formData.append('runId', runId);

      const response = await this.client.post(`/runs/${runId}/artifacts`, formData, {
        headers: {
          ...formData.getHeaders(),
          'Content-Type': 'multipart/form-data'
        }
      });

      const artifactUrl = response.data.url || `${this.config.url}/runs/${runId}/artifacts/${fileName}`;
      
      this.logger.info(`Successfully uploaded artifact ${fileName} for run ${runId}`);
      return artifactUrl;

    } catch (error) {
      this.logger.error(`Failed to upload artifact ${artifactPath} for run ${runId}:`, error);
      throw new Error(`Failed to upload artifact: ${this.extractErrorMessage(error)}`);
    }
  }

  /**
   * Validate connection to the Results API
   */
  async validateConnection(): Promise<boolean> {
    this.logger.debug('Validating connection to Results API');

    try {
      const response = await this.client.get('/health');
      const isHealthy = response.status === 200 && response.data.status === 'healthy';
      
      if (isHealthy) {
        this.logger.debug('Results API connection validated successfully');
      } else {
        this.logger.warn('Results API responded but reported unhealthy status');
      }
      
      return isHealthy;

    } catch (error) {
      this.logger.error('Results API connection validation failed:', error);
      return false;
    }
  }

  /**
   * Get run metadata for a specific run ID
   */
  async getRunMetadata(runId: string): Promise<any | null> {
    this.logger.debug(`Getting metadata for run ${runId}`);

    try {
      const response = await this.client.get(`/runs/${runId}/metadata`);
      
      if (!response.data) {
        return null;
      }

      this.logger.debug(`Successfully retrieved metadata for run ${runId}`);
      return response.data;

    } catch (error) {
      if (this.isNotFoundError(error)) {
        this.logger.debug(`Metadata not found for run ${runId}`);
        return null;
      }

      this.logger.error(`Failed to retrieve metadata for run ${runId}:`, error);
      throw new Error(`Failed to retrieve run metadata: ${this.extractErrorMessage(error)}`);
    }
  }

  /**
   * Update run metadata
   */
  async updateRunMetadata(runId: string, metadata: Record<string, any>): Promise<boolean> {
    this.logger.debug(`Updating metadata for run ${runId}`);

    try {
      await this.client.patch(`/runs/${runId}/metadata`, metadata);
      
      this.logger.info(`Successfully updated metadata for run ${runId}`);
      return true;

    } catch (error) {
      this.logger.error(`Failed to update metadata for run ${runId}:`, error);
      throw new Error(`Failed to update run metadata: ${this.extractErrorMessage(error)}`);
    }
  }

  /**
   * Delete a run and its associated data
   */
  async deleteRun(runId: string): Promise<boolean> {
    this.logger.debug(`Deleting run ${runId}`);

    try {
      await this.client.delete(`/runs/${runId}`);
      
      this.logger.info(`Successfully deleted run ${runId}`);
      return true;

    } catch (error) {
      if (this.isNotFoundError(error)) {
        this.logger.debug(`Run ${runId} not found for deletion`);
        return false;
      }

      this.logger.error(`Failed to delete run ${runId}:`, error);
      throw new Error(`Failed to delete run: ${this.extractErrorMessage(error)}`);
    }
  }

  /**
   * Get artifacts for a specific run
   */
  async getRunArtifacts(runId: string): Promise<string[]> {
    this.logger.debug(`Getting artifacts for run ${runId}`);

    try {
      const response = await this.client.get(`/runs/${runId}/artifacts`);
      
      const artifacts = response.data.artifacts || [];
      this.logger.debug(`Retrieved ${artifacts.length} artifacts for run ${runId}`);
      return artifacts;

    } catch (error) {
      if (this.isNotFoundError(error)) {
        this.logger.debug(`No artifacts found for run ${runId}`);
        return [];
      }

      this.logger.error(`Failed to retrieve artifacts for run ${runId}:`, error);
      throw new Error(`Failed to retrieve run artifacts: ${this.extractErrorMessage(error)}`);
    }
  }

  /**
   * Get the most recent run ID
   */
  async getLatestRunId(): Promise<string | null> {
    this.logger.debug('Getting latest run ID');

    try {
      const results = await this.queryResults({
        limit: 1,
        offset: 0
      });

      if (results.length === 0) {
        this.logger.debug('No runs found');
        return null;
      }

      const latestRunId = results[0].runId;
      this.logger.debug(`Latest run ID: ${latestRunId}`);
      return latestRunId;

    } catch (error) {
      this.logger.error('Failed to get latest run ID:', error);
      throw new Error(`Failed to get latest run ID: ${this.extractErrorMessage(error)}`);
    }
  }

  /**
   * Get API status and statistics
   */
  async getApiStatus(): Promise<any> {
    this.logger.debug('Getting API status and statistics');

    try {
      const response = await this.client.get('/status');
      
      this.logger.debug('Successfully retrieved API status');
      return response.data;

    } catch (error) {
      this.logger.error('Failed to get API status:', error);
      throw new Error(`Failed to get API status: ${this.extractErrorMessage(error)}`);
    }
  }

  /**
   * Setup request/response interceptors
   */
  private setupInterceptors(): void {
    // Request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        this.logger.debug(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        this.logger.error('API Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        this.logger.debug(`API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        this.logger.error(`API Response Error: ${error.response?.status} ${error.config?.url}`, error.message);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Build query parameters from ResultQuery
   */
  private buildQueryParams(query: ResultQuery): Record<string, any> {
    const params: Record<string, any> = {};

    if (query.suites && query.suites.length > 0) {
      params.suites = query.suites.join(',');
    }

    if (query.status && query.status.length > 0) {
      params.status = query.status.join(',');
    }

    if (query.tags && query.tags.length > 0) {
      params.tags = query.tags.join(',');
    }

    if (query.environment) {
      params.environment = query.environment;
    }

    if (query.dateRange) {
      params.startDate = query.dateRange.start.toISOString();
      params.endDate = query.dateRange.end.toISOString();
    }

    if (query.limit) {
      params.limit = query.limit;
    }

    if (query.offset && query.offset > 0) {
      params.offset = query.offset;
    }

    return params;
  }

  /**
   * Extract error message from various error types
   */
  private extractErrorMessage(error: any): string {
    if (error instanceof AxiosError) {
      if (error.response?.data?.message) {
        return error.response.data.message;
      }
      if (error.response?.data?.error) {
        return error.response.data.error;
      }
      if (error.message) {
        return error.message;
      }
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown error occurred';
  }

  /**
   * Check if error is a 404 Not Found
   */
  private isNotFoundError(error: any): boolean {
    return error instanceof AxiosError && error.response?.status === 404;
  }
}