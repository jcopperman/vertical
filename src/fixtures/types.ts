/**
 * TypeScript interfaces for fixture management
 */

export interface FixtureData {
  id: string;
  type: string;
  data: any;
  metadata?: Record<string, any>;
}

export interface FixtureValidationResult {
  valid: boolean;
  errors: FixtureValidationError[];
  warnings?: string[];
}

export interface FixtureValidationError {
  file: string;
  line?: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface FixtureLoadResult {
  success: boolean;
  loaded: FixtureData[];
  errors: FixtureValidationError[];
  metadata: {
    setName: string;
    loadTime: number;
    totalRecords: number;
  };
}

export interface FixtureResetOptions {
  preserveSchema?: boolean;
  truncateOnly?: boolean;
  skipValidation?: boolean;
}

export interface FixtureSeedOptions {
  target: string;
  fixtureSet?: string;
  dryRun?: boolean;
  force?: boolean;
  environment?: Record<string, string>;
}