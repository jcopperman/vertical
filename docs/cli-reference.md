# OTP CLI Reference

Complete command-line interface reference for the Outeniqua Test Platform CLI.

## Global Usage

```bash
otp <command> [options]
```

### Global Options

| Option | Description | Default |
|--------|-------------|---------|
| `-h, --help` | Display help for command | |
| `-v, --version` | Display version information | |
| `--verbose` | Enable verbose logging | `false` |
| `--config <path>` | Path to configuration file | Auto-discovered |
| `--profile <name>` | Configuration profile (local, ci, k8s) | `local` |

### Environment Variables

All CLI options can be set via environment variables:

```bash
export OTP_PROFILE=ci
export OTP_VERBOSE=true
export OTP_CONFIG=/path/to/config.js
```

## Commands

### `otp up` - Start Infrastructure

Start the OTP infrastructure stack using Docker Compose or Helm.

```bash
otp up [options]
```

**Aliases:** `start`

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--profile <profile>` | Deployment profile (local, ci, k8s) | `local` |
| `--build` | Build images before starting services | `false` |
| `--pull` | Pull latest images before starting | `false` |
| `--no-wait` | Don't wait for services to become healthy | `false` |
| `--timeout <seconds>` | Deployment timeout in seconds | `300` |
| `--health-timeout <seconds>` | Health check timeout in seconds | `120` |
| `--services <services>` | Comma-separated list of specific services | All services |

#### Examples

```bash
# Start all services with default settings
otp up

# Start with CI profile and build images
otp up --profile ci --build

# Start specific services only
otp up --services grafana,prometheus

# Start without waiting for health checks
otp up --no-wait --timeout 60
```

#### Exit Codes

- `0`: All services started successfully and are healthy
- `1`: Deployment failed or services are unhealthy
- `2`: Configuration error or validation failed

---

### `otp down` - Stop Infrastructure

Stop the OTP infrastructure stack and optionally clean up data.

```bash
otp down [options]
```

**Aliases:** `stop`

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--clean` | Remove all data volumes and reset state | `false` |
| `--timeout <seconds>` | Shutdown timeout in seconds | `60` |
| `--force` | Force stop services that don't respond | `false` |
| `--services <services>` | Comma-separated list of specific services | All services |

#### Examples

```bash
# Stop all services, preserve data
otp down

# Stop and clean all data
otp down --clean

# Force stop with shorter timeout
otp down --force --timeout 30

# Stop specific services only
otp down --services grafana,prometheus
```

#### Exit Codes

- `0`: All services stopped successfully
- `1`: Some services failed to stop cleanly
- `2`: Configuration error

---

### `otp status` - Check Infrastructure Health

Display the current status and health of all infrastructure services.

```bash
otp status [options]
```

**Aliases:** `st`

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--service <name>` | Check specific service only | All services |
| `--verbose` | Show detailed diagnostic information | `false` |
| `--details` | Show additional service details | `false` |
| `--refresh` | Force refresh cached status | `false` |

#### Examples

```bash
# Check all services
otp status

# Check specific service with details
otp status --service grafana --verbose

# Force refresh status cache
otp status --refresh
```

#### Exit Codes

- `0`: All services are healthy
- `1`: Some services are unhealthy or degraded
- `2`: Unable to check service status

---

### `otp run` - Execute Test Suites

Execute test suites through the configured test runners.

```bash
otp run <suite> [options]
```

**Aliases:** `test`, `execute`

#### Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `<suite>` | Test suite name (api, e2e, contract, perf, chaos) | Yes |

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--target <environment>` | Target environment (local, dev, staging, prod) | `local` |
| `--tags <criteria>` | Filter tests by tag criteria | All tests |
| `--parallel` | Run tests in parallel when supported | `false` |
| `--timeout <seconds>` | Test execution timeout in seconds | `300` |
| `--dry-run` | Show execution plan without running tests | `false` |
| `--env <key=value>` | Set environment variables (repeatable) | |
| `--output-dir <path>` | Directory for test output and artifacts | `./test-results` |
| `--no-progress` | Disable progress reporting | `false` |

#### Examples

```bash
# Run API tests against local environment
otp run api

# Run E2E tests against staging with specific tags
otp run e2e --target staging --tags "smoke,regression"

# Run performance tests with custom timeout
otp run perf --timeout 600 --env VUS=50 --env DURATION=10m

# Show what would be executed without running
otp run contract --dry-run

# Run tests in parallel with custom output directory
otp run api --parallel --output-dir ./results/api
```

#### Tag Filtering

Use tag expressions to filter tests:

```bash
# Run only smoke tests
otp run api --tags "smoke"

# Run regression tests but exclude slow ones
otp run e2e --tags "regression && !slow"

# Run either smoke or critical tests
otp run api --tags "smoke || critical"
```

#### Exit Codes

- `0`: All tests passed
- `1`: Some tests failed
- `2`: Test execution error or configuration issue

---

### `otp report` - Access Test Reports

Open Grafana dashboards or generate test reports.

```bash
otp report <action> [options]
```

#### Actions

| Action | Description |
|--------|-------------|
| `open` | Open Grafana dashboard in browser |
| `generate` | Generate test report file |
| `list` | List available dashboards |

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--run-id <id>` | Specific test run ID to view | Latest run |
| `--dashboard <name>` | Specific dashboard to open | Default |
| `--format <format>` | Report format (json, html, pdf) | `html` |
| `--output <path>` | Output file path for generated reports | Auto-generated |

#### Examples

```bash
# Open latest test results in Grafana
otp report open

# Open specific run results
otp report open --run-id abc123

# Generate HTML report for latest run
otp report generate --format html

# List available dashboards
otp report list
```

#### Exit Codes

- `0`: Report opened or generated successfully
- `1`: No test runs found or report generation failed
- `2`: Configuration error or Grafana unavailable

---

### `otp seed` - Manage Test Data

Load test fixtures and manage test data in target environments.

```bash
otp seed [action] [options]
```

#### Actions

| Action | Description |
|--------|-------------|
| `load` | Load fixture set (default action) |
| `reset` | Clear existing data and reload fixtures |
| `list` | List available fixture sets |
| `validate` | Validate fixture files |

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--fixture-set <name>` | Specific fixture set to load | Default set |
| `--target <environment>` | Target environment | `local` |
| `--dry-run` | Show what would be loaded without executing | `false` |
| `--force` | Force overwrite existing data | `false` |

#### Examples

```bash
# Load default fixture set
otp seed

# Load specific fixture set
otp seed --fixture-set performance

# Reset data and load fresh fixtures
otp seed reset --fixture-set basic

# List available fixture sets
otp seed list

# Validate fixture files without loading
otp seed validate --fixture-set full
```

#### Exit Codes

- `0`: Fixtures loaded successfully
- `1`: Fixture loading failed
- `2`: Fixture validation failed or files not found

---

### `otp logs` - View Service Logs

Display logs from infrastructure services for debugging and monitoring.

```bash
otp logs <service> [options]
```

#### Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `<service>` | Service name or 'all' for all services | Yes |

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--follow, -f` | Follow log output in real-time | `false` |
| `--tail <lines>` | Number of lines to show from end | `100` |
| `--since <time>` | Show logs since timestamp or duration | |
| `--timestamps` | Include timestamps in output | `false` |
| `--filter <pattern>` | Filter logs by pattern (regex) | |

#### Examples

```bash
# Show recent logs from API service
otp logs api

# Follow Grafana logs in real-time
otp logs grafana --follow

# Show last 50 lines with timestamps
otp logs prometheus --tail 50 --timestamps

# Show logs from last 5 minutes
otp logs postgres --since 5m

# Show all service logs with error filter
otp logs all --filter "ERROR|WARN"
```

#### Exit Codes

- `0`: Logs displayed successfully
- `1`: Service not found or logs unavailable
- `2`: Configuration error

---

### `otp help` - Get Help

Display help information for commands.

```bash
otp help [command]
```

**Aliases:** `h`

#### Examples

```bash
# Show general help
otp help

# Show help for specific command
otp help up

# Show help for run command
otp help run
```

---

### `otp version` - Show Version

Display version and build information.

```bash
otp version [options]
```

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output version info as JSON | `false` |
| `--check` | Check for updates | `false` |

#### Examples

```bash
# Show version information
otp version

# Show version as JSON
otp version --json

# Check for updates
otp version --check
```

## Advanced Usage

### Configuration Profiles

Switch between different deployment profiles:

```bash
# Use CI profile for all commands
export OTP_PROFILE=ci
otp up
otp run api

# Override profile for single command
otp up --profile k8s
```

### Chaining Commands

Common workflow patterns:

```bash
# Full test cycle
otp up && otp seed && otp run api && otp report open

# Quick health check and test
otp status && otp run smoke --tags "critical"

# Clean restart
otp down --clean && otp up --build
```

### Debugging

Enable verbose logging for troubleshooting:

```bash
# Global verbose mode
export OTP_VERBOSE=true
otp status

# Command-specific verbose
otp up --verbose

# Debug-level logging
export DEBUG=otp:*
otp run api
```

### Integration with CI/CD

Example CI pipeline usage:

```bash
#!/bin/bash
set -e

# Setup
export OTP_PROFILE=ci
export OTP_VERBOSE=true

# Deploy infrastructure
otp up --timeout 180 --no-wait

# Wait for services to be ready
otp status --refresh

# Load test data
otp seed --fixture-set ci-minimal

# Run test suites
otp run api --target ci --tags "smoke,regression"
otp run contract --target ci
otp run e2e --target ci --tags "critical"

# Generate reports
otp report generate --format json --output results.json

# Cleanup
otp down --timeout 60
```

## Exit Codes Summary

All OTP CLI commands use consistent exit codes:

- `0`: Success
- `1`: Command failed (tests failed, services unhealthy, etc.)
- `2`: Configuration error or invalid usage
- `3`: Infrastructure error (Docker/Kubernetes unavailable)
- `4`: Network error (services unreachable)

## Getting Help

- Use `otp help` for general help
- Use `otp <command> --help` for command-specific help
- Check configuration with `otp config validate`
- View service status with `otp status --verbose`
- Enable debug logging with `export DEBUG=otp:*`