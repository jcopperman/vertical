/**
 * Integration tests for Docker runner with actual Docker execution
 * These tests require Docker to be installed and running
 */

import { DockerRunner } from './docker-runner';
import { RunnerDefinition } from '../config/types';
import { RunnerExecutionContext } from './types';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

// Skip these tests if Docker is not available
const isDockerAvailable = async (): Promise<boolean> => {
  return new Promise((resolve) => {
    const process = spawn('docker', ['--version'], { stdio: 'ignore' });
    process.on('close', (code) => resolve(code === 0));
    process.on('error', () => resolve(false));
  });
};

describe('DockerRunner Integration Tests', () => {
  let tempDir: string;
  let outputDir: string;
  let dockerRunner: DockerRunner;
  let mockDefinition: RunnerDefinition;
  let mockContext: RunnerExecutionContext;

  beforeAll(async () => {
    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      console.warn('Docker not available, skipping integration tests');
      return;
    }
  });

  beforeEach(async () => {
    // Skip setup if Docker is not available
    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      return;
    }

    // Create temporary directories for test workspace and output
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docker-runner-integration-'));
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docker-runner-output-'));

    // Create a minimal test project structure
    await createTestProject(tempDir);

    mockDefinition = {
      type: 'docker',
      image: 'node:18-alpine',
      command: ['node', '--version'],
      timeout: 30000,
      environment: {}
    };

    dockerRunner = new DockerRunner('integration-test-runner', mockDefinition);

    mockContext = {
      runId: 'integration-test-run',
      suite: 'integration-test-suite',
      runner: 'integration-test-runner',
      options: {
        target: 'local',
        parallel: false,
        timeout: 30000,
        environment: {}
      },
      workingDirectory: tempDir,
      outputDirectory: outputDir,
      environment: {}
    };
  });

  afterEach(async () => {
    // Clean up temporary directories
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
    if (outputDir) {
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('Docker Connectivity', () => {
    it('should be able to run a simple Docker command', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      // Test basic Docker functionality without workspace mounting
      mockDefinition.command = ['sh', '-c', 'echo "Hello Docker"'];
      dockerRunner = new DockerRunner('connectivity-test-runner', mockDefinition);

      // Use a simple context without workspace mounting for this test
      const simpleContext = { ...mockContext };

      const progressCallback = jest.fn();
      const result = await dockerRunner.execute(simpleContext, progressCallback);

      // Debug output if test fails
      if (!result.success) {
        console.log('Docker connectivity test failed:');
        console.log('Output:', result.output);
        console.log('Error:', result.error);
      }

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello Docker');
    });
  });

  describe('Workspace Mounting', () => {
    it('should mount workspace and access project files', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      // Configure runner to list files in workspace using sh to handle extra args
      mockDefinition.command = ['sh', '-c', 'ls -la /workspace'];
      dockerRunner = new DockerRunner('workspace-test-runner', mockDefinition);

      const progressCallback = jest.fn();
      const result = await dockerRunner.execute(mockContext, progressCallback);

      // Debug output if test fails
      if (!result.success) {
        console.log('Docker execution failed:');
        console.log('Output:', result.output);
        console.log('Error:', result.error);
      }

      expect(result.success).toBe(true);
      expect(result.output).toContain('package.json');
      expect(result.output).toContain('src');
      expect(result.output).toContain('test.js');
    });

    it('should access package.json from mounted workspace', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      // Configure runner to read package.json using sh to handle extra args
      mockDefinition.command = ['sh', '-c', 'cat /workspace/package.json'];
      dockerRunner = new DockerRunner('package-test-runner', mockDefinition);

      const progressCallback = jest.fn();
      const result = await dockerRunner.execute(mockContext, progressCallback);

      expect(result.success).toBe(true);
      expect(result.output).toContain('"name": "test-project"');
      expect(result.output).toContain('"version": "1.0.0"');
    });

    it('should run npm commands in mounted workspace', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      // Configure runner to run npm list using sh to handle extra args
      mockDefinition.command = ['sh', '-c', 'npm list --depth=0'];
      dockerRunner = new DockerRunner('npm-test-runner', mockDefinition);

      const progressCallback = jest.fn();
      const result = await dockerRunner.execute(mockContext, progressCallback);

      expect(result.success).toBe(true);
      expect(result.output).toContain('test-project@1.0.0');
    });

    it('should execute test files from mounted workspace', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      // Configure runner to execute the test file using sh to handle extra args
      mockDefinition.command = ['sh', '-c', 'node /workspace/test.js'];
      dockerRunner = new DockerRunner('test-execution-runner', mockDefinition);

      const progressCallback = jest.fn();
      const result = await dockerRunner.execute(mockContext, progressCallback);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Test executed successfully');
      expect(result.output).toContain('Workspace files accessible');
    });

    it('should write files to mounted workspace', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      // Configure runner to create a file in workspace
      mockDefinition.command = ['sh', '-c', 'echo "Integration test output" > /workspace/integration-test-output.txt && cat /workspace/integration-test-output.txt'];
      dockerRunner = new DockerRunner('write-test-runner', mockDefinition);

      const progressCallback = jest.fn();
      const result = await dockerRunner.execute(mockContext, progressCallback);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Integration test output');

      // Verify file was created on host
      const outputFile = path.join(tempDir, 'integration-test-output.txt');
      const fileExists = await fs.access(outputFile).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      const fileContent = await fs.readFile(outputFile, 'utf-8');
      expect(fileContent.trim()).toBe('Integration test output');
    });
  });

  describe('Volume Mount Compatibility', () => {
    it('should work with custom volumes alongside workspace mount', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      // Create a custom volume directory
      const customVolumeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'custom-volume-'));
      await fs.writeFile(path.join(customVolumeDir, 'custom-data.txt'), 'Custom volume data');

      try {
        // Configure runner with custom volume
        mockDefinition.volumes = [`${customVolumeDir}:/custom-data`];
        mockDefinition.command = ['sh', '-c', 'ls -la /workspace && echo "---" && ls -la /custom-data'];
        dockerRunner = new DockerRunner('volume-compatibility-runner', mockDefinition);

        const progressCallback = jest.fn();
        const result = await dockerRunner.execute(mockContext, progressCallback);

        expect(result.success).toBe(true);
        // Should see workspace files
        expect(result.output).toContain('package.json');
        // Should see custom volume files
        expect(result.output).toContain('custom-data.txt');
      } finally {
        await fs.rm(customVolumeDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should preserve output directory mount alongside workspace mount', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      // Configure runner to write to both workspace and output directory
      mockDefinition.command = [
        'sh', '-c', 
        'echo "workspace file" > /workspace/workspace-output.txt && ' +
        'echo "test results" > /test-results/test-output.txt && ' +
        'ls -la /workspace && echo "---" && ls -la /test-results'
      ];
      dockerRunner = new DockerRunner('output-compatibility-runner', mockDefinition);

      const progressCallback = jest.fn();
      const result = await dockerRunner.execute(mockContext, progressCallback);

      expect(result.success).toBe(true);
      expect(result.output).toContain('workspace-output.txt');
      expect(result.output).toContain('test-output.txt');

      // Verify files were created in correct locations
      const workspaceFile = path.join(tempDir, 'workspace-output.txt');
      const outputFile = path.join(outputDir, 'test-output.txt');

      const workspaceFileExists = await fs.access(workspaceFile).then(() => true).catch(() => false);
      const outputFileExists = await fs.access(outputFile).then(() => true).catch(() => false);

      expect(workspaceFileExists).toBe(true);
      expect(outputFileExists).toBe(true);

      const workspaceContent = await fs.readFile(workspaceFile, 'utf-8');
      const outputContent = await fs.readFile(outputFile, 'utf-8');

      expect(workspaceContent.trim()).toBe('workspace file');
      expect(outputContent.trim()).toBe('test results');
    });
  });

  describe('Cross-Platform Path Handling', () => {
    it('should handle paths with spaces', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      // Create workspace with spaces in path
      const spacedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spaced dir '));
      await createTestProject(spacedDir);

      try {
        mockContext.workingDirectory = spacedDir;
        mockDefinition.command = ['sh', '-c', 'ls -la /workspace'];
        dockerRunner = new DockerRunner('spaced-path-runner', mockDefinition);

        const progressCallback = jest.fn();
        const result = await dockerRunner.execute(mockContext, progressCallback);

        expect(result.success).toBe(true);
        expect(result.output).toContain('package.json');
      } finally {
        await fs.rm(spacedDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should handle relative paths correctly', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      // Use relative path for working directory
      const originalCwd = process.cwd();
      const relativePath = path.relative(originalCwd, tempDir);

      try {
        mockContext.workingDirectory = relativePath;
        mockDefinition.command = ['sh', '-c', 'pwd && ls -la'];
        dockerRunner = new DockerRunner('relative-path-runner', mockDefinition);

        const progressCallback = jest.fn();
        const result = await dockerRunner.execute(mockContext, progressCallback);

        expect(result.success).toBe(true);
        expect(result.output).toContain('/workspace');
        expect(result.output).toContain('package.json');
      } finally {
        // Restore original working directory if needed
      }
    });
  });

  describe('Error Scenarios', () => {
    it('should handle non-existent workspace directory', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      const nonExistentDir = path.join(tempDir, 'nonexistent');
      mockContext.workingDirectory = nonExistentDir;

      const progressCallback = jest.fn();

      await expect(dockerRunner.execute(mockContext, progressCallback))
        .rejects.toThrow('Failed to build Docker arguments for workspace mounting');
    });

    it('should provide helpful error messages for mount failures', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      // Create a file instead of directory to trigger mount error
      const filePath = path.join(tempDir, 'not-a-directory.txt');
      await fs.writeFile(filePath, 'test');

      mockContext.workingDirectory = filePath;

      const progressCallback = jest.fn();

      await expect(dockerRunner.execute(mockContext, progressCallback))
        .rejects.toThrow('is not a directory');
    });

    it('should handle deeply nested non-existent paths', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      const deepPath = path.join(tempDir, 'level1', 'level2', 'level3', 'nonexistent');
      mockContext.workingDirectory = deepPath;

      const progressCallback = jest.fn();

      await expect(dockerRunner.execute(mockContext, progressCallback))
        .rejects.toThrow('Failed to build Docker arguments for workspace mounting');
    });

    it('should handle permission denied scenarios gracefully', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      // On most systems, /root is not accessible to regular users
      const restrictedPath = '/root/workspace';
      mockContext.workingDirectory = restrictedPath;

      const progressCallback = jest.fn();

      // This should fail during path validation, not Docker execution
      await expect(dockerRunner.execute(mockContext, progressCallback))
        .rejects.toThrow(/Failed to build Docker arguments for workspace mounting|permission denied/);
    });

    it('should handle relative paths that resolve to non-existent directories', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      const relativePath = '../nonexistent-relative-workspace';
      mockContext.workingDirectory = relativePath;

      const progressCallback = jest.fn();

      await expect(dockerRunner.execute(mockContext, progressCallback))
        .rejects.toThrow('Failed to build Docker arguments for workspace mounting');
    });

    it('should provide clear error context for workspace mounting failures', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      const nonExistentPath = path.join(tempDir, 'definitely-does-not-exist');
      mockContext.workingDirectory = nonExistentPath;

      const progressCallback = jest.fn();

      try {
        await dockerRunner.execute(mockContext, progressCallback);
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.message).toContain('Failed to build Docker arguments for workspace mounting');
        expect(error.message).toContain(nonExistentPath);
      }
    });
  });

  describe('Special Character Path Handling', () => {
    it('should handle workspace paths with spaces in integration', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      // Create workspace with spaces in path
      const spacedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'integration spaced dir '));
      await createTestProject(spacedDir);

      try {
        mockContext.workingDirectory = spacedDir;
        mockDefinition.command = ['sh', '-c', 'echo "Workspace with spaces works" && ls -la /workspace'];
        dockerRunner = new DockerRunner('spaced-integration-runner', mockDefinition);

        const progressCallback = jest.fn();
        const result = await dockerRunner.execute(mockContext, progressCallback);

        expect(result.success).toBe(true);
        expect(result.output).toContain('Workspace with spaces works');
        expect(result.output).toContain('package.json');
      } finally {
        await fs.rm(spacedDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should handle workspace paths with special characters in integration', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      // Create workspace with special characters (avoiding problematic ones for file systems)
      const specialDir = await fs.mkdtemp(path.join(os.tmpdir(), 'integration-special_chars-'));
      await createTestProject(specialDir);

      try {
        mockContext.workingDirectory = specialDir;
        mockDefinition.command = ['sh', '-c', 'echo "Special chars workspace works" && ls -la /workspace'];
        dockerRunner = new DockerRunner('special-chars-integration-runner', mockDefinition);

        const progressCallback = jest.fn();
        const result = await dockerRunner.execute(mockContext, progressCallback);

        expect(result.success).toBe(true);
        expect(result.output).toContain('Special chars workspace works');
        expect(result.output).toContain('package.json');
      } finally {
        await fs.rm(specialDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should handle very long workspace paths in integration', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      // Create workspace with long path (within filesystem limits)
      const longDirName = 'very-long-directory-name-for-integration-testing-'.repeat(3);
      const longDir = await fs.mkdtemp(path.join(os.tmpdir(), longDirName));
      await createTestProject(longDir);

      try {
        mockContext.workingDirectory = longDir;
        mockDefinition.command = ['sh', '-c', 'echo "Long path workspace works" && ls -la /workspace'];
        dockerRunner = new DockerRunner('long-path-integration-runner', mockDefinition);

        const progressCallback = jest.fn();
        const result = await dockerRunner.execute(mockContext, progressCallback);

        expect(result.success).toBe(true);
        expect(result.output).toContain('Long path workspace works');
        expect(result.output).toContain('package.json');
      } finally {
        await fs.rm(longDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should handle relative paths with special patterns in integration', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        return;
      }

      // Test with current directory reference
      const originalCwd = process.cwd();
      
      try {
        // Change to temp directory and use relative path
        process.chdir(tempDir);
        mockContext.workingDirectory = '.';
        mockDefinition.command = ['sh', '-c', 'echo "Relative path works" && pwd && ls -la'];
        dockerRunner = new DockerRunner('relative-path-integration-runner', mockDefinition);

        const progressCallback = jest.fn();
        const result = await dockerRunner.execute(mockContext, progressCallback);

        expect(result.success).toBe(true);
        expect(result.output).toContain('Relative path works');
        expect(result.output).toContain('/workspace');
        expect(result.output).toContain('package.json');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('Error Message Validation in Integration', () => {
    it('should provide detailed error information for Docker mount failures', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      // Use a path that will cause Docker mount issues (file instead of directory)
      const filePath = path.join(tempDir, 'not-a-directory.txt');
      await fs.writeFile(filePath, 'This is a file, not a directory');

      mockContext.workingDirectory = filePath;
      mockDefinition.command = ['sh', '-c', 'echo "This should not run"'];
      dockerRunner = new DockerRunner('mount-error-runner', mockDefinition);

      const progressCallback = jest.fn();

      try {
        await dockerRunner.execute(mockContext, progressCallback);
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.message).toMatch(/Failed to build Docker arguments for workspace mounting|is not a directory/);
        expect(error.message).toContain(filePath);
      }
    });

    it('should handle Docker daemon connection errors gracefully', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available - this is expected for this test');
        
        // Test behavior when Docker is not available
        mockDefinition.command = ['sh', '-c', 'echo "test"'];
        dockerRunner = new DockerRunner('no-docker-runner', mockDefinition);

        const progressCallback = jest.fn();

        try {
          await dockerRunner.execute(mockContext, progressCallback);
          // If this doesn't throw, Docker might be available after all
        } catch (error: any) {
          // Should get a meaningful error about Docker not being available
          expect(error.message).toMatch(/docker|Docker|spawn|ENOENT/i);
        }
        return;
      }

      // If Docker is available, we can't easily test daemon connection errors
      // without stopping Docker, so we'll skip this specific scenario
      console.log('Docker is available, skipping daemon connection error test');
    });

    it('should preserve error context through the execution chain', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      const nonExistentPath = path.join(tempDir, 'chain-error-test', 'nonexistent');
      mockContext.workingDirectory = nonExistentPath;

      const progressCallback = jest.fn();

      try {
        await dockerRunner.execute(mockContext, progressCallback);
        fail('Expected error to be thrown');
      } catch (error: any) {
        // Verify error chain preserves context
        expect(error.message).toContain('Failed to build Docker arguments for workspace mounting');
        expect(error.message).toContain(nonExistentPath);
        
        // Should have cause chain
        if (error.cause) {
          expect(error.cause.message).toMatch(/directory.*not.*accessible|no such file or directory/i);
        }
      }
    });
  });

  describe('Environment Integration', () => {
    it('should pass environment variables to container with workspace access', async () => {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        console.warn('Skipping test: Docker not available');
        return;
      }

      mockContext.environment = {
        TEST_VAR: 'integration-test-value',
        NODE_ENV: 'test'
      };

      mockDefinition.command = [
        'sh', '-c', 
        'echo "TEST_VAR=$TEST_VAR" && echo "NODE_ENV=$NODE_ENV" && ls /workspace'
      ];
      dockerRunner = new DockerRunner('env-integration-runner', mockDefinition);

      const progressCallback = jest.fn();
      const result = await dockerRunner.execute(mockContext, progressCallback);

      expect(result.success).toBe(true);
      expect(result.output).toContain('TEST_VAR=integration-test-value');
      expect(result.output).toContain('NODE_ENV=test');
      expect(result.output).toContain('package.json');
    });
  });
});

/**
 * Helper function to create a minimal test project structure
 */
async function createTestProject(projectDir: string): Promise<void> {
  // Create package.json
  const packageJson = {
    name: 'test-project',
    version: '1.0.0',
    description: 'Integration test project',
    main: 'index.js',
    scripts: {
      test: 'node test.js'
    }
  };

  await fs.writeFile(
    path.join(projectDir, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );

  // Create src directory
  const srcDir = path.join(projectDir, 'src');
  await fs.mkdir(srcDir, { recursive: true });

  // Create a simple index.js file
  await fs.writeFile(
    path.join(srcDir, 'index.js'),
    `console.log('Hello from test project');
module.exports = { message: 'Test project loaded' };`
  );

  // Create a test file
  await fs.writeFile(
    path.join(projectDir, 'test.js'),
    `const fs = require('fs');
const path = require('path');

console.log('Test executed successfully');

// Verify workspace files are accessible
try {
  const packageJson = JSON.parse(fs.readFileSync('/workspace/package.json', 'utf-8'));
  console.log('Workspace files accessible: package.json found');
  console.log('Project name:', packageJson.name);
} catch (error) {
  console.error('Failed to access workspace files:', error.message);
  process.exit(1);
}

// Verify src directory is accessible
try {
  const srcFiles = fs.readdirSync('/workspace/src');
  console.log('Source files found:', srcFiles.join(', '));
} catch (error) {
  console.error('Failed to access src directory:', error.message);
  process.exit(1);
}

console.log('All workspace accessibility tests passed');`
  );

  // Create README.md
  await fs.writeFile(
    path.join(projectDir, 'README.md'),
    `# Test Project

This is a test project for Docker runner integration tests.

## Files
- package.json: Project configuration
- src/index.js: Main application file
- test.js: Test file that verifies workspace mounting
`
  );
}