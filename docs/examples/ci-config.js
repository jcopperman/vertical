/**
 * CI/CD Configuration
 * 
 * This configuration is optimized for continuous integration environments.
 * It uses headless operation, faster timeouts, and minimal resource usage.
 */

module.exports = {
  version: '1.0.0',
  profile: 'ci',
  
  infrastructure: {
    compose: {
      baseFile: 'docker-compose.yml',
      profileFiles: {
        local: 'docker-compose.local.yml',
        ci: 'docker-compose.ci.yml',
        k8s: 'docker-compose.k8s.yml'
      },
      projectName: 'otp-ci'
    },
    services: [
      {
        name: 'grafana',
        ports: [3000],
        healthCheck: {
          endpoint: '/api/health',
          timeout: 15000,  // Faster timeouts for CI
          retries: 3
        }
      },
      {
        name: 'prometheus',
        ports: [9090],
        healthCheck: {
          endpoint: '/-/healthy',
          timeout: 10000,
          retries: 2
        }
      },
      {
        name: 'loki',
        ports: [3100],
        healthCheck: {
          endpoint: '/ready',
          timeout: 10000,
          retries: 2
        }
      },
      {
        name: 'postgres',
        ports: [5432],
        healthCheck: {
          endpoint: '/health',
          timeout: 20000,
          retries: 3
        }
      },
      {
        name: 'api-service',
        ports: [8080],
        healthCheck: {
          endpoint: '/health',
          timeout: 15000,
          retries: 2
        },
        dependencies: ['postgres']
      }
    ],
    healthChecks: {
      timeout: 60000,   // Shorter timeout for CI
      retries: 3,
      interval: 3000
    }
  },
  
  runners: {
    api: {
      type: 'docker',
      image: 'node:18-alpine',
      command: ['npm', 'run', 'test:ci'],
      timeout: 180000,  // 3 minutes max for unit tests
      environment: {
        NODE_ENV: 'test',
        CI: 'true',
        API_URL: 'http://api-service:8080',
        DATABASE_URL: 'postgresql://test:test@postgres:5432/testdb'
      }
    },
    
    grpc: {
      type: 'docker',
      image: 'grpcurl/grpcurl:latest',
      command: ['grpcurl', '-plaintext', 'api-service:9090', 'list'],
      timeout: 60000,
      environment: {
        GRPC_ENDPOINT: 'api-service:9090'
      }
    },
    
    contract: {
      type: 'docker',
      image: 'pactfoundation/pact-cli:latest',
      command: [
        'pact-broker', 'can-i-deploy',
        '--pacticipant', 'api-service',
        '--version', '${BUILD_NUMBER}',
        '--to', 'production'
      ],
      timeout: 120000,
      environment: {
        PACT_BROKER_BASE_URL: 'https://pact-broker.example.com',
        PACT_BROKER_TOKEN: '${PACT_BROKER_TOKEN}'
      }
    },
    
    e2e: {
      type: 'docker',
      image: 'mcr.microsoft.com/playwright:v1.40.0-focal',
      command: ['npm', 'run', 'test:e2e:ci'],
      timeout: 600000,  // 10 minutes for E2E tests
      environment: {
        HEADLESS: 'true',
        CI: 'true',
        BASE_URL: 'http://api-service:8080',
        BROWSER: 'chromium',
        WORKERS: '2'
      }
    },
    
    perf: {
      type: 'docker',
      image: 'grafana/k6:latest',
      command: [
        'k6', 'run',
        '--vus', '10',
        '--duration', '1m',
        '--out', 'json=results.json',
        '/scripts/load-test.js'
      ],
      timeout: 180000,
      environment: {
        BASE_URL: 'http://api-service:8080',
        K6_PROMETHEUS_RW_SERVER_URL: 'http://prometheus:9090/api/v1/write'
      },
      volumes: [
        './performance:/scripts:ro'
      ]
    },
    
    chaos: {
      type: 'docker',
      image: 'chaostoolkit/chaostoolkit:latest',
      command: ['chaos', 'run', '--journal-path', '/results/journal.json', '/experiments/ci-experiment.json'],
      timeout: 300000,
      environment: {
        DOCKER_HOST: 'unix:///var/run/docker.sock',
        TARGET_SERVICE: 'api-service',
        CHAOS_LEVEL: 'low'
      },
      volumes: [
        '/var/run/docker.sock:/var/run/docker.sock:ro',
        './chaos:/experiments:ro',
        './test-results:/results'
      ]
    }
  },
  
  reporting: {
    grafana: {
      url: 'http://grafana:3000',
      auth: {
        type: 'token',
        token: '${GRAFANA_API_TOKEN}'
      },
      dashboards: [
        {
          name: 'CI Test Results',
          uid: 'ci-test-results',
          filters: {
            environment: 'ci',
            build: '${BUILD_NUMBER}'
          }
        },
        {
          name: 'Performance Trends',
          uid: 'performance-trends',
          filters: {
            branch: '${GIT_BRANCH}'
          }
        }
      ]
    },
    resultsApi: {
      url: 'http://api-service:8080/api/results',
      timeout: 15000,
      auth: {
        type: 'token',
        token: '${RESULTS_API_TOKEN}'
      }
    }
  },
  
  fixtures: {
    defaultSet: 'ci-minimal',
    sets: {
      'ci-minimal': {
        name: 'CI Minimal Dataset',
        description: 'Lightweight dataset optimized for CI speed',
        files: [
          'fixtures/ci/users-basic.json',
          'fixtures/ci/products-sample.json'
        ]
      },
      'ci-regression': {
        name: 'CI Regression Dataset',
        description: 'Comprehensive dataset for regression testing',
        files: [
          'fixtures/ci/users-full.json',
          'fixtures/ci/products-full.json',
          'fixtures/ci/orders-sample.json'
        ],
        dependencies: ['ci-minimal']
      }
    }
  }
};