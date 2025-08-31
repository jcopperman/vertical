/**
 * TypeScript interfaces for OTP CLI configuration
 */

export type ProfileType = 'local' | 'ci' | 'k8s';

export interface OTPConfig {
  version: string;
  profile: ProfileType;
  infrastructure: InfrastructureConfig;
  runners: Record<string, RunnerDefinition>;
  reporting: ReportingConfig;
  fixtures: FixtureConfig;
}

export interface InfrastructureConfig {
  compose: ComposeConfig;
  helm?: HelmConfig;
  services: ServiceDefinition[];
  healthChecks: HealthCheckConfig;
}

export interface ComposeConfig {
  baseFile: string;
  profileFiles: Record<ProfileType, string>;
  projectName: string;
}

export interface HelmConfig {
  chart: string;
  namespace: string;
  values: Record<string, any>;
}

export interface ServiceDefinition {
  name: string;
  ports: number[];
  healthCheck?: {
    endpoint: string;
    timeout: number;
    retries: number;
  };
  dependencies?: string[];
}

export interface HealthCheckConfig {
  timeout: number;
  retries: number;
  interval: number;
}

export interface RunnerDefinition {
  type: 'docker' | 'k8s' | 'local';
  image?: string;
  command: string[];
  environment?: Record<string, string>;
  volumes?: string[];
  timeout: number;
}

export interface ReportingConfig {
  grafana: GrafanaConfig;
  resultsApi: ResultsApiConfig;
}

export interface GrafanaConfig {
  url: string;
  auth?: AuthConfig;
  dashboards: DashboardConfig[];
}

export interface AuthConfig {
  type: 'basic' | 'token' | 'oauth';
  username?: string;
  password?: string;
  token?: string;
}

export interface DashboardConfig {
  name: string;
  uid: string;
  filters?: Record<string, string>;
}

export interface ResultsApiConfig {
  url: string;
  timeout: number;
  auth?: AuthConfig;
}

export interface FixtureConfig {
  defaultSet: string;
  sets: Record<string, FixtureSet>;
}

export interface FixtureSet {
  name: string;
  description: string;
  files: string[];
  dependencies?: string[];
}

// Runtime state interfaces
export interface RuntimeState {
  activeProfile: ProfileType;
  stackStatus: StackStatus;
  lastRunId?: string;
  configPath: string;
  workspaceRoot: string;
}

export interface StackStatus {
  deployed: boolean;
  services: ServiceStatus[];
  endpoints: ServiceEndpoint[];
  lastDeployment?: Date;
  version?: string;
}

export interface ServiceStatus {
  name: string;
  status: 'running' | 'starting' | 'stopped' | 'error';
  health: 'healthy' | 'unhealthy' | 'unknown';
  ports: number[];
  logs?: string[];
}

export interface ServiceEndpoint {
  service: string;
  url: string;
  internal: boolean;
}

// Validation result interface
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  value?: any;
}