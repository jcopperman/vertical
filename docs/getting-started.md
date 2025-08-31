# Getting Started with OTP CLI

This guide will help you get up and running with the Outeniqua Test Platform CLI quickly and efficiently.

## Prerequisites

Before you begin, ensure you have the following installed:

### Required Dependencies

- **Node.js 18+**: Runtime for the CLI
- **Docker Desktop**: For local infrastructure orchestration
- **Git**: For version control and configuration management

### Optional Dependencies

- **Kubernetes CLI (kubectl)**: For Kubernetes deployments
- **Helm 3+**: For Kubernetes package management
- **k6**: For performance testing (if using local runner)

### System Requirements

- **Memory**: 8GB RAM minimum (16GB recommended)
- **Storage**: 10GB free space for Docker images and data
- **Network**: Internet access for pulling Docker images

## Installation

### Option 1: NPM Installation (Recommended)

```bash
# Install globally
npm install -g @otp/cli

# Verify installation
otp version
```

### Option 2: Local Development Installation

```bash
# Clone the repository
git clone https://github.com/your-org/otp-cli.git
cd otp-cli

# Install dependencies
npm install

# Build the CLI
npm run build

# Link for global usage
npm link

# Verify installation
otp version
```

### Option 3: Docker Installation

```bash
# Pull the CLI image
docker pull otp/cli:latest

# Create an alias for easy usage
alias otp='docker run --rm -v $(pwd):/workspace -v /var/run/docker.sock:/var/run/docker.sock otp/cli:latest'

# Verify installation
otp version
```

## Initial Configuration

### Step 1: Create Configuration File

Create an `otp.config.js` file in your project root:

```bash
# Generate a basic configuration
otp config init

# Or copy from example
cp otp.config.example.js otp.config.js
```

### Step 2: Basic Configuration Setup

Edit your `otp.config.js` file:

```javascript
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
      // Add more services as needed
    ],
    healthChecks: {
      timeout: 120000,
      retries: 5,
      interval: 5000
    }
  },
  
  runners: {
    api: {
      type: 'docker',
      image: 'node:18-alpine',
      command: ['npm', 'test'],
      timeout: 300000
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
      url: 'http://localhost:8080/api/results',
      timeout: 30000
    }
  },
  
  fixtures: {
    defaultSet: 'basic',
    sets: {
      basic: {
        name: 'Basic Test Data',
        description: 'Minimal test data for development',
        files: ['fixtures/users.json', 'fixtures/products.json']
      }
    }
  }
};
```

### Step 3: Validate Configuration

```bash
# Check configuration syntax and completeness
otp config validate

# Show current configuration
otp config show
```

## First Steps

### Step 1: Start the Infrastructure

```bash
# Start all services
otp up

# Monitor the startup process
otp status --verbose
```

Expected output:
```
🚀 Starting deployment...
   📦 Pulling/building images...
   ✅ Services deployed (45s)
   🔍 Checking service health...
   ✅ All services healthy (6/6)

🎉 OTP infrastructure deployed successfully!
   Services: 6 deployed, 6 healthy
   Time: 45 seconds

📡 Available services:
   grafana: http://localhost:3000
   prometheus: http://localhost:9090
   
💡 Use 'otp status' to check service health
💡 Use 'otp report open' to view dashboards
```

### Step 2: Verify Service Health

```bash
# Check all services
otp status

# Check specific service
otp status --service grafana --verbose
```

### Step 3: Load Test Data

```bash
# Load default fixture set
otp seed

# Or load specific fixture set
otp seed --fixture-set basic
```

### Step 4: Run Your First Test

```bash
# Run API tests
otp run api

# Run with specific tags
otp run api --tags "smoke"
```

### Step 5: View Results

```bash
# Open Grafana dashboards
otp report open

# Generate test report
otp report generate --format html
```

## Common Workflows

### Development Workflow

```bash
# Daily startup
otp up
otp status
otp seed

# During development
otp run api --tags "unit,integration"
otp logs api --follow

# End of day
otp down
```

### Testing Workflow

```bash
# Comprehensive testing
otp up --build
otp seed --fixture-set full
otp run api
otp run e2e --tags "smoke"
otp report open
```

### Debugging Workflow

```bash
# When something goes wrong
otp status --verbose
otp logs all --filter "ERROR|WARN"
otp down --clean
otp up --verbose
```

## Environment Profiles

### Local Development Profile

```bash
export OTP_PROFILE=local
otp up
```

Features:
- Full service stack
- Development-friendly timeouts
- Rich logging and debugging
- Persistent data volumes

### CI/CD Profile

```bash
export OTP_PROFILE=ci
otp up --timeout 180
```

Features:
- Optimized for speed
- Headless operation
- Minimal resource usage
- Faster timeouts

### Kubernetes Profile

```bash
export OTP_PROFILE=k8s
otp up --timeout 600
```

Features:
- Helm-based deployment
- Production-ready configuration
- Scalable architecture
- Advanced monitoring

## Troubleshooting

### Common Issues

**Docker not running:**
```bash
# Check Docker status
docker ps

# Start Docker Desktop or daemon
sudo systemctl start docker  # Linux
# Or start Docker Desktop app
```

**Port conflicts:**
```bash
# Check what's using ports
netstat -tulpn | grep :3000

# Stop conflicting services
otp down --clean
```

**Configuration errors:**
```bash
# Validate configuration
otp config validate

# Check syntax
node -c otp.config.js
```

**Services not healthy:**
```bash
# Check detailed status
otp status --verbose

# Check service logs
otp logs grafana --tail 100

# Restart services
otp down && otp up
```

### Getting Help

```bash
# General help
otp help

# Command-specific help
otp help up
otp help run

# Enable debug logging
export DEBUG=otp:*
otp status
```

### Health Check

```bash
# Run system diagnostics
otp doctor

# Check all dependencies
otp config check-deps
```

## Next Steps

### Customize Your Setup

1. **Add your test suites** to the `runners` configuration
2. **Create fixture sets** for your specific data needs
3. **Configure Grafana dashboards** for your metrics
4. **Set up CI/CD integration** with your pipeline

### Learn More

- [CLI Reference](./cli-reference.md) - Complete command documentation
- [Configuration Guide](./configuration.md) - Detailed configuration options
- [Integration Patterns](./integration-patterns.md) - Best practices and workflows
- [Troubleshooting Guide](./troubleshooting.md) - Common issues and solutions

### Community and Support

- **Documentation**: https://docs.otp.example.com
- **GitHub Issues**: https://github.com/your-org/otp-cli/issues
- **Discussions**: https://github.com/your-org/otp-cli/discussions
- **Slack Channel**: #otp-cli

## Quick Reference Card

```bash
# Essential Commands
otp up                    # Start infrastructure
otp down                  # Stop infrastructure
otp status                # Check health
otp run <suite>           # Run tests
otp seed                  # Load test data
otp report open           # View results
otp logs <service>        # View logs
otp help <command>        # Get help

# Common Options
--profile <name>          # Use specific profile
--verbose                 # Enable detailed output
--dry-run                 # Show what would happen
--timeout <seconds>       # Set operation timeout

# Environment Variables
export OTP_PROFILE=ci     # Set default profile
export OTP_VERBOSE=true   # Enable verbose mode
export DEBUG=otp:*        # Enable debug logging
```

You're now ready to use the OTP CLI effectively! Start with the basic workflow above and gradually explore more advanced features as your needs grow.