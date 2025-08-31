# OTP CLI Configuration Guide

The Outeniqua Test Platform (OTP) CLI uses a flexible configuration system that supports multiple deployment profiles and environments. This guide covers all configuration options, examples, and best practices.

## Configuration File Discovery

The CLI uses [cosmiconfig](https://github.com/davidtheclark/cosmiconfig) to discover configuration files in the following order:

1. `otp.config.js` (JavaScript module)
2. `otp.config.json` (JSON file)
3. `.otprc` (JSON or YAML)
4. `.otprc.json` (JSON)
5. `.otprc.yaml` or `.otprc.yml` (YAML)
6. `otp` property in `package.json`

## Configuration Schema

### Root Configuration

```typescript
interface OTPConfig {
  version: string;           // Configuration schema version
  profile: ProfileType;      // Active deployment profile
  infrastructure: InfrastructureConfig;
  runners: Record<string, RunnerDefinition>;
  reporting: ReportingConfig;
  fixtures: FixtureConfig;
}
```

### Profile Types

The CLI supports three deployment profiles:

- **`local`**: Development environment using Docker Compose
- **`ci`**: Continuous Integration environment with headless operation
- **`k8s`**: Kubernetes deployment using Helm charts

## Infrastructure Configuration

### Docker Compose Configuration

```typescript
interface ComposeConfig {
  baseFile: string;                    // Base compose file
  profileFiles: {                      // Profile-specific overrides
    local: string;
    ci: string;
    k8s: string;
  };
  projectName: string;                 // Docker Compose project name
}
```

### Service Definitions

```typescript
interface ServiceDefinition {
  name: string;                        // Service name
  ports: number[];                     // Exposed ports
  healthCheck?: {                      // Health check configuration
    endpoint: string;                  // Health check endpoint path
    timeout: number;                   // Timeout in milliseconds
    retries: number;                   // Number of retry attempts
  };
  dependencies?: string[];             // Service dependencies
}
```

### Health Check Configuration

```typescript
interface HealthCheckConfig {
  timeout: number;                     // Global health check timeout (ms)
  retries: number;                     // Number of retry attempts
  interval: number;                    // Interval between checks (ms)
}
```

## Runner Configuration

Runners define how different test suites are executed:

```typescript
interface RunnerDefinition {
  type: 'docker' | 'k8s' | 'local';   // Runner type
  image?: string;                      // Container image (docker/k8s only)
  command: string[];                   // Command to execute
  environment?: Record<string, string>; // Environment variables
  volumes?: string[];                  // Volume mounts (docker only)
  timeout: number;                     // Execution timeout (ms)
}
```

### Runner Types

#### Docker Runner
Executes tests in Docker containers:
```javascript
{
  type: 'docker',
  image: 'node:18-alpine',
  command: ['npm', 'test'],
  volumes: ['./tests:/app/tests:ro'],
  environment: {
    NODE_ENV: 'test'
  }
}
```

#### Local Runner
Executes tests on the host system:
```javascript
{
  type: 'local',
  command: ['npm', 'run', 'test:e2e'],
  environment: {
    HEADLESS: 'true'
  }
}
```

#### Kubernetes Runner
Executes tests as Kubernetes jobs:
```javascript
{
  type: 'k8s',
  image: 'my-test-image:latest',
  command: ['pytest', '--junit-xml=results.xml'],
  environment: {
    NAMESPACE: 'test'
  }
}
```

## Reporting Configuration

### Grafana Integration

```typescript
interface GrafanaConfig {
  url: string;                         // Grafana instance URL
  auth?: AuthConfig;                   // Authentication configuration
  dashboards: DashboardConfig[];       // Dashboard definitions
}
```

### Authentication

```typescript
interface AuthConfig {
  type: 'basic' | 'token' | 'oauth';   // Authentication type
  username?: string;                   // Username (basic auth)
  password?: string;                   // Password (basic auth)
  token?: string;                      // API token (token auth)
}
```

### Dashboard Configuration

```typescript
interface DashboardConfig {
  name: string;                        // Dashboard display name
  uid: string;                         // Grafana dashboard UID
  filters?: Record<string, string>;    // Default filters
}
```

## Fixture Configuration

Fixtures define test data sets for seeding environments:

```typescript
interface FixtureConfig {
  defaultSet: string;                  // Default fixture set name
  sets: Record<string, FixtureSet>;    // Available fixture sets
}

interface FixtureSet {
  name: string;                        // Set display name
  description: string;                 // Set description
  files: string[];                     // Fixture file paths
  dependencies?: string[];             // Dependent fixture sets
}
```

## Environment Variable Overrides

All configuration values can be overridden using environment variables with the `OTP_` prefix:

### Profile Override
```bash
export OTP_PROFILE=ci
```

### Service Configuration
```bash
export OTP_INFRASTRUCTURE_COMPOSE_PROJECT_NAME=my-project
export OTP_INFRASTRUCTURE_HEALTH_CHECKS_TIMEOUT=60000
```

### Runner Configuration
```bash
export OTP_RUNNERS_API_TIMEOUT=600000
export OTP_RUNNERS_API_ENVIRONMENT_NODE_ENV=production
```

### Reporting Configuration
```bash
export OTP_REPORTING_GRAFANA_URL=https://grafana.example.com
export OTP_REPORTING_GRAFANA_AUTH_TOKEN=your-api-token
```

### Environment Variable Naming Convention

Environment variables follow this pattern:
```
OTP_<SECTION>_<SUBSECTION>_<PROPERTY>=value
```

Examples:
- `OTP_PROFILE=local`
- `OTP_INFRASTRUCTURE_COMPOSE_BASE_FILE=docker-compose.yml`
- `OTP_RUNNERS_API_TYPE=docker`
- `OTP_REPORTING_GRAFANA_URL=http://localhost:3000`

## Configuration Validation

The CLI validates all configuration using Joi schemas. Common validation errors:

### Missing Required Fields
```
Configuration validation failed: "infrastructure.compose.baseFile" is required
```

### Invalid Values
```
Configuration validation failed: "profile" must be one of [local, ci, k8s]
```

### Type Mismatches
```
Configuration validation failed: "infrastructure.healthChecks.timeout" must be a number
```