/**
 * Configuration validation utilities and error handling
 */

import { ValidationResult, ValidationError, OTPConfig } from './types';
import { otpConfigSchema } from './schema';
import { createLogger } from '../utils/logger';

const logger = createLogger('ConfigValidation');

/**
 * Enhanced configuration validator with detailed error reporting
 */
export class ConfigurationValidator {
  /**
   * Validate configuration with comprehensive error reporting
   */
  static validate(config: any): ValidationResult {
    const { error, value } = otpConfigSchema.validate(config, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true
    });

    if (error) {
      const validationErrors = error.details.map(detail => ({
        path: detail.path.join('.'),
        message: this.formatErrorMessage(detail),
        value: detail.context?.value
      }));

      logger.debug('Configuration validation failed', {
        errorCount: validationErrors.length,
        errors: validationErrors
      });

      return {
        valid: false,
        errors: validationErrors
      };
    }

    logger.debug('Configuration validation successful');
    return {
      valid: true,
      errors: []
    };
  }

  /**
   * Validate specific configuration sections
   */
  static validateSection(config: any, sectionPath: string): ValidationResult {
    const section = this.getNestedValue(config, sectionPath);
    if (section === undefined) {
      return {
        valid: false,
        errors: [{
          path: sectionPath,
          message: `Configuration section '${sectionPath}' is missing`,
          value: undefined
        }]
      };
    }

    // For now, validate the entire config and filter errors for the section
    const fullValidation = this.validate(config);
    const sectionErrors = fullValidation.errors.filter(error => 
      error.path.startsWith(sectionPath)
    );

    return {
      valid: sectionErrors.length === 0,
      errors: sectionErrors
    };
  }

  /**
   * Check for common configuration issues
   */
  static checkCommonIssues(config: OTPConfig): ValidationError[] {
    const issues: ValidationError[] = [];

    // Check for missing required services
    const requiredServices = ['grafana', 'prometheus', 'postgres'];
    const configuredServices = config.infrastructure.services.map(s => s.name);
    
    for (const required of requiredServices) {
      if (!configuredServices.includes(required)) {
        issues.push({
          path: 'infrastructure.services',
          message: `Missing required service: ${required}`,
          value: configuredServices
        });
      }
    }

    // Check for port conflicts
    const usedPorts = new Set<number>();
    const conflictingPorts: number[] = [];
    
    for (const service of config.infrastructure.services) {
      for (const port of service.ports) {
        if (usedPorts.has(port)) {
          conflictingPorts.push(port);
        }
        usedPorts.add(port);
      }
    }

    if (conflictingPorts.length > 0) {
      issues.push({
        path: 'infrastructure.services',
        message: `Port conflicts detected: ${conflictingPorts.join(', ')}`,
        value: conflictingPorts
      });
    }

    // Check for invalid URLs
    const urls = [
      { path: 'reporting.grafana.url', value: config.reporting.grafana.url },
      { path: 'reporting.resultsApi.url', value: config.reporting.resultsApi.url }
    ];

    for (const { path, value } of urls) {
      try {
        new URL(value);
      } catch {
        issues.push({
          path,
          message: `Invalid URL format: ${value}`,
          value
        });
      }
    }

    // Check for missing fixture sets
    if (config.fixtures.defaultSet && !config.fixtures.sets[config.fixtures.defaultSet]) {
      issues.push({
        path: 'fixtures.defaultSet',
        message: `Default fixture set '${config.fixtures.defaultSet}' not found in fixtures.sets`,
        value: config.fixtures.defaultSet
      });
    }

    // Check for circular fixture dependencies
    const circularDeps = this.findCircularDependencies(config.fixtures.sets);
    if (circularDeps.length > 0) {
      issues.push({
        path: 'fixtures.sets',
        message: `Circular dependencies detected in fixture sets: ${circularDeps.join(' -> ')}`,
        value: circularDeps
      });
    }

    return issues;
  }

  /**
   * Generate user-friendly error messages with suggestions
   */
  static generateErrorReport(errors: ValidationError[]): string {
    if (errors.length === 0) {
      return 'Configuration is valid.';
    }

    const report = ['Configuration validation failed:', ''];
    
    // Group errors by section
    const errorsBySection = new Map<string, ValidationError[]>();
    
    for (const error of errors) {
      const section = error.path.split('.')[0];
      if (!errorsBySection.has(section)) {
        errorsBySection.set(section, []);
      }
      errorsBySection.get(section)!.push(error);
    }

    // Generate report for each section
    for (const [section, sectionErrors] of errorsBySection) {
      report.push(`[${section.toUpperCase()}]`);
      
      for (const error of sectionErrors) {
        report.push(`  ✗ ${error.path}: ${error.message}`);
        
        // Add suggestions based on error type
        const suggestion = this.getSuggestion(error);
        if (suggestion) {
          report.push(`    💡 ${suggestion}`);
        }
      }
      
      report.push('');
    }

    return report.join('\n');
  }

  /**
   * Format Joi error messages to be more user-friendly
   */
  private static formatErrorMessage(detail: any): string {
    const { type, message, context } = detail;
    
    switch (type) {
      case 'any.required':
        return `Required field is missing`;
      case 'string.uri':
        return `Must be a valid URL`;
      case 'number.port':
        return `Must be a valid port number (1-65535)`;
      case 'array.min':
        return `Must contain at least ${context?.limit} item(s)`;
      case 'object.min':
        return `Must contain at least ${context?.limit} property/properties`;
      case 'any.only':
        return `Must be one of: ${context?.valids?.join(', ')}`;
      default:
        return message.replace(/"/g, "'");
    }
  }

  /**
   * Get configuration suggestions based on error type
   */
  private static getSuggestion(error: ValidationError): string | null {
    const { path, message } = error;
    
    if (path.includes('url') && message.includes('URL')) {
      return 'Ensure the URL includes protocol (http:// or https://) and is properly formatted';
    }
    
    if (path.includes('ports') && message.includes('port')) {
      return 'Use port numbers between 1 and 65535, avoid system ports (1-1023) for local development';
    }
    
    if (path.includes('profile') && message.includes('one of')) {
      return 'Valid profiles are: local, ci, k8s';
    }
    
    if (path.includes('fixtures') && message.includes('missing')) {
      return 'Create the fixture set or update the defaultSet to reference an existing set';
    }
    
    if (path.includes('services') && message.includes('Missing required service')) {
      return 'Add the missing service to infrastructure.services array';
    }
    
    if (message.includes('Port conflicts')) {
      return 'Ensure each service uses unique port numbers';
    }
    
    return null;
  }

  /**
   * Get nested value from object using dot notation
   */
  private static getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Find circular dependencies in fixture sets
   */
  private static findCircularDependencies(sets: Record<string, any>): string[] {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    const dfs = (setName: string, path: string[]): string[] | null => {
      if (recursionStack.has(setName)) {
        // Found a cycle
        const cycleStart = path.indexOf(setName);
        return path.slice(cycleStart).concat(setName);
      }
      
      if (visited.has(setName)) {
        return null;
      }
      
      visited.add(setName);
      recursionStack.add(setName);
      
      const set = sets[setName];
      if (set?.dependencies) {
        for (const dep of set.dependencies) {
          const cycle = dfs(dep, [...path, setName]);
          if (cycle) {
            return cycle;
          }
        }
      }
      
      recursionStack.delete(setName);
      return null;
    };
    
    for (const setName of Object.keys(sets)) {
      if (!visited.has(setName)) {
        const cycle = dfs(setName, []);
        if (cycle) {
          return cycle;
        }
      }
    }
    
    return [];
  }
}

/**
 * Configuration error class with enhanced error information
 */
export class ConfigurationError extends Error {
  constructor(
    message: string,
    public readonly errors: ValidationError[],
    public readonly configPath?: string
  ) {
    super(message);
    this.name = 'ConfigurationError';
  }

  /**
   * Get formatted error report
   */
  getReport(): string {
    return ConfigurationValidator.generateErrorReport(this.errors);
  }

  /**
   * Get error count by severity
   */
  getErrorSummary(): { total: number; bySection: Record<string, number> } {
    const bySection: Record<string, number> = {};
    
    for (const error of this.errors) {
      const section = error.path.split('.')[0];
      bySection[section] = (bySection[section] || 0) + 1;
    }
    
    return {
      total: this.errors.length,
      bySection
    };
  }
}