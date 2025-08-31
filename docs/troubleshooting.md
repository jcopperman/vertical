# Configuration Troubleshooting Guide

This guide covers common configuration issues and their solutions when using the OTP CLI.

## Configuration Discovery Issues

### Problem: Configuration file not found
```
Error: No configuration file found. Please create an otp.config.js file.
```

**Solutions:**
1. Create a configuration file in one of the supported formats:
   - `otp.config.js` (recommended)
   - `otp.config.json`
   - `.otprc`
   - Add `otp` section to `package.json`

2. Ensure the file is in the project root or a parent directory

3. Check file permissions (must be readable)

**Example minimal configuration:**
```javascript
module.exports = {
  version: '1.0.0',
  profile: 'local',
  infrastructure: { /* ... */ },
  runners: { /* ... */ },
  reporting: { /* ... */ },
  fixtures: { /* ... */ }
};
```

### Problem: Invalid configuration format
```
Error: Configuration file contains invalid syntax
```

**Solutions:**
1. Validate JSON syntax if using `.json` format
2. Check JavaScript syntax if using `.js` format
3. Ensure proper module.exports in JavaScript files
4. Use a linter or formatter to check syntax

## Profile Configuration Issues

### Problem: Invalid profile specified
```
Configuration validation failed: "profile" must be one of [local, ci, k8s]
```

**Solutions:**
1. Use only supported profiles: `local`, `ci`, or `k8s`
2. Check environment variable: `OTP_PROFILE=local`
3. Verify profile in configuration file

**Example:**
```javascript
module.exports = {
  profile: 'local', // Must be 'local', 'ci', or 'k8s'
  // ...
};
```

### Problem: Profile-specific files missing
```
Error: Profile file 'docker-compose.local.yml' not found
```

**Solutions:**
1. Create the missing profile-specific compose file
2. Update the `profileFiles` configuration to point to existing files
3. Use relative paths from the project root

**Example:**
```javascript
infrastructure: {
  compose: {
    profileFiles: {
      local: 'docker/docker-compose.local.yml',
      ci: 'docker/docker-compose.ci.yml',
      k8s: 'docker/docker-compose.k8s.yml'
    }
  }
}
```

## Infrastructure Configuration Issues

### Problem: Invalid service ports
```
Configuration validation failed: "infrastructure.services[0].ports[0]" must be a valid port
```

**Solutions:**
1. Use valid port numbers (1-65535)
2. Ensure ports are numbers, not strings
3. Check for port conflicts

**Example:**
```javascript
services: [
  {
    name: 'api',
    ports: [8080, 8443], // Numbers, not strings
    // ...
  }
]
```

### Problem: Health check endpoint format
```
Configuration validation failed: "infrastructure.services[0].healthCheck.endpoint" must be a valid relative URI
```

**Solutions:**
1. Use relative paths starting with `/`
2. Don't include protocol or host
3. Ensure proper URL encoding

**Example:**
```javascript
healthCheck: {
  endpoint: '/health',        // ✓ Correct
  // endpoint: 'health',      // ✗ Missing leading slash
  // endpoint: 'http://...',  // ✗ Absolute URL not allowed
  timeout: 30000,
  retries: 3
}
```

### Problem: Docker Compose project name conflicts
```
Error: Docker Compose project 'otp' already exists with different configuration
```

**Solutions:**
1. Use unique project names for different environments
2. Stop existing containers: `docker-compose down`
3. Change the project name in configuration

**Example:**
```javascript
infrastructure: {
  compose: {
    projectName: 'otp-dev-john', // Make it unique
    // ...
  }
}
```

## Runner Configuration Issues

### Problem: Invalid runner type
```
Configuration validation failed: "runners.api.type" must be one of [docker, k8s, local]
```

**Solutions:**
1. Use only supported runner types: `docker`, `k8s`, `local`
2. Check spelling and case sensitivity

### Problem: Missing Docker image for container runners
```
Configuration validation failed: "runners.api.image" is required when type is "docker"
```

**Solutions:**
1. Specify image for Docker and Kubernetes runners
2. Use fully qualified image names for reliability

**Example:**
```javascript
runners: {
  api: {
    type: 'docker',
    image: 'node:18-alpine', // Required for docker/k8s runners
    command: ['npm', 'test'],
    // ...
  },
  e2e: {
    type: 'local',
    // No image needed for local runners
    command: ['npm', 'run', 'test:e2e'],
    // ...
  }
}
```

### Problem: Command array format
```
Configuration validation failed: "runners.api.command" must be an array
```

**Solutions:**
1. Always use array format for commands
2. Split command and arguments into separate array elements

**Example:**
```javascript
runners: {
  api: {
    command: ['npm', 'test'],           // ✓ Correct
    // command: 'npm test',             // ✗ String not allowed
    // command: ['npm test'],           // ✗ Don't combine command and args
  }
}
```

## Reporting Configuration Issues

### Problem: Invalid Grafana URL
```
Configuration validation failed: "reporting.grafana.url" must be a valid URI
```

**Solutions:**
1. Include protocol (http:// or https://)
2. Use valid hostname or IP address
3. Check for typos in URL

**Example:**
```javascript
reporting: {
  grafana: {
    url: 'http://localhost:3000',     // ✓ Correct
    // url: 'localhost:3000',         // ✗ Missing protocol
    // url: 'http://local host:3000', // ✗ Invalid hostname
  }
}
```

### Problem: Authentication configuration mismatch
```
Configuration validation failed: "reporting.grafana.auth.username" is required when type is "basic"
```

**Solutions:**
1. Provide required fields for each auth type:
   - `basic`: requires `username` and `password`
   - `token`: requires `token`
   - `oauth`: requires `token`

**Example:**
```javascript
auth: {
  type: 'basic',
  username: 'admin',
  password: 'admin'
},
// OR
auth: {
  type: 'token',
  token: 'your-api-token'
}
```

## Fixture Configuration Issues

### Problem: Fixture files not found
```
Error: Fixture file 'fixtures/users.json' not found
```

**Solutions:**
1. Create the missing fixture files
2. Use correct relative paths from project root
3. Check file permissions

**Example directory structure:**
```
project/
├── otp.config.js
├── fixtures/
│   ├── users.json
│   ├── products.json
│   └── orders.json
└── ...
```

### Problem: Circular fixture dependencies
```
Error: Circular dependency detected in fixture sets: basic -> full -> basic
```

**Solutions:**
1. Remove circular dependencies
2. Restructure fixture hierarchy
3. Use linear dependency chains

**Example:**
```javascript
fixtures: {
  sets: {
    minimal: {
      files: ['fixtures/users-minimal.json']
      // No dependencies
    },
    basic: {
      files: ['fixtures/users.json'],
      dependencies: ['minimal'] // ✓ Linear dependency
    },
    full: {
      files: ['fixtures/orders.json'],
      dependencies: ['basic'] // ✓ Linear dependency
    }
  }
}
```

## Environment Variable Issues

### Problem: Environment variable not recognized
```
Warning: Environment variable OTP_INVALID_SETTING ignored
```

**Solutions:**
1. Use correct naming convention: `OTP_<SECTION>_<PROPERTY>`
2. Check spelling and case sensitivity
3. Use underscores to separate nested properties

**Valid examples:**
```bash
export OTP_PROFILE=ci
export OTP_INFRASTRUCTURE_COMPOSE_PROJECT_NAME=my-project
export OTP_RUNNERS_API_TIMEOUT=600000
export OTP_REPORTING_GRAFANA_URL=http://localhost:3000
```

### Problem: Environment variable type mismatch
```
Configuration validation failed: "infrastructure.healthChecks.timeout" must be a number
```

**Solutions:**
1. Ensure numeric values are valid numbers
2. Don't include quotes around numbers in shell
3. Use proper boolean values

**Example:**
```bash
# ✓ Correct
export OTP_INFRASTRUCTURE_HEALTH_CHECKS_TIMEOUT=60000

# ✗ Incorrect (quoted number)
export OTP_INFRASTRUCTURE_HEALTH_CHECKS_TIMEOUT="60000"
```

## Docker-Specific Issues

### Problem: Docker daemon not running
```
Error: Cannot connect to Docker daemon. Is Docker running?
```

**Solutions:**
1. Start Docker Desktop or Docker daemon
2. Check Docker service status: `systemctl status docker`
3. Verify Docker socket permissions

### Problem: Docker Compose version compatibility
```
Error: docker-compose version 1.x is not supported
```

**Solutions:**
1. Update to Docker Compose v2: `docker compose` (not `docker-compose`)
2. Install latest Docker Desktop
3. Update standalone Docker Compose

## Kubernetes-Specific Issues

### Problem: Kubectl not configured
```
Error: Unable to connect to Kubernetes cluster
```

**Solutions:**
1. Configure kubectl: `kubectl config current-context`
2. Set correct kubeconfig: `export KUBECONFIG=/path/to/config`
3. Verify cluster access: `kubectl cluster-info`

### Problem: Helm not installed
```
Error: helm command not found
```

**Solutions:**
1. Install Helm: https://helm.sh/docs/intro/install/
2. Add Helm to PATH
3. Verify installation: `helm version`

### Problem: Insufficient Kubernetes permissions
```
Error: User cannot create resources in namespace 'otp-testing'
```

**Solutions:**
1. Create namespace: `kubectl create namespace otp-testing`
2. Check RBAC permissions
3. Use a namespace you have access to

## Performance Issues

### Problem: Configuration loading is slow
```
Warning: Configuration loading took 5.2 seconds
```

**Solutions:**
1. Reduce configuration file size
2. Avoid complex computations in config files
3. Use caching for repeated operations
4. Check for network timeouts in validation

### Problem: Health checks timing out
```
Error: Service 'api' failed health check after 30 seconds
```

**Solutions:**
1. Increase health check timeout
2. Verify service is actually healthy
3. Check network connectivity
4. Reduce health check frequency

**Example:**
```javascript
healthChecks: {
  timeout: 120000,  // Increase timeout
  retries: 5,       // More retries
  interval: 10000   // Less frequent checks
}
```

## Getting Help

If you continue to experience issues:

1. **Enable debug logging:**
   ```bash
   export DEBUG=otp:*
   otp status
   ```

2. **Validate configuration:**
   ```bash
   otp config validate
   ```

3. **Check system requirements:**
   ```bash
   otp doctor
   ```

4. **Review logs:**
   ```bash
   otp logs --all
   ```

5. **Create minimal reproduction case**
6. **Check GitHub issues:** https://github.com/your-org/otp-cli/issues