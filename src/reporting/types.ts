/**
 * Types and interfaces for test result processing and reporting
 */

import { TestResult, TestSummary } from '../runners/types';

export interface ResultProcessor {
  processResult(result: TestResult): Promise<ProcessedResult>;
  aggregateResults(results: TestResult[]): Promise<AggregatedResult>;
  formatResult(result: ProcessedResult, format: ResultFormat): Promise<string>;
}

export interface ProcessedResult extends TestResult {
  processed: boolean;
  processedAt: Date;
  metadata: ResultMetadata;
  enrichedSummary: EnrichedTestSummary;
}

export interface EnrichedTestSummary extends TestSummary {
  passRate: number;
  failureRate: number;
  executionRate: number;
  performance?: PerformanceMetrics;
}

export interface PerformanceMetrics {
  averageTestDuration: number;
  slowestTest?: string;
  fastestTest?: string;
  throughput: number; // tests per second
}

export interface ResultMetadata {
  environment: string;
  profile: string;
  tags?: string[];
  branch?: string;
  commit?: string;
  buildId?: string;
  userId?: string;
  hostname: string;
  platform: string;
  nodeVersion: string;
}

export interface AggregatedResult {
  runIds: string[];
  totalRuns: number;
  overallSummary: EnrichedTestSummary;
  suiteBreakdown: Record<string, TestSummary>;
  trends: ResultTrends;
  metadata: AggregatedMetadata;
}

export interface ResultTrends {
  passRateHistory: number[];
  durationHistory: number[];
  failurePatterns: FailurePattern[];
}

export interface FailurePattern {
  suite: string;
  pattern: string;
  frequency: number;
  lastSeen: Date;
}

export interface AggregatedMetadata {
  timeRange: {
    start: Date;
    end: Date;
  };
  environments: string[];
  profiles: string[];
  uniqueTags: string[];
}

export type ResultFormat = 'console' | 'json' | 'html' | 'junit' | 'markdown';

export interface ResultsApiClient {
  publishResult(result: ProcessedResult): Promise<PublishResult>;
  getResult(runId: string): Promise<ProcessedResult | null>;
  queryResults(query: ResultQuery): Promise<ProcessedResult[]>;
  getAggregatedResults(query: AggregationQuery): Promise<AggregatedResult>;
  uploadArtifact(runId: string, artifactPath: string): Promise<string>;
  validateConnection(): Promise<boolean>;
  getRunMetadata(runId: string): Promise<any | null>;
  updateRunMetadata(runId: string, metadata: Record<string, any>): Promise<boolean>;
  deleteRun(runId: string): Promise<boolean>;
  getRunArtifacts(runId: string): Promise<string[]>;
  getLatestRunId(): Promise<string | null>;
  getApiStatus(): Promise<any>;
}

export interface PublishResult {
  success: boolean;
  runId: string;
  url?: string;
  error?: string;
}

export interface ResultQuery {
  suites?: string[];
  status?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
  tags?: string[];
  environment?: string;
  limit?: number;
  offset?: number;
}

export interface AggregationQuery extends ResultQuery {
  groupBy?: ('suite' | 'environment' | 'date' | 'status')[];
  metrics?: ('summary' | 'trends' | 'performance')[];
}

export interface ResultFormatter {
  formatConsole(result: ProcessedResult): string;
  formatJson(result: ProcessedResult): string;
  formatHtml(result: ProcessedResult): string;
  formatJunit(result: ProcessedResult): string;
  formatMarkdown(result: ProcessedResult): string;
}

export interface ConsoleOutputOptions {
  colors: boolean;
  verbose: boolean;
  showArtifacts: boolean;
  showMetadata: boolean;
  showTrends: boolean;
}

export interface GrafanaIntegration {
  authenticate(): Promise<string>;
  buildDashboardUrl(runId?: string, filters?: DashboardFilters): string;
  validateConnection(): Promise<boolean>;
  getDashboards(): Promise<DashboardInfo[]>;
  openDashboard(dashboardUid: string, runId?: string): Promise<string>;
}

export interface DashboardFilters {
  suite?: string;
  environment?: string;
  status?: string;
  timeRange?: {
    from: string;
    to: string;
  };
  [key: string]: any;
}

export interface DashboardInfo {
  uid: string;
  title: string;
  url: string;
  tags: string[];
}