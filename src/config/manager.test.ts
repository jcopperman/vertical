/**
 * Unit tests for Configuration Manager
 */

import { DefaultConfigurationManager } from './manager';
import { OTPConfig, ProfileType } from './types';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock the logger to avoid console output during tests
jest.mock('../utils/logger', () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }))
}));

describe('Configuration Manager', () => {
  let tempDir: string;
  let configManager: DefaultConfigurationManager;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'otp-config-test-'));
    configManager = new DefaultConfigurationManager(tempDir);
    
    // Reset NODE_ENV to avoid test environment affecting profile resolution
    delete process.env.NODE_ENV;
    delete process.env.OTP_PROFILE;
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('Configuration Loading', () => {
    it('should load valid configuration from file', async () => {
      const validConfig: OTPConfig = {
        version: '1.0.0',
        profile: 'local',
        infrastructure: {
          compose: {
            baseFile: 'docker-compose.yml',
            profileFiles: {
              local: 'docker-compose.local.yml',
              ci: 'docker-compose.ci.yml',
              k8s: 'docker-compose.k8s.yml'
            },
            projectName: 'test-otp'
          },
          services: [
            {
              name: 'grafana',
              ports: [3000]
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
          }
        },
        reporting: {
          grafana: {
            url: 'http://localhost:3000',
            dashboards: [
              {
                name: 'Test Results',
                uid: 'test-results'
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
              description: 'Test data',
              files: ['users.json']
            }
          }
        }
      };

      // Write config file
      const configPath = path.join(tempDir, 'otp.config.js');
      await fs.promises.writeFile(
        configPath,
        `module.exports = ${JSON.stringify(validConfig, null, 2)};`
      );

      const loadedConfig = await configManager.loadConfig();
      
      expect(loadedConfig).toBeDefined();
      expect(loadedConfig.version).toBe('1.0.0');
      expect(loadedConfig.infrastructure.compose.projectName).toBe('test-otp');
    });

    it('should throw error when no configuration file exists', async () => {
      await expect(configManager.loadConfig()).rejects.toThrow(
        'No configuration file found'
      );
    });

    it('should throw error when configuration file is empty', async () => {
      const configPath = path.join(tempDir, 'otp.config.js');
      await fs.promises.writeFile(configPath, 'module.exports = {};');

      await expect(configManager.loadConfig()).rejects.toThrow(
        'Configuration validation failed'
      );
    });

    it('should load configuration from .otprc file', async () => {
      const validConfig = {
        version: '1.0.0',
        profile: 'local',
        infrastructure: {
          compose: {
            baseFile: 'docker-compose.yml',
            profileFiles: {
              local: 'docker-compose.local.yml',
              ci: 'docker-compose.ci.yml',
              k8s: 'docker-compose.k8s.yml'
            },
            projectName: 'test-otp'
          },
          services: [],
          healthChecks: { timeout: 60, retries: 5, interval: 5 }
        },
        runners: {},
        reporting: {
          grafana: { url: 'http://localhost:3000', dashboards: [] },
          resultsApi: { url: 'http://localhost:8080/api', timeout: 30 }
        },
        fixtures: {
          defaultSet: 'basic',
          sets: {
            basic: { name: 'Basic', description: 'Test', files: ['test.json'] }
          }
        }
      };

      const configPath = path.join(tempDir, '.otprc');
      await fs.promises.writeFile(configPath, JSON.stringify(validConfig, null, 2));

      const loadedConfig = await configManager.loadConfig();
      expect(loadedConfig.infrastructure.compose.projectName).toBe('test-otp');
    });
  });

  describe('Profile Resolution', () => {
    beforeEach(async () => {
      // Create a minimal valid config for profile tests
      const minimalConfig = await createMinimalConfig(tempDir);
    });

    it('should use provided profile parameter', async () => {
      const config = await configManager.loadConfig('ci');
      expect(config.profile).toBe('ci');
      expect(configManager.getActiveProfile()).toBe('ci');
    });

    it('should use OTP_PROFILE environment variable', async () => {
      process.env.OTP_PROFILE = 'k8s';
      
      const config = await configManager.loadConfig();
      expect(config.profile).toBe('k8s');
      
      delete process.env.OTP_PROFILE;
    });

    it('should use ci profile when NODE_ENV is test', async () => {
      process.env.NODE_ENV = 'test';
      
      const config = await configManager.loadConfig();
      expect(config.profile).toBe('ci');
      
      delete process.env.NODE_ENV;
    });

    it('should default to local profile', async () => {
      const config = await configManager.loadConfig();
      expect(config.profile).toBe('local');
    });

    it('should fallback to local for invalid profile', async () => {
      const config = await configManager.loadConfig('invalid-profile' as ProfileType);
      expect(config.profile).toBe('local');
    });
  });

  describe('Environment Variable Overrides', () => {
    beforeEach(async () => {
      await createMinimalConfig(tempDir);
    });

    it('should override compose project name from environment', async () => {
      process.env.OTP_COMPOSE_PROJECT_NAME = 'custom-project';
      
      const config = await configManager.loadConfig();
      expect(config.infrastructure.compose.projectName).toBe('custom-project');
      
      delete process.env.OTP_COMPOSE_PROJECT_NAME;
    });

    it('should override health check timeout from environment', async () => {
      process.env.OTP_HEALTH_CHECK_TIMEOUT = '120';
      
      const config = await configManager.loadConfig();
      expect(config.infrastructure.healthChecks.timeout).toBe(120);
      
      delete process.env.OTP_HEALTH_CHECK_TIMEOUT;
    });

    it('should override Grafana URL from environment', async () => {
      process.env.OTP_GRAFANA_URL = 'http://custom-grafana:3000';
      
      const config = await configManager.loadConfig();
      expect(config.reporting.grafana.url).toBe('http://custom-grafana:3000');
      
      delete process.env.OTP_GRAFANA_URL;
    });

    it('should override Results API URL from environment', async () => {
      process.env.OTP_RESULTS_API_URL = 'http://custom-api:8080/api';
      
      const config = await configManager.loadConfig();
      expect(config.reporting.resultsApi.url).toBe('http://custom-api:8080/api');
      
      delete process.env.OTP_RESULTS_API_URL;
    });

    it('should ignore invalid health check timeout', async () => {
      process.env.OTP_HEALTH_CHECK_TIMEOUT = 'invalid';
      
      const config = await configManager.loadConfig('local'); // Explicitly use local to avoid CI overrides
      expect(config.infrastructure.healthChecks.timeout).toBe(60); // Default value
      
      delete process.env.OTP_HEALTH_CHECK_TIMEOUT;
    });
  });

  describe('Profile-Specific Overrides', () => {
    beforeEach(async () => {
      await createMinimalConfig(tempDir);
    });

    it('should apply CI-specific overrides', async () => {
      const config = await configManager.loadConfig('ci');
      
      expect(config.profile).toBe('ci');
      expect(config.infrastructure.healthChecks.timeout).toBeGreaterThanOrEqual(120);
      expect(config.infrastructure.healthChecks.retries).toBeGreaterThanOrEqual(10);
    });

    it('should not modify local profile settings', async () => {
      const config = await configManager.loadConfig('local');
      
      expect(config.profile).toBe('local');
      expect(config.infrastructure.healthChecks.timeout).toBe(60);
      expect(config.infrastructure.healthChecks.retries).toBe(5);
    });
  });

  describe('Configuration Validation', () => {
    it('should validate correct configuration', () => {
      const validConfig: OTPConfig = {
        version: '1.0.0',
        profile: 'local',
        infrastructure: {
          compose: {
            baseFile: 'docker-compose.yml',
            profileFiles: {
              local: 'docker-compose.local.yml',
              ci: 'docker-compose.ci.yml',
              k8s: 'docker-compose.k8s.yml'
            },
            projectName: 'test'
          },
          services: [],
          healthChecks: { timeout: 60, retries: 5, interval: 5 }
        },
        runners: {},
        reporting: {
          grafana: { url: 'http://localhost:3000', dashboards: [] },
          resultsApi: { url: 'http://localhost:8080/api', timeout: 30 }
        },
        fixtures: {
          defaultSet: 'basic',
          sets: {
            basic: { name: 'Basic', description: 'Test', files: ['test.json'] }
          }
        }
      };

      const result = configManager.validateConfig(validConfig);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return validation errors for invalid configuration', () => {
      const invalidConfig = {
        version: '1.0.0',
        profile: 'invalid-profile',
        // Missing required fields
      } as any;

      const result = configManager.validateConfig(invalidConfig);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should throw error when loading invalid configuration', async () => {
      const invalidConfig = {
        version: '1.0.0',
        profile: 'invalid-profile'
        // Missing required fields
      };

      const configPath = path.join(tempDir, 'otp.config.js');
      await fs.promises.writeFile(
        configPath,
        `module.exports = ${JSON.stringify(invalidConfig, null, 2)};`
      );

      await expect(configManager.loadConfig()).rejects.toThrow(
        'Configuration validation failed'
      );
    });
  });

  describe('Utility Methods', () => {
    it('should detect when configuration exists', async () => {
      expect(configManager.hasConfig()).toBe(false);
      
      await createMinimalConfig(tempDir);
      
      expect(configManager.hasConfig()).toBe(true);
    });

    it('should return configuration file path', async () => {
      expect(configManager.getConfigPath()).toBeNull();
      
      const configPath = await createMinimalConfig(tempDir);
      
      expect(configManager.getConfigPath()).toBe(configPath);
    });

    it('should create default configuration file', async () => {
      const createdPath = await configManager.createDefaultConfig('local');
      
      expect(fs.existsSync(createdPath)).toBe(true);
      expect(createdPath).toContain('otp.config.js');
      
      // Verify the created config is valid
      const config = await configManager.loadConfig();
      expect(config.profile).toBe('local');
      expect(config.version).toBe('1.0.0');
    });
  });
});

// Helper function to create a minimal valid configuration
async function createMinimalConfig(tempDir: string): Promise<string> {
  const minimalConfig: OTPConfig = {
    version: '1.0.0',
    profile: 'local',
    infrastructure: {
      compose: {
        baseFile: 'docker-compose.yml',
        profileFiles: {
          local: 'docker-compose.local.yml',
          ci: 'docker-compose.ci.yml',
          k8s: 'docker-compose.k8s.yml'
        },
        projectName: 'test-otp'
      },
      services: [],
      healthChecks: {
        timeout: 60,
        retries: 5,
        interval: 5
      }
    },
    runners: {},
    reporting: {
      grafana: {
        url: 'http://localhost:3000',
        dashboards: []
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
          description: 'Test data',
          files: ['test.json']
        }
      }
    }
  };

  const configPath = path.join(tempDir, 'otp.config.js');
  await fs.promises.writeFile(
    configPath,
    `module.exports = ${JSON.stringify(minimalConfig, null, 2)};`
  );

  return configPath;
}