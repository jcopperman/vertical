/**
 * Types and interfaces for test runner management
 */

export interface TestRunnerManager {
  runSuite(suite: string, options: RunOptions): Promise<TestResult>;
  listAvailableSuites(): Promise<string[]>;
  getRunnerStatus(suite: string): Promise<RunnerStatus>;
  validateRunner(runnerName: string): Promise<ValidationResult>;
  setupEnvironment(runnerName: string, options: RunOptions): Promise<void>;
}

export interface RunOptions {
  target: string;
  tags?: string;
  parallel?: boolean;
  timeout?: number;
  environment?: Record<string, string>;
  dryRun?: boolean;
}

export interface TestResult {
  runId: string;
  suite: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  summary: TestSummary;
  artifacts: string[];
  traceId?: string;
  startTime: Date;
  endTime: Date;
  duration: number;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  coverage?: CoverageInfo;
}

export interface CoverageInfo {
  lines: number;
  functions: number;
  branches: number;
  statements: number;
}

export interface RunnerStatus {
  name: string;
  available: boolean;
  healthy: boolean;
  version?: string;
  lastRun?: Date;
  capabilities: RunnerCapability[];
  issues?: string[];
}

export interface RunnerCapability {
  name: string;
  supported: boolean;
  version?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings?: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  code: string;
}

export interface RunnerExecutionContext {
  runId: string;
  suite: string;
  runner: string;
  options: RunOptions;
  environment: Record<string, string>;
  workingDirectory: string;
  outputDirectory: string;
}

export interface ProgressEvent {
  type: 'start' | 'progress' | 'complete' | 'error';
  runId: string;
  suite: string;
  message: string;
  progress?: number;
  data?: any;
}

export type ProgressCallback = (event: ProgressEvent) => void;