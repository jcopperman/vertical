/**
 * Configuration Manager for OTP CLI
 * Handles loading, validation, and profile resolution
 */

import { cosmiconfigSync } from 'cosmiconfig';
import { OTPConfig, ProfileType, ValidationResult } from './types';
import { otpConfigSchema } from './schema';
import { ConfigurationValidator, ConfigurationError } from './validation';
import { createLogger } from '../utils/logger';
import { configCache } from '../utils/cache';
import { performanceMonitor, timedAsync } from '../utils/performance';
import path from 'path';
import fs from 'fs';

export interface ConfigurationManager {
  loadConfig(profile?: string): Promise<OTPConfig>;
  validateConfig(config: OTPConfig): ValidationResult;
  getActiveProfile(): string;
}

export class DefaultConfigurationManager implements ConfigurationManager {
  private readonly moduleName = 'otp';
  private cachedConfig?: OTPConfig;
  private activeProfile: ProfileType = 'local';
  private readonly logger = createLogger('ConfigManager');

  constructor(private readonly workspaceRoot: string = process.cwd()) {}

  /**
   * Load configuration with profile resolution and environment variable overrides
   */
  @timedAsync('config-load')
  async loadConfig(profile?: string): Promise<OTPConfig> {
    try {
      // Set active profile from parameter, environment, or default
      this.activeProfile = this.resolveProfile(profile);
      
      // Create cache key based on profile and workspace
      const cacheKey = `config:${this.activeProfile}:${this.workspaceRoot}`;
      
      // Try to get from cache first
      const cachedConfig = configCache.get(cacheKey);
      if (cachedConfig && this.cachedConfig) {
        this.logger.debug('Using cached configuration', { 
          profile: this.activeProfile,
          cacheKey 
        });
        return cachedConfig;
      }
      
      this.logger.debug('Loading configuration', { 
        profile: this.activeProfile, 
        workspaceRoot: this.workspaceRoot 
      });

      // Search for configuration file
      const explorer = cosmiconfigSync(this.moduleName);
      const result = explorer.search(this.workspaceRoot);
      
      if (!result) {
        throw new Error(`No configuration file found. Please create an ${this.moduleName}.config.js or .${this.moduleName}rc file.`);
      }

      this.logger.debug('Found configuration file', { 
        filepath: result.filepath,
        isEmpty: result.isEmpty 
      });

      if (result.isEmpty) {
        throw new Error(`Configuration file is empty: ${result.filepath}`);
      }

      // Load base configuration
      let config = result.config as OTPConfig;

      // Apply profile-specific overrides
      config = this.applyProfileOverrides(config, this.activeProfile);

      // Apply environment variable overrides
      config = this.applyEnvironmentOverrides(config);

      // Validate the final configuration
      const validation = this.validateConfig(config);
      if (!validation.valid) {
        throw new ConfigurationError(
          'Configuration validation failed',
          validation.errors,
          result.filepath
        );
      }

      // Check for common configuration issues
      const commonIssues = ConfigurationValidator.checkCommonIssues(config);
      if (commonIssues.length > 0) {
        this.logger.warn('Configuration has potential issues', {
          issueCount: commonIssues.length,
          issues: commonIssues.map(issue => `${issue.path}: ${issue.message}`)
        });
      }

      // Cache the validated configuration
      this.cachedConfig = config;
      configCache.set(cacheKey, config, 600000); // Cache for 10 minutes

      this.logger.info('Configuration loaded successfully', { 
        profile: this.activeProfile,
        version: config.version 
      });

      return config;
    } catch (error) {
      this.logger.error('Failed to load configuration', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Validate configuration against schema
   */
  validateConfig(config: OTPConfig): ValidationResult {
    return ConfigurationValidator.validate(config);
  }

  /**
   * Validate specific configuration section
   */
  validateSection(config: OTPConfig, sectionPath: string): ValidationResult {
    return ConfigurationValidator.validateSection(config, sectionPath);
  }

  /**
   * Check for common configuration issues
   */
  checkCommonIssues(config: OTPConfig) {
    return ConfigurationValidator.checkCommonIssues(config);
  }

  /**
   * Get the currently active profile
   */
  getActiveProfile(): string {
    return this.activeProfile;
  }

  /**
   * Resolve profile from parameter, environment variable, or default
   */
  private resolveProfile(profile?: string): ProfileType {
    // Priority: parameter > environment variable > NODE_ENV check > default
    let resolvedProfile: string;
    
    if (profile) {
      resolvedProfile = profile;
    } else if (process.env.OTP_PROFILE) {
      resolvedProfile = process.env.OTP_PROFILE;
    } else if (process.env.NODE_ENV === 'test') {
      resolvedProfile = 'ci';
    } else {
      resolvedProfile = 'local';
    }

    // Validate profile type
    const validProfiles: ProfileType[] = ['local', 'ci', 'k8s'];
    if (!validProfiles.includes(resolvedProfile as ProfileType)) {
      this.logger.warn('Invalid profile specified, using default', { 
        invalid: resolvedProfile, 
        default: 'local' 
      });
      return 'local';
    }

    return resolvedProfile as ProfileType;
  }

  /**
   * Apply profile-specific configuration overrides
   */
  private applyProfileOverrides(config: OTPConfig, profile: ProfileType): OTPConfig {
    // Set the profile in the config
    const profileConfig = { ...config, profile };

    // Apply profile-specific infrastructure settings
    if (profile === 'ci' && profileConfig.infrastructure?.healthChecks) {
      // CI-specific overrides
      profileConfig.infrastructure = {
        ...profileConfig.infrastructure,
        healthChecks: {
          ...profileConfig.infrastructure.healthChecks,
          timeout: Math.max(profileConfig.infrastructure.healthChecks.timeout, 120), // Longer timeout for CI
          retries: Math.max(profileConfig.infrastructure.healthChecks.retries, 10)
        }
      };
    } else if (profile === 'k8s') {
      // Kubernetes-specific overrides
      if (!profileConfig.infrastructure.helm) {
        this.logger.warn('Kubernetes profile selected but no Helm configuration found');
      }
    }

    return profileConfig;
  }

  /**
   * Apply environment variable overrides
   */
  private applyEnvironmentOverrides(config: OTPConfig): OTPConfig {
    const overriddenConfig = { ...config };

    // Infrastructure overrides
    if (process.env.OTP_COMPOSE_PROJECT_NAME) {
      overriddenConfig.infrastructure.compose.projectName = process.env.OTP_COMPOSE_PROJECT_NAME;
    }

    if (process.env.OTP_HEALTH_CHECK_TIMEOUT) {
      const timeout = parseInt(process.env.OTP_HEALTH_CHECK_TIMEOUT, 10);
      if (!isNaN(timeout)) {
        overriddenConfig.infrastructure.healthChecks.timeout = timeout;
      }
    }

    // Reporting overrides
    if (process.env.OTP_GRAFANA_URL) {
      overriddenConfig.reporting.grafana.url = process.env.OTP_GRAFANA_URL;
    }

    if (process.env.OTP_RESULTS_API_URL) {
      overriddenConfig.reporting.resultsApi.url = process.env.OTP_RESULTS_API_URL;
    }

    // Kubernetes overrides
    if (process.env.OTP_K8S_NAMESPACE && overriddenConfig.infrastructure.helm) {
      overriddenConfig.infrastructure.helm.namespace = process.env.OTP_K8S_NAMESPACE;
    }

    // Log applied overrides
    const appliedOverrides = Object.keys(process.env)
      .filter(key => key.startsWith('OTP_'))
      .reduce((acc, key) => {
        const value = process.env[key];
        if (value !== undefined) {
          acc[key] = value;
        }
        return acc;
      }, {} as Record<string, string>);

    if (Object.keys(appliedOverrides).length > 0) {
      this.logger.debug('Applied environment variable overrides', { overrides: appliedOverrides });
    }

    return overriddenConfig;
  }

  /**
   * Get configuration file path for the current workspace
   */
  getConfigPath(): string | null {
    const explorer = cosmiconfigSync(this.moduleName);
    const result = explorer.search(this.workspaceRoot);
    return result?.filepath || null;
  }

  /**
   * Check if configuration file exists
   */
  hasConfig(): boolean {
    return this.getConfigPath() !== null;
  }

  /**
   * Create a default configuration file
   */
  async createDefaultConfig(profile: ProfileType = 'local'): Promise<string> {
    const defaultConfig = this.generateDefaultConfig(profile);
    const configPath = path.join(this.workspaceRoot, `${this.moduleName}.config.js`);
    
    const configContent = `module.exports = ${JSON.stringify(defaultConfig, null, 2)};`;
    
    await fs.promises.writeFile(configPath, configContent, 'utf8');
    
    this.logger.info('Created default configuration file', { path: configPath });
    
    return configPath;
  }

  /**
   * Invalidate cached configuration
   */
  invalidateCache(): void {
    const cacheKey = `config:${this.activeProfile}:${this.workspaceRoot}`;
    configCache.delete(cacheKey);
    this.cachedConfig = undefined;
    this.logger.debug('Configuration cache invalidated', { cacheKey });
  }

  /**
   * Invalidate all configuration caches
   */
  static invalidateAllCaches(): void {
    configCache.invalidatePattern(/^config:/);
  }

  /**
   * Generate default configuration for a profile
   */
  private generateDefaultConfig(profile: ProfileType): OTPConfig {
    return {
      version: '1.0.0',
      profile,
      infrastructure: {
        compose: {
          baseFile: 'docker-compose.yml',
          profileFiles: {
            local: 'docker-compose.local.yml',
            ci: 'docker-compose.ci.yml',
            k8s: 'docker-compose.k8s.yml'
          },
          projectName: 'otp'
        },
        services: [
          {
            name: 'grafana',
            ports: [3000],
            healthCheck: {
              endpoint: '/api/health',
              timeout: 30,
              retries: 3
            }
          },
          {
            name: 'prometheus',
            ports: [9090],
            healthCheck: {
              endpoint: '/-/healthy',
              timeout: 30,
              retries: 3
            }
          },
          {
            name: 'postgres',
            ports: [5432],
            healthCheck: {
              endpoint: '/health',
              timeout: 30,
              retries: 5
            }
          }
        ],
        healthChecks: {
          timeout: 60,
          retries: 5,
          interval: 5
        }
      },
      runners: {
        api: {
          type: 'docker',
          image: 'postman/newman',
          command: ['newman', 'run', 'collection.json'],
          timeout: 300
        },
        e2e: {
          type: 'docker',
          image: 'playwright',
          command: ['npx', 'playwright', 'test'],
          timeout: 600
        }
      },
      reporting: {
        grafana: {
          url: 'http://localhost:3000',
          dashboards: [
            {
              name: 'Test Results Overview',
              uid: 'test-results-overview'
            }
          ]
        },
        resultsApi: {
          url: 'http://localhost:8080/api',
          timeout: 30
        }
      },
      fixtures: {
        defaultSet: 'basic',
        sets: {
          basic: {
            name: 'Basic Test Data',
            description: 'Minimal test data set for development',
            files: ['users.json', 'products.json']
          }
        }
      }
    };
  }
}