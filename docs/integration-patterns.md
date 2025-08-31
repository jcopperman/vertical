# Integration Patterns and Best Practices

This guide covers common integration patterns, workflows, and best practices for using the OTP CLI effectively in different environments and scenarios.

## Development Workflows

### Local Development Setup

**Initial Setup:**
```bash
# Clone project and setup configuration
git clone <project-repo>
cd <project>
cp otp.config.example.js otp.config.js

# Start infrastructure
otp up --profile local

# Load development data
otp seed --fixture-set development

# Verify setup
otp status --verbose
```

**Daily Development Workflow:**
```bash
# Quick health check
otp status

# Run relevant tests during development
otp run api --tags "unit,integration"

# Check specific service logs when debugging
otp logs api --follow

# Reset data when needed
otp seed reset --fixture-set development
```

**End of Day Cleanup:**
```bash
# Stop services but preserve data
otp down

# Or clean shutdown for fresh start tomorrow
otp down --clean
```

### Feature Development Pattern

```bash
# Start feature branch
git checkout -b feature/new-api-endpoint

# Ensure clean environment
otp down --clean
otp up --build

# Load minimal test data
otp seed --fixture-set minimal

# Run tests continuously during development
otp run api --tags "!slow" --watch  # If watch mode available

# Before committing, run full test suite
otp run api
otp run contract --dry-run  # Check contract compatibility

# Generate coverage report
otp report generate --format html --output coverage.html
```

## CI/CD Integration

### GitHub Actions Integration

```yaml
name: OTP Test Pipeline
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Setup OTP CLI
        run: |
          npm install -g @otp/cli
          export OTP_PROFILE=ci
          
      - name: Start infrastructure
        run: |
          otp up --profile ci --timeout 300
          otp status --refresh
          
      - name: Load test data
        run: otp seed --fixture-set ci-minimal
        
      - name: Run test suites
        run: |
          otp run api --target ci --tags "smoke,regression"
          otp run contract --target ci
          
      - name: Generate reports
        if: always()
        run: |
          otp report generate --format json --output test-results.json
          otp logs all --since 1h > service-logs.txt
          
      - name: Upload artifacts
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: |
            test-results.json
            service-logs.txt
            
      - name: Cleanup
        if: always()
        run: otp down --timeout 60
```

### Jenkins Pipeline Integration

```groovy
pipeline {
    agent any
    
    environment {
        OTP_PROFILE = 'ci'
        OTP_VERBOSE = 'true'
    }
    
    stages {
        stage('Setup') {
            steps {
                sh 'npm install -g @otp/cli'
                sh 'otp version'
            }
        }
        
        stage('Infrastructure') {
            steps {
                sh 'otp up --profile ci --timeout 300'
                sh 'otp status --refresh'
            }
        }
        
        stage('Test Data') {
            steps {
                sh 'otp seed --fixture-set ci-regression'
            }
        }
        
        stage('API Tests') {
            steps {
                sh 'otp run api --target ci --tags "smoke,regression"'
            }
            post {
                always {
                    publishTestResults testResultsPattern: 'test-results/api/*.xml'
                }
            }
        }
        
        stage('Contract Tests') {
            steps {
                sh 'otp run contract --target ci'
            }
        }
        
        stage('E2E Tests') {
            when {
                anyOf {
                    branch 'main'
                    branch 'develop'
                }
            }
            steps {
                sh 'otp run e2e --target ci --tags "critical"'
            }
        }
        
        stage('Performance Tests') {
            when {
                branch 'main'
            }
            steps {
                sh 'otp run perf --target ci --timeout 900'
            }
        }
    }
    
    post {
        always {
            sh 'otp report generate --format json --output pipeline-results.json'
            sh 'otp logs all --since 2h > pipeline-logs.txt'
            archiveArtifacts artifacts: 'pipeline-results.json,pipeline-logs.txt'
            sh 'otp down --timeout 60'
        }
        
        failure {
            sh 'otp logs all --filter "ERROR|FATAL" > error-logs.txt'
            archiveArtifacts artifacts: 'error-logs.txt'
        }
    }
}
```

### GitLab CI Integration

```yaml
stages:
  - setup
  - test
  - report
  - cleanup

variables:
  OTP_PROFILE: "ci"
  OTP_VERBOSE: "true"

before_script:
  - npm install -g @otp/cli

setup:
  stage: setup
  script:
    - otp up --profile ci --timeout 300
    - otp status --refresh
    - otp seed --fixture-set ci-minimal
  artifacts:
    reports:
      dotenv: otp.env

api-tests:
  stage: test
  script:
    - otp run api --target ci --tags "smoke,regression"
  artifacts:
    reports:
      junit: test-results/api/junit.xml
    paths:
      - test-results/

contract-tests:
  stage: test
  script:
    - otp run contract --target ci
  artifacts:
    reports:
      junit: test-results/contract/junit.xml

e2e-tests:
  stage: test
  script:
    - otp run e2e --target ci --tags "critical"
  artifacts:
    reports:
      junit: test-results/e2e/junit.xml
  only:
    - main
    - develop

generate-report:
  stage: report
  script:
    - otp report generate --format html --output test-report.html
  artifacts:
    paths:
      - test-report.html
    expire_in: 1 week

cleanup:
  stage: cleanup
  script:
    - otp down --timeout 60
  when: always
```

## Kubernetes Deployment Patterns

### Staging Environment Setup

```bash
# Configure kubectl context
kubectl config use-context staging-cluster

# Setup OTP for Kubernetes
export OTP_PROFILE=k8s
export OTP_KUBERNETES_NAMESPACE=otp-staging

# Deploy infrastructure using Helm
otp up --profile k8s --timeout 600

# Wait for all pods to be ready
otp status --refresh --timeout 300

# Load staging data
otp seed --fixture-set staging --target staging

# Run comprehensive test suite
otp run api --target staging
otp run e2e --target staging --tags "regression"
otp run perf --target staging --timeout 1200
```

### Production Monitoring Setup

```bash
# Production-safe configuration
export OTP_PROFILE=k8s
export OTP_KUBERNETES_NAMESPACE=otp-prod
export OTP_READ_ONLY=true  # Prevent destructive operations

# Health monitoring
otp status --service grafana --verbose
otp status --service prometheus --verbose

# View production metrics
otp report open --dashboard production-health

# Safe log viewing (read-only)
otp logs grafana --tail 100 --filter "ERROR|WARN"
```

## Testing Strategies

### Test Pyramid Implementation

```bash
# Unit Tests (Fast, Run Frequently)
otp run api --tags "unit" --timeout 60

# Integration Tests (Medium Speed)
otp run api --tags "integration" --timeout 180

# Contract Tests (API Compatibility)
otp run contract --timeout 120

# E2E Tests (Slow, Run Less Frequently)
otp run e2e --tags "smoke" --timeout 300

# Performance Tests (Resource Intensive)
otp run perf --timeout 900 --env VUS=10 --env DURATION=5m

# Chaos Engineering (Stability Testing)
otp run chaos --timeout 600 --env CHAOS_LEVEL=low
```

### Environment-Specific Testing

```bash
# Local Development (Fast Feedback)
otp run api --target local --tags "unit,smoke"

# Development Environment (Integration Testing)
otp run api --target dev --tags "integration,regression"
otp run contract --target dev

# Staging Environment (Pre-Production Validation)
otp run api --target staging --tags "regression,performance"
otp run e2e --target staging --tags "critical,user-journey"
otp run perf --target staging

# Production Environment (Monitoring Only)
otp status --target prod
otp report open --target prod --dashboard production-health
```

## Data Management Patterns

### Fixture Management Strategy

```bash
# Development: Rich, realistic data
otp seed --fixture-set development
# Contains: Full user profiles, complete product catalog, sample orders

# Testing: Controlled, predictable data
otp seed --fixture-set testing
# Contains: Known test users, specific test scenarios, edge cases

# Performance: Large datasets
otp seed --fixture-set performance
# Contains: Thousands of users, large product catalog, high-volume data

# CI: Minimal, fast-loading data
otp seed --fixture-set ci-minimal
# Contains: Essential data only, optimized for speed
```

### Data Reset Strategies

```bash
# Soft reset (preserve structure, reload data)
otp seed reset --fixture-set basic

# Hard reset (clean slate)
otp down --clean
otp up
otp seed --fixture-set fresh

# Selective reset (specific data types)
otp seed reset --fixture-set users-only
otp seed load --fixture-set products-sample
```

## Monitoring and Observability

### Health Check Patterns

```bash
# Comprehensive health check
otp status --verbose > health-report.txt

# Service-specific deep dive
otp status --service grafana --details
otp logs grafana --tail 200 --timestamps

# Automated health monitoring
while true; do
  otp status --service api || echo "API unhealthy at $(date)"
  sleep 30
done
```

### Performance Monitoring

```bash
# Baseline performance measurement
otp run perf --env VUS=1 --env DURATION=1m --output-dir baseline/

# Load testing
otp run perf --env VUS=50 --env DURATION=10m --output-dir load-test/

# Stress testing
otp run perf --env VUS=100 --env DURATION=5m --output-dir stress-test/

# Compare results
otp report generate --format json --output current-perf.json
diff baseline/results.json current-perf.json
```

### Log Analysis Patterns

```bash
# Error investigation
otp logs all --filter "ERROR|EXCEPTION|FATAL" --since 1h

# Performance analysis
otp logs api --filter "slow|timeout|latency" --since 30m

# Security monitoring
otp logs all --filter "auth|login|security|unauthorized" --since 24h

# Real-time monitoring
otp logs all --follow --filter "ERROR|WARN"
```

## Troubleshooting Workflows

### Common Issue Resolution

**Services Won't Start:**
```bash
# Check Docker/Kubernetes status
docker ps
kubectl get pods -n otp-testing

# Check configuration
otp config validate

# Check resource usage
otp status --verbose

# Clean restart
otp down --clean
otp up --build --verbose
```

**Tests Failing:**
```bash
# Check service health first
otp status

# Verify test data
otp seed validate --fixture-set current

# Run with verbose output
otp run api --verbose --tags "failing-test"

# Check service logs
otp logs api --since 10m --filter "ERROR"

# Reset environment
otp seed reset
otp run api --tags "smoke"
```

**Performance Issues:**
```bash
# Check resource usage
otp status --verbose

# Analyze service logs
otp logs all --filter "slow|timeout|memory|cpu"

# Run performance baseline
otp run perf --env VUS=1 --env DURATION=30s

# Check infrastructure metrics
otp report open --dashboard infrastructure-health
```

## Security Best Practices

### Credential Management

```bash
# Use environment variables for sensitive data
export OTP_GRAFANA_TOKEN="your-secure-token"
export OTP_DATABASE_PASSWORD="secure-password"

# Avoid hardcoding in configuration files
# ❌ Bad
auth: { token: "hardcoded-token" }

# ✅ Good
auth: { token: "${GRAFANA_TOKEN}" }
```

### Network Security

```bash
# Use secure profiles in production
export OTP_PROFILE=k8s-secure

# Verify TLS connections
otp status --service grafana --verify-tls

# Use network policies in Kubernetes
otp up --profile k8s --enable-network-policies
```

### Access Control

```bash
# Read-only mode for production monitoring
export OTP_READ_ONLY=true
otp status --target prod

# Audit trail
export OTP_AUDIT_LOG=true
otp run api --target staging  # Logs all actions
```

## Performance Optimization

### Resource Management

```bash
# Optimize for CI (faster startup, less resources)
export OTP_PROFILE=ci
otp up --services "grafana,prometheus" --no-wait

# Optimize for development (full features)
export OTP_PROFILE=local
otp up --build --health-timeout 180

# Optimize for production (reliability, monitoring)
export OTP_PROFILE=k8s
otp up --timeout 600 --health-timeout 300
```

### Caching Strategies

```bash
# Enable status caching for faster responses
export OTP_CACHE_TTL=30
otp status  # Cached for 30 seconds

# Disable caching for real-time monitoring
otp status --refresh --no-cache

# Clear all caches
otp cache clear
```

This comprehensive guide provides patterns and practices for effectively integrating the OTP CLI into various development and deployment workflows.