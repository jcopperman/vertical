# 🧪 OTP CLI - Outeniqua Test Platform

[![npm version](https://badge.fury.io/js/%40otp%2Fcli.svg)](https://badge.fury.io/js/%40otp%2Fcli)
[![Build Status](https://github.com/your-org/otp-cli/workflows/CI/badge.svg)](https://github.com/your-org/otp-cli/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A comprehensive command-line interface for the Outeniqua Test Platform that provides unified infrastructure orchestration, test execution, and reporting across multiple environments.

## ✨ Features

- **🚀 Infrastructure Orchestration**: Deploy and manage testing infrastructure using Docker Compose or Kubernetes/Helm
- **🧪 Unified Test Execution**: Run API, E2E, Contract, Performance, and Chaos tests with a single interface
- **📊 Integrated Reporting**: Seamless integration with Grafana dashboards and Results API
- **🌍 Multi-Environment Support**: Local development, CI/CD, and Kubernetes deployment profiles
- **📁 Fixture Management**: Manage test data and fixtures across different environments and scenarios
- **🔍 Real-time Monitoring**: Service health checks, log streaming, and performance monitoring
- **⚙️ Flexible Configuration**: Profile-based configuration with environment variable overrides

## 🚀 Quick Start

### Installation

```bash
# Install globally via npm
npm install -g @otp/cli

# Or use Docker
docker pull otp/cli:latest
alias otp='docker run --rm -v $(pwd):/workspace otp/cli:latest'

# Verify installation
otp version
```

### First Steps

```bash
# 1. Initialize your project
otp config init

# 2. Start the infrastructure
otp up

# 3. Check service health
otp status

# 4. Load test data
otp seed

# 5. Run your first test
otp run api

# 6. View results
otp report open
```

## 📖 Documentation

### Core Guides
- **[Getting Started](docs/getting-started.md)** - Complete setup and first steps
- **[CLI Reference](docs/cli-reference.md)** - Comprehensive command documentation
- **[Configuration Guide](docs/configuration.md)** - Detailed configuration options
- **[Integration Patterns](docs/integration-patterns.md)** - Best practices and workflows
- **[Troubleshooting](docs/troubleshooting.md)** - Common issues and solutions

### Configuration Examples
- **[Local Development](docs/examples/local-config.js)** - Development environment setup
- **[CI/CD Pipeline](docs/examples/ci-config.js)** - Continuous integration configuration
- **[Kubernetes Deployment](docs/examples/k8s-config.js)** - Production Kubernetes setup

## 🎯 Core Commands

### Infrastructure Management
```bash
otp up                    # Start infrastructure stack
otp down                  # Stop infrastructure stack
otp status                # Check service health
otp logs <service>        # View service logs
```

### Test Execution
```bash
otp run api               # Run API tests
otp run e2e --tags smoke  # Run E2E tests with tags
otp run perf --target staging  # Run performance tests
otp seed --fixture-set basic   # Load test data
```

### Reporting & Monitoring
```bash
otp report open           # Open Grafana dashboards
otp report generate       # Generate test reports
otp status --verbose      # Detailed health information
```

## ⚙️ Configuration

The CLI uses a flexible, profile-based configuration system:

```javascript
// otp.config.js
module.exports = {
  version: '1.0.0',
  profile: 'local', // local | ci | k8s
  
  infrastructure: {
    compose: {
      baseFile: 'docker-compose.yml',
      profileFiles: {
        local: 'docker-compose.local.yml',
        ci: 'docker-compose.ci.yml',
        k8s: 'docker-compose.k8s.yml'
      },
      projectName: 'my-otp-project'
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
      }
      // More services...
    ]
  },
  
  runners: {
    api: {
      type: 'docker',
      image: 'node:18-alpine',
      command: ['npm', 'test'],
      timeout: 300000
    }
    // More runners...
  },
  
  reporting: {
    grafana: {
      url: 'http://localhost:3000',
      dashboards: [/* dashboard configs */]
    },
    resultsApi: {
      url: 'http://localhost:8080/api/results'
    }
  },
  
  fixtures: {
    defaultSet: 'basic',
    sets: {
      basic: {
        name: 'Basic Test Data',
        files: ['fixtures/users.json', 'fixtures/products.json']
      }
    }
  }
};
```

### Environment Variables

Override any configuration using environment variables:

```bash
export OTP_PROFILE=ci
export OTP_INFRASTRUCTURE_COMPOSE_PROJECT_NAME=my-project
export OTP_REPORTING_GRAFANA_URL=https://grafana.example.com
```

## 🔄 Common Workflows

### Development Workflow
```bash
# Daily startup
otp up && otp seed && otp status

# During development
otp run api --tags "unit,integration"
otp logs api --follow

# End of day
otp down
```

### CI/CD Pipeline
```bash
# CI environment
export OTP_PROFILE=ci
otp up --timeout 180
otp seed --fixture-set ci-minimal
otp run api --target ci
otp run contract --target ci
otp report generate --format json
otp down
```

### Production Monitoring
```bash
# Production health checks
export OTP_PROFILE=k8s
otp status --verbose
otp report open --dashboard production-health
```

## 🏗️ Development

### Prerequisites
- Node.js 18+
- Docker Desktop
- Git

### Setup
```bash
# Clone and setup
git clone https://github.com/your-org/otp-cli.git
cd otp-cli
npm install

# Run tests
npm test

# Build
npm run build

# Link for local development
npm link
```

### Scripts

- `npm run build` - Build TypeScript to JavaScript
- `npm run dev` - Run CLI in development mode with ts-node
- `npm run start` - Run built CLI
- `npm test` - Run Jest tests
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting
- `npm run clean` - Clean build directory

### Testing
```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# All tests with coverage
npm run test:coverage
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Quick Contribution Steps
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and add tests
4. Run the test suite: `npm test`
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

## 📋 Roadmap

- [ ] **Enhanced Kubernetes Support** - Advanced Helm chart management
- [ ] **Plugin System** - Custom runner and reporter plugins
- [ ] **Interactive Mode** - TUI for better user experience
- [ ] **Advanced Scheduling** - Cron-based test execution
- [ ] **Multi-Cloud Support** - AWS, GCP, Azure deployment options

## 🆘 Support

### Getting Help
- **Documentation**: [https://docs.otp.example.com](https://docs.otp.example.com)
- **GitHub Issues**: [Report bugs or request features](https://github.com/your-org/otp-cli/issues)
- **Discussions**: [Community discussions](https://github.com/your-org/otp-cli/discussions)
- **Slack**: Join our [#otp-cli channel](https://slack.example.com)

### Troubleshooting
```bash
# Enable debug logging
export DEBUG=otp:*
otp status

# Validate configuration
otp config validate

# System health check
otp doctor
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Commander.js](https://github.com/tj/commander.js/) for CLI framework
- Powered by [Docker](https://www.docker.com/) and [Kubernetes](https://kubernetes.io/)
- Monitoring via [Grafana](https://grafana.com/) and [Prometheus](https://prometheus.io/)
- Inspired by modern DevOps and testing practices

---

<div align="center">
  <strong>Happy Testing! 🧪</strong>
  <br>
  <sub>Built with ❤️ by the OTP Team</sub>
</div>