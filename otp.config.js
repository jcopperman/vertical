/**
 * OTP CLI Configuration
 * This is a sample configuration file for the Outeniqua Test Platform CLI
 */

module.exports = {
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
      projectName: 'otp-demo'
    },
    services: [
      {
        name: 'api',
        ports: [3000],
        healthCheck: {
          endpoint: '/health',
          timeout: 30000,
          retries: 3
        }
      },
      {
        name: 'database',
        ports: [5432],
        dependencies: []
      }
    ],
    healthChecks: {
      timeout: 30000,
      retries: 3,
      interval: 5000
    }
  },
  
  runners: {
    api: {
      type: 'docker',
      image: 'node:18-alpine',
      command: ['npm', 'test'],
      timeout: 300000,
      environment: {
        NODE_ENV: 'test',
        API_URL: 'http://localhost:3000'
      }
    },
    e2e: {
      type: 'local',
      command: ['npm', 'run', 'test:e2e'],
      timeout: 600000,
      environment: {
        HEADLESS: 'true',
        BASE_URL: 'http://localhost:3000'
      }
    },
    contract: {
      type: 'docker',
      image: 'pactfoundation/pact-cli',
      command: ['pact-broker', 'can-i-deploy'],
      timeout: 120000,
      environment: {
        PACT_BROKER_BASE_URL: 'http://localhost:9292'
      }
    },
    perf: {
      type: 'local',
      command: ['k6', 'run', 'performance/load-test.js'],
      timeout: 900000,
      environment: {
        VUS: '10',
        DURATION: '5m'
      }
    }
  },
  
  reporting: {
    grafana: {
      url: 'http://localhost:3000',
      dashboards: [
        {
          name: 'Test Results',
          uid: 'test-results',
          filters: {
            suite: 'api'
          }
        }
      ]
    },
    resultsApi: {
      url: 'http://localhost:8080/api/results',
      timeout: 30000
    }
  },
  
  fixtures: {
    defaultSet: 'basic',
    sets: {
      basic: {
        name: 'Basic Test Data',
        description: 'Minimal test data for smoke tests',
        files: ['fixtures/users.json', 'fixtures/products.json']
      },
      full: {
        name: 'Full Test Dataset',
        description: 'Complete test data for regression testing',
        files: ['fixtures/users.json', 'fixtures/products.json', 'fixtures/orders.json'],
        dependencies: ['basic']
      }
    }
  }
};