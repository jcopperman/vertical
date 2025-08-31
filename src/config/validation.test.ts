/**
 * Unit tests for configuration validation utilities
 */

import { ConfigurationValidator, ConfigurationError } from './validation';
import { OTPConfig } from './types';

// Mock the logger
jest.mock('../utils/logger', () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }))
}));

describe('Configuration Validation', () => {
  const createValidConfig = (): OTPConfig => ({
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
          ports: [9090]
        },
        {
          name: 'postgres',
          ports: [5432]
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
          description: 'Minimal test data set',
          files: ['users.json']
        }
      }
    }
  });

  describe('ConfigurationValidator', () => {
    describe('validate', () => {
      it('should validate correct configuration', () => {
        const config = createValidConfig();
        const result = ConfigurationValidator.validate(config);
        
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should return validation errors for invalid configuration', () => {
        const invalidConfig = {
          version: '1.0.0',
          profile: 'invalid-profile',
          // Missing required fields
        };

        const result = ConfigurationValidator.validate(invalidConfig);
        
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toHaveProperty('path');
        expect(result.errors[0]).toHaveProperty('message');
      });

      it('should provide detailed error information', () => {
        const invalidConfig = {
          version: '1.0.0',
          profile: 'local',
          infrastructure: {
            compose: {
              baseFile: 'docker-compose.yml',
              profileFiles: {
                // Missing required profile files
              },
              projectName: 'test'
            },
            services: [], // Empty services array
            healthChecks: {
              timeout: -1, // Invalid negative timeout
              retries: 5,
              interval: 5
            }
          }
        };

        const result = ConfigurationValidator.validate(invalidConfig);
        
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Check that error paths are properly formatted
        const errorPaths = result.errors.map(e => e.path);
        expect(errorPaths.some(path => path.includes('infrastructure'))).toBe(true);
      });
    });

    describe('validateSection', () => {
      it('should validate specific configuration sections', () => {
        const config = createValidConfig();
        
        const infrastructureResult = ConfigurationValidator.validateSection(config, 'infrastructure');
        expect(infrastructureResult.valid).toBe(true);
        
        const reportingResult = ConfigurationValidator.validateSection(config, 'reporting');
        expect(reportingResult.valid).toBe(true);
      });

      it('should return error for missing section', () => {
        const config = { version: '1.0.0' };
        
        const result = ConfigurationValidator.validateSection(config, 'infrastructure');
        
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].path).toBe('infrastructure');
        expect(result.errors[0].message).toContain('missing');
      });

      it('should filter errors for specific section', () => {
        const config = createValidConfig();
        config.reporting.grafana.url = 'invalid-url'; // Make reporting section invalid
        
        const reportingResult = ConfigurationValidator.validateSection(config, 'reporting');
        
        expect(reportingResult.valid).toBe(false);
        expect(reportingResult.errors.every(e => e.path.startsWith('reporting'))).toBe(true);
      });
    });

    describe('checkCommonIssues', () => {
      it('should detect missing required services', () => {
        const config = createValidConfig();
        config.infrastructure.services = [
          { name: 'grafana', ports: [3000] }
          // Missing prometheus and postgres
        ];

        const issues = ConfigurationValidator.checkCommonIssues(config);
        
        expect(issues.length).toBeGreaterThan(0);
        expect(issues.some(issue => issue.message.includes('prometheus'))).toBe(true);
        expect(issues.some(issue => issue.message.includes('postgres'))).toBe(true);
      });

      it('should detect port conflicts', () => {
        const config = createValidConfig();
        config.infrastructure.services = [
          { name: 'service1', ports: [3000] },
          { name: 'service2', ports: [3000] } // Conflicting port
        ];

        const issues = ConfigurationValidator.checkCommonIssues(config);
        
        expect(issues.some(issue => issue.message.includes('Port conflicts'))).toBe(true);
        expect(issues.some(issue => issue.message.includes('3000'))).toBe(true);
      });

      it('should detect invalid URLs', () => {
        const config = createValidConfig();
        config.reporting.grafana.url = 'not-a-url';
        config.reporting.resultsApi.url = 'also-not-a-url';

        const issues = ConfigurationValidator.checkCommonIssues(config);
        
        expect(issues.some(issue => 
          issue.path === 'reporting.grafana.url' && issue.message.includes('Invalid URL')
        )).toBe(true);
        expect(issues.some(issue => 
          issue.path === 'reporting.resultsApi.url' && issue.message.includes('Invalid URL')
        )).toBe(true);
      });

      it('should detect missing default fixture set', () => {
        const config = createValidConfig();
        config.fixtures.defaultSet = 'nonexistent';

        const issues = ConfigurationValidator.checkCommonIssues(config);
        
        expect(issues.some(issue => 
          issue.path === 'fixtures.defaultSet' && issue.message.includes('not found')
        )).toBe(true);
      });

      it('should detect circular fixture dependencies', () => {
        const config = createValidConfig();
        config.fixtures.sets = {
          setA: {
            name: 'Set A',
            description: 'Test set A',
            files: ['a.json'],
            dependencies: ['setB']
          },
          setB: {
            name: 'Set B',
            description: 'Test set B',
            files: ['b.json'],
            dependencies: ['setC']
          },
          setC: {
            name: 'Set C',
            description: 'Test set C',
            files: ['c.json'],
            dependencies: ['setA'] // Creates circular dependency
          }
        };

        const issues = ConfigurationValidator.checkCommonIssues(config);
        
        expect(issues.some(issue => 
          issue.message.includes('Circular dependencies')
        )).toBe(true);
      });

      it('should return no issues for valid configuration', () => {
        const config = createValidConfig();
        
        const issues = ConfigurationValidator.checkCommonIssues(config);
        
        expect(issues).toHaveLength(0);
      });
    });

    describe('generateErrorReport', () => {
      it('should generate user-friendly error report', () => {
        const errors = [
          {
            path: 'infrastructure.services',
            message: 'Missing required service: prometheus',
            value: ['grafana']
          },
          {
            path: 'reporting.grafana.url',
            message: 'Invalid URL format: not-a-url',
            value: 'not-a-url'
          }
        ];

        const report = ConfigurationValidator.generateErrorReport(errors);
        
        expect(report).toContain('[INFRASTRUCTURE]');
        expect(report).toContain('[REPORTING]');
        expect(report).toContain('Missing required service: prometheus');
        expect(report).toContain('Invalid URL format: not-a-url');
        expect(report).toContain('💡'); // Should contain suggestions
      });

      it('should return success message for no errors', () => {
        const report = ConfigurationValidator.generateErrorReport([]);
        
        expect(report).toBe('Configuration is valid.');
      });

      it('should group errors by section', () => {
        const errors = [
          { path: 'infrastructure.compose.projectName', message: 'Required field is missing', value: undefined },
          { path: 'infrastructure.services', message: 'Must contain at least 1 item(s)', value: [] },
          { path: 'reporting.grafana.url', message: 'Must be a valid URL', value: 'invalid' }
        ];

        const report = ConfigurationValidator.generateErrorReport(errors);
        
        expect(report).toContain('[INFRASTRUCTURE]');
        expect(report).toContain('[REPORTING]');
        
        // Infrastructure section should have 2 errors
        const infrastructureSection = report.split('[REPORTING]')[0];
        const infrastructureErrors = (infrastructureSection.match(/✗/g) || []).length;
        expect(infrastructureErrors).toBe(2);
      });
    });
  });

  describe('ConfigurationError', () => {
    it('should create error with validation details', () => {
      const errors = [
        {
          path: 'infrastructure.services',
          message: 'Missing required service: prometheus',
          value: ['grafana']
        }
      ];

      const configError = new ConfigurationError(
        'Configuration validation failed',
        errors,
        '/path/to/config.js'
      );

      expect(configError.message).toBe('Configuration validation failed');
      expect(configError.errors).toEqual(errors);
      expect(configError.configPath).toBe('/path/to/config.js');
      expect(configError.name).toBe('ConfigurationError');
    });

    it('should generate formatted error report', () => {
      const errors = [
        {
          path: 'infrastructure.services',
          message: 'Missing required service: prometheus',
          value: ['grafana']
        }
      ];

      const configError = new ConfigurationError('Test error', errors);
      const report = configError.getReport();

      expect(report).toContain('[INFRASTRUCTURE]');
      expect(report).toContain('Missing required service: prometheus');
    });

    it('should provide error summary', () => {
      const errors = [
        { path: 'infrastructure.services', message: 'Error 1', value: null },
        { path: 'infrastructure.compose.projectName', message: 'Error 2', value: null },
        { path: 'reporting.grafana.url', message: 'Error 3', value: null }
      ];

      const configError = new ConfigurationError('Test error', errors);
      const summary = configError.getErrorSummary();

      expect(summary.total).toBe(3);
      expect(summary.bySection.infrastructure).toBe(2);
      expect(summary.bySection.reporting).toBe(1);
    });
  });
});