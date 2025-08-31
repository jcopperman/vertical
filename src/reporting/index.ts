/**
 * Reporting module exports
 */

// Types
export * from './types';

// Core components
export { DefaultResultProcessor } from './processor';
export { ResultFormatter } from './formatter';
export { DefaultResultsApiClient } from './api-client';
export { DefaultReportManager, ReportManager } from './manager';
export { DefaultGrafanaIntegration } from './grafana-integration';

// Re-export commonly used interfaces
export type {
  ResultProcessor,
  ProcessedResult,
  AggregatedResult,
  ResultFormat,
  ResultsApiClient,
  PublishResult,
  ResultQuery,
  AggregationQuery,
  ConsoleOutputOptions,
  GrafanaIntegration,
  DashboardFilters,
  DashboardInfo
} from './types';