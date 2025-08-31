/**
 * Local Development Configuration
 * 
 * This configuration is optimized for local development with Docker Compose.
 * Services run on localhost with standard ports and include development tools.
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
      projectName: 'otp-local'
    },
    services: [
      {
        name: 'grafana',
        ports: [3000],
        healthCheck: {
          endpoint: '/api/health',
          timeout: 30000,
          retries: 5
        }
      },
      {
        name: 'prometheus',
        ports: [9090],
        healthCheck: {
          endpoint: '/-/healthy',
          timeout: 15000,
          retries: 3
        }
      },
      {
        name: 'loki',
        ports: [3100],
        healthCheck: {
          endpoint: '/ready',
          timeout: 20000,
          retries: 3
        }
      },
      {
        name: 'tempo',
        ports: [3200, 14268],
        healthCheck: {
          endpoint: '/ready',
          timeout: 20000,
          retries: 3
        }
      },
      {
        name: 'postgres',
        ports: [5432],
        healthCheck: {
          endpoint: '/health',
          timeout: 30000,
          retries: 5
        }
      },
      {
        name: 'minio',
        ports: [9000, 9001],
        healthCheck: {
          endpoint: '/minio/health/live',
          timeout: 15000,
          retries: 3
        }
      },
      {
        name: 'api-service',
        ports: [8080],
        healthCheck: {
          endpoint: '/health',
          timeout: 30000,
          retries: 3
        },
        dependencies: ['postgres', 'minio']
      }
    ],
    healthChecks: {
      timeout: 120000,  // 2 minutes for local startup
      retries: 5,
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
        API_URL: 'http://localhost:8080',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/testdb'
      },
      volumes: [
        './tests:/app/tests:ro',
        './coverage:/app/coverage'
      ]
    },
    
    grpc: {
      type: 'docker',
      image: 'grpcurl/grpcurl:latest',
      command: ['grpcurl', '-plaintext', 'localhost:9090', 'list'],
      timeout: 120000,
      environment: {
        GRPC_ENDPOINT: 'localhost:9090'
      }
    },
    
    contract: {
      type: 'docker',
      image: 'pactfoundation/pact-cli:latest',
      command: ['pact-broker', 'can-i-deploy', '--pacticipant', 'api-service'],
      timeout: 180000,
      environment: {
        PACT_BROKER_BASE_URL: 'http://localhost:9292',
        PACT_BROKER_USERNAME: 'admin',
        PACT_BROKER_PASSWORD: 'admin'
      }
    },
    
    e2e: {
      type: 'local',
      command: ['npm', 'run', 'test:e2e'],
      timeout: 900000,
      environment: {
        HEADLESS: 'false',  // Show browser in local development
        BASE_URL: 'http://localhost:8080',
        SCREENSHOT_PATH: './test-results/screenshots'
      }
    },
    
    perf: {
      type: 'local',
      command: ['k6', 'run', '--vus', '5', '--duration', '2m', 'performance/load-test.js'],
      timeout: 300000,
      environment: {
        BASE_URL: 'http://localhost:8080',
        RESULTS_OUTPUT: './test-results/performance'
      }
    },
    
    chaos: {
      type: 'docker',
      image: 'chaostoolkit/chaostoolkit:latest',
      command: ['chaos', 'run', 'chaos/experiment.json'],
      timeout: 600000,
      environment: {
        DOCKER_HOST: 'unix:///var/run/docker.sock',
        TARGET_SERVICE: 'api-service'
      },
      volumes: [
        '/var/run/docker.sock:/var/run/docker.sock:ro',
        './chaos:/app/chaos:ro'
      ]
    }
  },
  
  reporting: {
    grafana: {
      url: 'http://localhost:3000',
      auth: {
        type: 'basic',
        username: 'admin',
        password: 'admin'
      },
      dashboards: [
        {
          name: 'Test Results Overview',
          uid: 'test-results-overview',
          filters: {
            environment: 'local'
          }
        },
        {
          name: 'API Performance',
          uid: 'api-performance',
          filters: {
            service: 'api-service'
          }
        },
        {
          name: 'Infrastructure Health',
          uid: 'infrastructure-health'
        }
      ]
    },
    resultsApi: {
      url: 'http://localhost:8080/api/results',
      timeout: 30000,
      auth: {
        type: 'token',
        token: 'dev-token-123'
      }
    }
  },
  
  fixtures: {
    defaultSet: 'development',
    sets: {
      minimal: {
        name: 'Minimal Test Data',
        description: 'Bare minimum data for smoke tests',
        files: [
          'fixtures/users-minimal.json',
          'fixtures/products-minimal.json'
        ]
      },
      development: {
        name: 'Development Dataset',
        description: 'Rich dataset for local development and testing',
        files: [
          'fixtures/users.json',
          'fixtures/products.json',
          'fixtures/orders.json',
          'fixtures/reviews.json'
        ],
        dependencies: ['minimal']
      },
      performance: {
        name: 'Performance Test Data',
        description: 'Large dataset for performance and load testing',
        files: [
          'fixtures/users-large.json',
          'fixtures/products-large.json',
          'fixtures/orders-large.json'
        ],
        dependencies: ['development']
      }
    }
  }
};