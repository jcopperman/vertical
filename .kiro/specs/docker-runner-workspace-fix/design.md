# Design Document

## Overview

This design addresses the Docker runner workspace mounting issue by modifying the `buildDockerArgs` method in the `DockerRunner` class to automatically mount the current working directory to `/workspace` in the Docker container. The solution ensures that test execution has access to all project files while maintaining compatibility with existing volume mounting functionality.

## Architecture

The fix involves a single modification to the Docker runner's argument building logic:

```
Host System                    Docker Container
┌─────────────────────┐       ┌─────────────────────┐
│ Project Directory   │────── │ /workspace          │
│ ├── package.json    │       │ ├── package.json    │
│ ├── src/           │       │ ├── src/           │
│ ├── tests/         │       │ ├── tests/         │
│ └── ...            │       │ └── ...            │
└─────────────────────┘       └─────────────────────┘
```

The workspace mount will be added alongside existing mounts:
- Custom volumes (from runner definition)
- Output directory mount (`/test-results`)
- **NEW:** Workspace mount (`/workspace`)

## Components and Interfaces

### Modified Components

#### DockerRunner.buildDockerArgs()
- **Current behavior:** Builds Docker run arguments with custom volumes and output directory mount
- **New behavior:** Additionally mounts the current working directory to `/workspace`
- **Interface:** No changes to method signature
- **Implementation:** Add workspace mount before image specification

### Path Resolution Strategy

The implementation will use Node.js `path.resolve()` to ensure cross-platform compatibility:

```typescript
// Cross-platform path resolution
const workspacePath = path.resolve(context.workingDirectory);
const containerWorkspace = '/workspace';
const volumeMount = `${workspacePath}:${containerWorkspace}`;
```

### Mount Order and Precedence

Mounts will be added in this order:
1. Environment variables (`-e` flags)
2. Custom volumes from runner definition
3. **NEW:** Workspace mount (`-v ${workingDirectory}:/workspace`)
4. Output directory mount (`-v ${outputDirectory}:/test-results`)
5. Working directory specification (`-w /workspace`)
6. Image and command

## Data Models

### RunnerExecutionContext (No Changes)
The existing context already provides `workingDirectory` which will be used for the workspace mount.

### DockerRunner Configuration (No Changes)
No changes to the runner definition schema are required.

## Error Handling

### Path Resolution Errors
- **Issue:** Invalid or inaccessible working directory
- **Handling:** Validate path exists and is readable before building Docker args
- **Error Message:** "Cannot mount workspace: directory '{path}' is not accessible"

### Docker Mount Failures
- **Issue:** Docker fails to mount the volume (permissions, path format, etc.)
- **Handling:** Docker will return non-zero exit code with stderr output
- **Error Message:** Preserve Docker's native error message and add context about workspace mounting

### Path Format Issues
- **Issue:** Windows paths with spaces or special characters
- **Handling:** Use proper path quoting in volume mount specification
- **Error Message:** "Failed to mount workspace due to path format issues"

## Testing Strategy

### Unit Tests
1. **Test workspace mount argument generation**
   - Verify correct volume mount string format
   - Test cross-platform path handling
   - Validate mount order in Docker arguments

2. **Test path resolution**
   - Test absolute path resolution
   - Test relative path resolution
   - Test paths with spaces and special characters

3. **Test error scenarios**
   - Test with non-existent working directory
   - Test with inaccessible directory (permissions)

### Integration Tests
1. **Test actual Docker execution**
   - Create minimal test project with package.json
   - Execute Docker runner and verify file access
   - Verify npm/yarn commands work inside container

2. **Test with existing volume mounts**
   - Configure runner with custom volumes
   - Verify workspace mount doesn't conflict
   - Verify all mounts are present in container

### Cross-Platform Testing
1. **Windows testing**
   - Test with Windows path formats (C:\path\to\project)
   - Test with paths containing spaces
   - Test with UNC paths if applicable

2. **Unix testing**
   - Test with Unix path formats (/path/to/project)
   - Test with symlinks
   - Test with paths containing special characters

## Implementation Details

### Code Changes Required

#### src/runners/docker-runner.ts
```typescript
private buildDockerArgs(context: RunnerExecutionContext): string[] {
  const args = ['docker', 'run', '--rm'];

  // Add environment variables
  const env = this.buildEnvironment(context);
  for (const [key, value] of Object.entries(env)) {
    args.push('-e', `${key}=${value}`);
  }

  // Add custom volume mounts
  if (this.definition.volumes) {
    for (const volume of this.definition.volumes) {
      args.push('-v', volume);
    }
  }

  // ADD: Mount workspace directory
  const workspacePath = path.resolve(context.workingDirectory);
  args.push('-v', `${workspacePath}:/workspace`);

  // Add output directory mount
  args.push('-v', `${context.outputDirectory}:/test-results`);

  // Add working directory
  args.push('-w', '/workspace');

  // Add image and command...
}
```

### Dependencies
- Add `import path from 'path'` to docker-runner.ts
- No new external dependencies required

### Backward Compatibility
- Existing functionality remains unchanged
- Custom volume mounts continue to work
- Output directory mounting preserved
- No breaking changes to configuration format

## Security Considerations

### File System Access
- The workspace mount provides read-write access to the entire project directory
- This is expected behavior for test execution
- Users should be aware that containers can modify project files

### Path Traversal Prevention
- Use `path.resolve()` to normalize paths and prevent traversal attacks
- Docker's own path validation provides additional security

### Container Isolation
- Workspace mount doesn't compromise container isolation
- Network and process isolation remain intact
- Only file system access is extended to project directory