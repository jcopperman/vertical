/**
 * Integration tests for configuration management system
 */

import { DefaultConfigurationManager } from './manager';
import { ConfigurationValidator, ConfigurationError } from './validation';
import { OTPConfig, ProfileType } from './types';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock the logger
jest.mock('../utils/logger', () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }))
}));

describe('Configuration Management Integration', () => {
  let tempDir: string;
  let configManager: DefaultConfigurationManager;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'otp-integration-test-'));
    configManager = new DefaultConfigurationManager(tempDir);
    
    // Reset environment variables
    delete process.env.NODE_ENV;
    delete process.env.OTP_PROFILE;
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('should load and validate configuration with enhanced error reporting', async () => {
    // Create a configuration with multiple issues
    const problematicConfig = {
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
        services: [
          {
            name: 'grafana',
            ports: [3000]
          }
          // Missing prometheus and postgres (common issue)
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
          url: 'invalid-url', // Invalid URL (common issue)
          dashboards: []
        },
        resultsApi: {
          url: 'http://localhost:8080/api',
          timeout: 30
        }
      },
      fixtures: {
        defaultSet: 'nonexistent', // Missing fixture set (common issue)
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
      `module.exports = ${JSON.stringify(problematicConfig, null, 2)};`
    );

    try {
      await configManager.loadConfig();
      fail('Expected configuration loading to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      
      const configError = error as ConfigurationError;
      expect(configError.errors.length).toBeGreaterThan(0);
      
      // Check that the error report is generated
      const report = configError.getReport();
      expect(report).toContain('Must be a valid URL');
      
      // Check error summary
      const summary = configError.getErrorSummary();
      expect(summary.total).toBeGreaterThan(0);
    }
  });

  it('should successfully load valid configuration and detect common issues', async () => {
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
          projectName: 'test'
        },
        services: [
          {
            name: 'grafana',
            ports: [3000]
          }
          // Missing prometheus and postgres - should be detected as common issue
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
          url: 'http://localhost:3000', // Valid URL
          dashboards: []
        },
        resultsApi: {
          url: 'http://localhost:8080/api',
          timeout: 30
        }
      },
      fixtures: {
        defaultSet: 'basic', // Valid fixture set
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
      `module.exports = ${JSON.stringify(validConfig, null, 2)};`
    );

    // Should load successfully despite common issues
    const loadedConfig = await configManager.loadConfig();
    
    expect(loadedConfig).toBeDefined();
    expect(loadedConfig.version).toBe('1.0.0');
    
    // Check that common issues are detected
    const commonIssues = configManager.checkCommonIssues(loadedConfig);
    expect(commonIssues.length).toBeGreaterThan(0);
    expect(commonIssues.some(issue => issue.message.includes('prometheus'))).toBe(true);
  });

  it('should validate configuration sections independently', async () => {
    const config: OTPConfig = {
      version: '1.0.0',
      profile: 'local' as ProfileType,
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
        healthChecks: {
          timeout: 60,
          retries: 5,
          interval: 5
        }
      },
      runners: {},
      reporting: {
        grafana: {
          url: 'invalid-url', // Invalid URL in reporting section
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

    // Infrastructure section should be valid
    const infrastructureResult = configManager.validateSection(config, 'infrastructure');
    expect(infrastructureResult.valid).toBe(true);

    // Reporting section should be invalid due to invalid URL
    const reportingResult = configManager.validateSection(config, 'reporting');
    expect(reportingResult.valid).toBe(false);
    expect(reportingResult.errors.some(e => e.path.includes('grafana.url'))).toBe(true);

    // Fixtures section should be valid
    const fixturesResult = configManager.validateSection(config, 'fixtures');
    expect(fixturesResult.valid).toBe(true);
  });

  it('should generate comprehensive error reports', async () => {
    const errors = [
      {
        path: 'infrastructure.services',
        message: 'Missing required service: prometheus',
        value: ['grafana']
      },
      {
        path: 'infrastructure.services',
        message: 'Port conflicts detected: 3000',
        value: [3000]
      },
      {
        path: 'reporting.grafana.url',
        message: 'Invalid URL format: not-a-url',
        value: 'not-a-url'
      },
      {
        path: 'fixtures.defaultSet',
        message: 'Default fixture set \'missing\' not found in fixtures.sets',
        value: 'missing'
      }
    ];

    const report = ConfigurationValidator.generateErrorReport(errors);

    // Should contain section headers
    expect(report).toContain('[INFRASTRUCTURE]');
    expect(report).toContain('[REPORTING]');
    expect(report).toContain('[FIXTURES]');

    // Should contain error messages
    expect(report).toContain('Missing required service: prometheus');
    expect(report).toContain('Port conflicts detected: 3000');
    expect(report).toContain('Invalid URL format: not-a-url');
    expect(report).toContain('Default fixture set');

    // Should contain suggestions
    expect(report).toContain('💡');
    expect(report).toContain('Add the missing service');
    expect(report).toContain('Ensure each service uses unique port numbers');
    expect(report).toContain('Ensure the URL includes protocol');
  });
});