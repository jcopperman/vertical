/**
 * Unit tests for configuration type definitions and schemas
 */

import {
  otpConfigSchema,
  profileSchema,
  serviceDefinitionSchema,
  healthCheckConfigSchema,
  composeConfigSchema,
  runnerDefinitionSchema,
  grafanaConfigSchema,
  fixtureConfigSchema
} from './schema';
import { OTPConfig, ProfileType } from './types';

describe('Configuration Schema Validation', () => {
  describe('Profile Schema', () => {
    it('should accept valid profile types', () => {
      const validProfiles: ProfileType[] = ['local', 'ci', 'k8s'];
      
      validProfiles.forEach(profile => {
        const { error } = profileSchema.validate(profile);
        expect(error).toBeUndefined();
      });
    });

    it('should reject invalid profile types', () => {
      const invalidProfiles = ['invalid', 'production', ''];
      
      invalidProfiles.forEach(profile => {
        const { error } = profileSchema.validate(profile);
        expect(error).toBeDefined();
      });
    });
  });

  describe('Service Definition Schema', () => {
    it('should validate a complete service definition', () => {
      const validService = {
        name: 'grafana',
        ports: [3000],
        healthCheck: {
          endpoint: '/api/health',
          timeout: 30,
          retries: 3
        },
        dependencies: ['postgres']
      };

      const { error } = serviceDefinitionSchema.validate(validService);
      expect(error).toBeUndefined();
    });

    it('should validate a minimal service definition', () => {
      const minimalService = {
        name: 'postgres',
        ports: [5432]
      };

      const { error } = serviceDefinitionSchema.validate(minimalService);
      expect(error).toBeUndefined();
    });

    it('should reject service with invalid ports', () => {
      const invalidService = {
        name: 'test',
        ports: [70000] // Invalid port number
      };

      const { error } = serviceDefinitionSchema.validate(invalidService);
      expect(error).toBeDefined();
    });

    it('should reject service without required fields', () => {
      const incompleteService = {
        ports: [3000]
        // Missing name
      };

      const { error } = serviceDefinitionSchema.validate(incompleteService);
      expect(error).toBeDefined();
    });
  });

  describe('Health Check Configuration Schema', () => {
    it('should validate health check config with defaults', () => {
      const { error, value } = healthCheckConfigSchema.validate({});
      
      expect(error).toBeUndefined();
      expect(value.timeout).toBe(60);
      expect(value.retries).toBe(5);
      expect(value.interval).toBe(5);
    });

    it('should validate custom health check config', () => {
      const customConfig = {
        timeout: 120,
        retries: 10,
        interval: 2
      };

      const { error } = healthCheckConfigSchema.validate(customConfig);
      expect(error).toBeUndefined();
    });

    it('should reject negative values', () => {
      const invalidConfig = {
        timeout: -1,
        retries: -1,
        interval: -1
      };

      const { error } = healthCheckConfigSchema.validate(invalidConfig);
      expect(error).toBeDefined();
    });
  });

  describe('Compose Configuration Schema', () => {
    it('should validate complete compose config', () => {
      const validConfig = {
        baseFile: 'docker-compose.yml',
        profileFiles: {
          local: 'docker-compose.local.yml',
          ci: 'docker-compose.ci.yml',
          k8s: 'docker-compose.k8s.yml'
        },
        projectName: 'otp'
      };

      const { error } = composeConfigSchema.validate(validConfig);
      expect(error).toBeUndefined();
    });

    it('should reject config missing profile files', () => {
      const invalidConfig = {
        baseFile: 'docker-compose.yml',
        profileFiles: {
          local: 'docker-compose.local.yml'
          // Missing ci and k8s
        },
        projectName: 'otp'
      };

      const { error } = composeConfigSchema.validate(invalidConfig);
      expect(error).toBeDefined();
    });
  });

  describe('Runner Definition Schema', () => {
    it('should validate docker runner', () => {
      const dockerRunner = {
        type: 'docker',
        image: 'node:18-alpine',
        command: ['npm', 'test'],
        environment: {
          NODE_ENV: 'test'
        },
        timeout: 300
      };

      const { error } = runnerDefinitionSchema.validate(dockerRunner);
      expect(error).toBeUndefined();
    });

    it('should validate local runner without image', () => {
      const localRunner = {
        type: 'local',
        command: ['npm', 'test'],
        timeout: 300
      };

      const { error } = runnerDefinitionSchema.validate(localRunner);
      expect(error).toBeUndefined();
    });

    it('should require image for docker runners', () => {
      const invalidRunner = {
        type: 'docker',
        command: ['npm', 'test']
        // Missing required image
      };

      const { error } = runnerDefinitionSchema.validate(invalidRunner);
      expect(error).toBeDefined();
    });

    it('should apply default timeout', () => {
      const runner = {
        type: 'local',
        command: ['npm', 'test']
      };

      const { error, value } = runnerDefinitionSchema.validate(runner);
      expect(error).toBeUndefined();
      expect(value.timeout).toBe(300);
    });
  });

  describe('Grafana Configuration Schema', () => {
    it('should validate grafana config with auth', () => {
      const grafanaConfig = {
        url: 'http://localhost:3000',
        auth: {
          type: 'basic',
          username: 'admin',
          password: 'admin'
        },
        dashboards: [
          {
            name: 'Test Results',
            uid: 'test-results',
            filters: {
              suite: 'api'
            }
          }
        ]
      };

      const { error } = grafanaConfigSchema.validate(grafanaConfig);
      expect(error).toBeUndefined();
    });

    it('should validate grafana config without auth', () => {
      const grafanaConfig = {
        url: 'http://localhost:3000',
        dashboards: [
          {
            name: 'Test Results',
            uid: 'test-results'
          }
        ]
      };

      const { error } = grafanaConfigSchema.validate(grafanaConfig);
      expect(error).toBeUndefined();
    });

    it('should reject invalid URL', () => {
      const invalidConfig = {
        url: 'not-a-url',
        dashboards: []
      };

      const { error } = grafanaConfigSchema.validate(invalidConfig);
      expect(error).toBeDefined();
    });
  });

  describe('Fixture Configuration Schema', () => {
    it('should validate complete fixture config', () => {
      const fixtureConfig = {
        defaultSet: 'basic',
        sets: {
          basic: {
            name: 'Basic Test Data',
            description: 'Minimal test data set',
            files: ['users.json', 'products.json']
          },
          extended: {
            name: 'Extended Test Data',
            description: 'Full test data set',
            files: ['users.json', 'products.json', 'orders.json'],
            dependencies: ['basic']
          }
        }
      };

      const { error } = fixtureConfigSchema.validate(fixtureConfig);
      expect(error).toBeUndefined();
    });

    it('should reject empty fixture sets', () => {
      const invalidConfig = {
        defaultSet: 'basic',
        sets: {}
      };

      const { error } = fixtureConfigSchema.validate(invalidConfig);
      expect(error).toBeDefined();
    });
  });

  describe('Complete OTP Configuration Schema', () => {
    const createValidConfig = (profile: ProfileType = 'local'): OTPConfig => ({
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

    it('should validate complete local configuration', () => {
      const config = createValidConfig('local');
      const { error } = otpConfigSchema.validate(config);
      expect(error).toBeUndefined();
    });

    it('should validate complete k8s configuration with helm', () => {
      const config = createValidConfig('k8s');
      config.infrastructure.helm = {
        chart: 'otp/infrastructure',
        namespace: 'otp-system',
        values: {
          grafana: {
            enabled: true
          }
        }
      };

      const { error } = otpConfigSchema.validate(config);
      expect(error).toBeUndefined();
    });

    it('should reject configuration missing required fields', () => {
      const incompleteConfig = {
        version: '1.0.0',
        profile: 'local'
        // Missing other required fields
      };

      const { error } = otpConfigSchema.validate(incompleteConfig);
      expect(error).toBeDefined();
    });

    it('should provide detailed error messages for validation failures', () => {
      const invalidConfig = {
        version: '1.0.0',
        profile: 'invalid-profile',
        infrastructure: {
          // Missing required fields
        }
      };

      const { error } = otpConfigSchema.validate(invalidConfig);
      expect(error).toBeDefined();
      expect(error?.details).toBeDefined();
      expect(error?.details.length).toBeGreaterThan(0);
    });
  });
});