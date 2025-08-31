/**
 * Kubernetes Configuration
 * 
 * This configuration is designed for Kubernetes deployments using Helm charts.
 * It includes namespace isolation, resource limits, and production-ready settings.
 */

module.exports = {
  version: '1.0.0',
  profile: 'k8s',
  
  infrastructure: {
    compose: {
      baseFile: 'docker-compose.yml',
      profileFiles: {
        local: 'docker-compose.local.yml',
        ci: 'docker-compose.ci.yml',
        k8s: 'docker-compose.k8s.yml'
      },
      projectName: 'otp-k8s'
    },
    helm: {
      chart: './helm/otp-platform',
      namespace: 'otp-testing',
      values: {
        global: {
          imageRegistry: 'registry.example.com',
          imagePullSecrets: ['regcred']
        },
        grafana: {
          enabled: true,
          persistence: {
            enabled: true,
            size: '10Gi'
          },
          ingress: {
            enabled: true,
            hostname: 'grafana-otp.example.com'
          }
        },
        prometheus: {
          enabled: true,
          retention: '30d',
          resources: {
            requests: {
              memory: '512Mi',
              cpu: '250m'
            },
            limits: {
              memory: '2Gi',
              cpu: '1000m'
            }
          }
        },
        loki: {
          enabled: true,
          persistence: {
            enabled: true,
            size: '50Gi'
          }
        },
        tempo: {
          enabled: true,
          persistence: {
            enabled: true,
            size: '20Gi'
          }
        },
        postgresql: {
          enabled: true,
          auth: {
            existingSecret: 'postgres-credentials'
          },
          primary: {
            persistence: {
              enabled: true,
              size: '20Gi'
            }
          }
        },
        minio: {
          enabled: true,
          auth: {
            existingSecret: 'minio-credentials'
          },
          persistence: {
            enabled: true,
            size: '100Gi'
          }
        }
      }
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
          timeout: 20000,
          retries: 3
        }
      },
      {
        name: 'loki',
        ports: [3100],
        healthCheck: {
          endpoint: '/ready',
          timeout: 25000,
          retries: 3
        }
      },
      {
        name: 'tempo',
        ports: [3200],
        healthCheck: {
          endpoint: '/ready',
          timeout: 25000,
          retries: 3
        }
      },
      {
        name: 'postgresql',
        ports: [5432],
        healthCheck: {
          endpoint: '/health',
          timeout: 45000,
          retries: 5
        }
      },
      {
        name: 'minio',
        ports: [9000],
        healthCheck: {
          endpoint: '/minio/health/live',
          timeout: 20000,
          retries: 3
        }
      }
    ],
    healthChecks: {
      timeout: 300000,  // 5 minutes for K8s startup
      retries: 10,
      interval: 10000
    }
  },
  
  runners: {
    api: {
      type: 'k8s',
      image: 'registry.example.com/api-tests:latest',
      command: ['npm', 'run', 'test:api'],
      timeout: 600000,
      environment: {
        NODE_ENV: 'test',
        KUBERNETES: 'true',
        API_URL: 'http://api-service.otp-testing.svc.cluster.local:8080',
        DATABASE_URL: 'postgresql://test:${DB_PASSWORD}@postgresql.otp-testing.svc.cluster.local:5432/testdb'
      }
    },
    
    grpc: {
      type: 'k8s',
      image: 'registry.example.com/grpc-tests:latest',
      command: ['grpcurl', '-plaintext', 'api-service.otp-testing.svc.cluster.local:9090', 'list'],
      timeout: 180000,
      environment: {
        GRPC_ENDPOINT: 'api-service.otp-testing.svc.cluster.local:9090'
      }
    },
    
    contract: {
      type: 'k8s',
      image: 'pactfoundation/pact-cli:latest',
      command: [
        'pact-broker', 'can-i-deploy',
        '--pacticipant', 'api-service',
        '--version', '${IMAGE_TAG}',
        '--to-environment', 'staging'
      ],
      timeout: 300000,
      environment: {
        PACT_BROKER_BASE_URL: 'https://pact-broker.example.com',
        PACT_BROKER_TOKEN: '${PACT_BROKER_TOKEN}'
      }
    },
    
    e2e: {
      type: 'k8s',
      image: 'registry.example.com/e2e-tests:latest',
      command: ['npm', 'run', 'test:e2e:k8s'],
      timeout: 1800000,  // 30 minutes for comprehensive E2E
      environment: {
        HEADLESS: 'true',
        KUBERNETES: 'true',
        BASE_URL: 'https://api-otp.example.com',
        BROWSER: 'chromium',
        WORKERS: '4',
        SCREENSHOT_PATH: '/results/screenshots'
      }
    },
    
    perf: {
      type: 'k8s',
      image: 'grafana/k6:latest',
      command: [
        'k6', 'run',
        '--vus', '50',
        '--duration', '10m',
        '--out', 'prometheus=http://prometheus.otp-testing.svc.cluster.local:9090/api/v1/write',
        '/scripts/load-test.js'
      ],
      timeout: 900000,  // 15 minutes
      environment: {
        BASE_URL: 'https://api-otp.example.com',
        K6_PROMETHEUS_RW_SERVER_URL: 'http://prometheus.otp-testing.svc.cluster.local:9090/api/v1/write',
        TEST_ENVIRONMENT: 'staging'
      }
    },
    
    chaos: {
      type: 'k8s',
      image: 'chaostoolkit/chaostoolkit:latest',
      command: [
        'chaos', 'run',
        '--journal-path', '/results/chaos-journal.json',
        '/experiments/k8s-experiment.json'
      ],
      timeout: 1200000,  // 20 minutes
      environment: {
        KUBERNETES_NAMESPACE: 'otp-testing',
        TARGET_DEPLOYMENT: 'api-service',
        CHAOS_LEVEL: 'medium',
        KUBECONFIG: '/etc/kubeconfig/config'
      }
    }
  },
  
  reporting: {
    grafana: {
      url: 'https://grafana-otp.example.com',
      auth: {
        type: 'token',
        token: '${GRAFANA_API_TOKEN}'
      },
      dashboards: [
        {
          name: 'Production Test Results',
          uid: 'prod-test-results',
          filters: {
            environment: 'staging',
            namespace: 'otp-testing'
          }
        },
        {
          name: 'Kubernetes Cluster Health',
          uid: 'k8s-cluster-health',
          filters: {
            cluster: 'staging'
          }
        },
        {
          name: 'Application Performance',
          uid: 'app-performance',
          filters: {
            deployment: 'api-service'
          }
        }
      ]
    },
    resultsApi: {
      url: 'https://results-api-otp.example.com/api/results',
      timeout: 45000,
      auth: {
        type: 'oauth',
        token: '${OAUTH_ACCESS_TOKEN}'
      }
    }
  },
  
  fixtures: {
    defaultSet: 'staging',
    sets: {
      staging: {
        name: 'Staging Environment Data',
        description: 'Production-like dataset for staging environment',
        files: [
          'fixtures/k8s/users-staging.json',
          'fixtures/k8s/products-staging.json',
          'fixtures/k8s/orders-staging.json',
          'fixtures/k8s/permissions-staging.json'
        ]
      },
      'load-test': {
        name: 'Load Test Dataset',
        description: 'Large dataset optimized for performance testing',
        files: [
          'fixtures/k8s/users-large.json',
          'fixtures/k8s/products-large.json',
          'fixtures/k8s/orders-large.json'
        ],
        dependencies: ['staging']
      },
      'chaos-test': {
        name: 'Chaos Engineering Dataset',
        description: 'Resilient dataset for chaos engineering experiments',
        files: [
          'fixtures/k8s/users-resilient.json',
          'fixtures/k8s/products-resilient.json'
        ]
      }
    }
  }
};