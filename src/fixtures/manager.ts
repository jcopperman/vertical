/**
 * Fixture management system for OTP CLI
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger';
import { FixtureConfig, FixtureSet } from '../config/types';
import {
  FixtureData,
  FixtureValidationResult,
  FixtureLoadResult,
  FixtureResetOptions,
  FixtureSeedOptions,
  FixtureValidationError
} from './types';

export class FixtureManager {
  private config: FixtureConfig;
  private workspaceRoot: string;
  private logger = createLogger('FixtureManager');

  constructor(config: FixtureConfig, workspaceRoot: string) {
    this.config = config;
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Load a fixture set by name
   */
  async loadFixtureSet(setName?: string): Promise<FixtureLoadResult> {
    const startTime = Date.now();
    const targetSet = setName || this.config.defaultSet;
    
    this.logger.info(`Loading fixture set: ${targetSet}`);

    const fixtureSet = this.config.sets[targetSet];
    if (!fixtureSet) {
      throw new Error(`Fixture set '${targetSet}' not found`);
    }

    // Validate dependencies first
    await this.validateDependencies(fixtureSet);

    const loaded: FixtureData[] = [];
    const errors: FixtureValidationError[] = [];

    // Load each fixture file
    for (const filePath of fixtureSet.files) {
      try {
        const fixtures = await this.loadFixtureFile(filePath);
        const validation = await this.validateFixtures(fixtures, filePath);
        
        if (!validation.valid) {
          errors.push(...validation.errors);
          continue;
        }

        loaded.push(...fixtures);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({
          file: filePath,
          message: `Failed to load fixture file: ${errorMessage}`,
          severity: 'error'
        });
      }
    }

    const loadTime = Date.now() - startTime;
    
    return {
      success: errors.length === 0,
      loaded,
      errors,
      metadata: {
        setName: targetSet,
        loadTime,
        totalRecords: loaded.length
      }
    };
  }

  /**
   * Validate fixture data integrity
   */
  async validateFixtures(fixtures: FixtureData[], filePath: string): Promise<FixtureValidationResult> {
    const errors: FixtureValidationError[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < fixtures.length; i++) {
      const fixture = fixtures[i];
      
      // Validate required fields
      if (!fixture.id) {
        errors.push({
          file: filePath,
          line: i + 1,
          message: 'Fixture missing required field: id',
          severity: 'error'
        });
      }

      if (!fixture.type) {
        errors.push({
          file: filePath,
          line: i + 1,
          message: 'Fixture missing required field: type',
          severity: 'error'
        });
      }

      if (!fixture.data) {
        errors.push({
          file: filePath,
          line: i + 1,
          message: 'Fixture missing required field: data',
          severity: 'error'
        });
      }

      // Check for duplicate IDs
      const duplicates = fixtures.filter(f => f.id === fixture.id);
      if (duplicates.length > 1) {
        warnings.push(`Duplicate fixture ID '${fixture.id}' found in ${filePath}`);
      }

      // Validate data structure based on type
      const typeValidation = await this.validateFixtureType(fixture);
      if (!typeValidation.valid) {
        errors.push(...typeValidation.errors.map(error => ({
          ...error,
          file: filePath,
          line: i + 1
        })));
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Reset fixture data in target environment
   */
  async resetFixtures(target: string, options: FixtureResetOptions = {}): Promise<void> {
    this.logger.info(`Resetting fixtures for target: ${target}`);

    // Implementation would depend on the target environment
    // For now, we'll simulate the reset operation
    if (options.truncateOnly) {
      this.logger.info('Truncating existing data only');
    } else {
      this.logger.info('Performing full reset with schema preservation');
    }

    // Simulate reset delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    this.logger.info('Fixture reset completed');
  }

  /**
   * Seed fixtures into target environment
   */
  async seedFixtures(options: FixtureSeedOptions): Promise<FixtureLoadResult> {
    this.logger.info(`Seeding fixtures to target: ${options.target}`);

    if (options.dryRun) {
      this.logger.info('Dry run mode - no actual seeding will occur');
    }

    // Load the fixture set
    const loadResult = await this.loadFixtureSet(options.fixtureSet);
    
    if (!loadResult.success && !options.force) {
      throw new Error(`Fixture validation failed. Use --force to seed anyway.`);
    }

    if (!options.dryRun) {
      // Perform actual seeding based on target
      await this.performSeeding(loadResult.loaded, options);
    }

    this.logger.info(`Seeding completed: ${loadResult.loaded.length} records processed`);
    return loadResult;
  }

  /**
   * Get available fixture sets
   */
  getAvailableFixtureSets(): string[] {
    return Object.keys(this.config.sets);
  }

  /**
   * Get fixture set information
   */
  getFixtureSetInfo(setName: string): FixtureSet | null {
    return this.config.sets[setName] || null;
  }

  /**
   * Load fixture data from a file
   */
  private async loadFixtureFile(filePath: string): Promise<FixtureData[]> {
    const fullPath = path.resolve(this.workspaceRoot, filePath);
    
    try {
      await fs.access(fullPath);
    } catch {
      throw new Error(`Fixture file not found: ${filePath}`);
    }

    const content = await fs.readFile(fullPath, 'utf-8');
    const extension = path.extname(filePath).toLowerCase();

    switch (extension) {
      case '.json':
        return JSON.parse(content);
      case '.js':
      case '.ts':
        // For JS/TS files, we'd need to require/import them
        // For now, treat as JSON
        return JSON.parse(content);
      default:
        throw new Error(`Unsupported fixture file format: ${extension}`);
    }
  }

  /**
   * Validate fixture dependencies
   */
  private async validateDependencies(fixtureSet: FixtureSet): Promise<void> {
    if (!fixtureSet.dependencies) {
      return;
    }

    for (const dependency of fixtureSet.dependencies) {
      if (!this.config.sets[dependency]) {
        throw new Error(`Dependency fixture set '${dependency}' not found`);
      }
    }
  }

  /**
   * Validate fixture data based on type
   */
  private async validateFixtureType(fixture: FixtureData): Promise<FixtureValidationResult> {
    const errors: FixtureValidationError[] = [];

    // Basic type-specific validation
    switch (fixture.type) {
      case 'user':
        if (!fixture.data.email) {
          errors.push({
            file: '',
            message: 'User fixture missing email field',
            severity: 'error'
          });
        }
        break;
      case 'product':
        if (!fixture.data.name) {
          errors.push({
            file: '',
            message: 'Product fixture missing name field',
            severity: 'error'
          });
        }
        break;
      // Add more type validations as needed
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Perform actual seeding to target environment
   */
  private async performSeeding(fixtures: FixtureData[], options: FixtureSeedOptions): Promise<void> {
    // Implementation would depend on the target environment
    // This could involve database connections, API calls, etc.
    
    this.logger.info(`Seeding ${fixtures.length} fixtures to ${options.target}`);
    
    // Simulate seeding delay
    await new Promise(resolve => setTimeout(resolve, fixtures.length * 10));
  }
}