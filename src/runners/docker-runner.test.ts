/**
 * Docker runner tests
 */

import { DockerRunner } from './docker-runner';
import { RunnerDefinition } from '../config/types';
import { RunnerExecutionContext } from './types';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock fs module
jest.mock('fs/promises');
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock child_process
jest.mock('child_process');

describe('DockerRunner', () => {
  let dockerRunner: DockerRunner;
  let mockDefinition: RunnerDefinition;
  let mockContext: RunnerExecutionContext;

  beforeEach(() => {
    mockDefinition = {
      type: 'docker',
      image: 'node:18-alpine',
      command: ['npm', 'test'],
      timeout: 30000,
      environment: {}
    };

    dockerRunner = new DockerRunner('test-runner', mockDefinition);

    mockContext = {
      runId: 'test-run-123',
      suite: 'test-suite',
      runner: 'test-runner',
      options: {
        target: 'local',
        tags: 'smoke',
        parallel: false,
        timeout: 30000,
        environment: {}
      },
      workingDirectory: '/test/workspace',
      outputDirectory: '/test/output',
      environment: {}
    };

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('validateAndResolveWorkspacePath', () => {
    it('should resolve and validate existing directory', async () => {
      const testPath = '/test/workspace';
      const resolvedPath = path.resolve(testPath);
      
      // Mock fs.access to succeed
      mockFs.access.mockResolvedValue(undefined);
      
      // Mock fs.stat to return directory stats
      mockFs.stat.mockResolvedValue({
        isDirectory: () => true
      } as any);

      // Access private method for testing
      const result = await (dockerRunner as any).validateAndResolveWorkspacePath(testPath);

      expect(result).toBe(resolvedPath);
      expect(mockFs.access).toHaveBeenCalledWith(resolvedPath, fs.constants.R_OK);
      expect(mockFs.stat).toHaveBeenCalledWith(resolvedPath);
    });

    it('should throw error for non-existent directory', async () => {
      const testPath = '/nonexistent/path';
      
      // Mock fs.access to throw ENOENT error
      const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockFs.access.mockRejectedValue(error);

      await expect((dockerRunner as any).validateAndResolveWorkspacePath(testPath))
        .rejects.toThrow("Workspace mount failed: directory");
    });

    it('should throw error for permission denied', async () => {
      const testPath = '/restricted/path';
      
      // Mock fs.access to throw EACCES error
      const error = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      mockFs.access.mockRejectedValue(error);

      await expect((dockerRunner as any).validateAndResolveWorkspacePath(testPath))
        .rejects.toThrow("Workspace mount failed: permission denied accessing directory");
    });

    it('should throw error if path is not a directory', async () => {
      const testPath = '/test/file.txt';
      const resolvedPath = path.resolve(testPath);
      
      // Mock fs.access to succeed
      mockFs.access.mockResolvedValue(undefined);
      
      // Mock fs.stat to return file stats (not directory)
      mockFs.stat.mockResolvedValue({
        isDirectory: () => false
      } as any);

      await expect((dockerRunner as any).validateAndResolveWorkspacePath(testPath))
        .rejects.toThrow(`Workspace mount failed: path '${resolvedPath}' is not a directory`);
    });
  });

  describe('enhanceDockerError', () => {
    it('should enhance ENOENT errors with workspace mounting context', () => {
      const originalError = new Error('ENOENT: no such file or directory');
      
      const enhancedError = (dockerRunner as any).enhanceDockerError(originalError, mockContext);
      
      expect(enhancedError.message).toContain('Docker execution failed: ENOENT: no such file or directory');
      expect(enhancedError.message).toContain('This might be related to workspace mounting');
      expect(enhancedError.message).toContain('Docker is installed and running');
    });

    it('should enhance permission denied errors with suggestions', () => {
      const originalError = new Error('permission denied');
      
      const enhancedError = (dockerRunner as any).enhanceDockerError(originalError, mockContext);
      
      expect(enhancedError.message).toContain('Docker execution failed: permission denied');
      expect(enhancedError.message).toContain('This appears to be a permission issue');
      expect(enhancedError.message).toContain('Docker Desktop drive sharing settings');
    });

    it('should return original error if no enhancement applies', () => {
      const originalError = new Error('Some other error');
      
      const enhancedError = (dockerRunner as any).enhanceDockerError(originalError, mockContext);
      
      expect(enhancedError).toBe(originalError);
    });
  });

  describe('enhanceDockerMountError', () => {
    it('should enhance mount config errors with troubleshooting steps', () => {
      const stderr = 'docker: Error response from daemon: invalid mount config for type "bind"';
      
      const enhancedStderr = (dockerRunner as any).enhanceDockerMountError(stderr, mockContext);
      
      expect(enhancedStderr).toContain('Workspace mounting error detected');
      expect(enhancedStderr).toContain('Troubleshooting steps:');
      expect(enhancedStderr).toContain('Verify the workspace directory exists');
    });

    it('should enhance permission denied mount errors with platform-specific solutions', () => {
      const stderr = 'docker: Error response from daemon: permission denied while trying to mount';
      
      const enhancedStderr = (dockerRunner as any).enhanceDockerMountError(stderr, mockContext);
      
      expect(enhancedStderr).toContain('Docker permission error detected');
      expect(enhancedStderr).toContain('Enable drive sharing in Docker Desktop settings');
      expect(enhancedStderr).toContain('Full Disk Access permission');
    });

    it('should enhance invalid argument mount errors with path format suggestions', () => {
      const stderr = 'docker: Error response from daemon: invalid argument for mount';
      
      const enhancedStderr = (dockerRunner as any).enhanceDockerMountError(stderr, mockContext);
      
      expect(enhancedStderr).toContain('Docker mount argument error detected');
      expect(enhancedStderr).toContain('may contain invalid characters');
      expect(enhancedStderr).toContain('Use forward slashes or properly escaped backslashes');
    });

    it('should return original stderr if no enhancement applies', () => {
      const stderr = 'Some other docker error';
      
      const enhancedStderr = (dockerRunner as any).enhanceDockerMountError(stderr, mockContext);
      
      expect(enhancedStderr).toBe(stderr);
    });
  });

  describe('buildDockerArgs', () => {
    it('should include workspace mount with validated path', async () => {
      const testPath = '/test/workspace';
      const resolvedPath = path.resolve(testPath);
      
      // Mock successful path validation
      mockFs.access.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({
        isDirectory: () => true
      } as any);

      const args = await (dockerRunner as any).buildDockerArgs(mockContext);

      expect(args).toContain('-v');
      expect(args).toContain(`${resolvedPath}:/workspace`);
      expect(args).toContain('-w');
      expect(args).toContain('/workspace');
    });

    it('should handle relative paths correctly', async () => {
      const relativePath = './test/workspace';
      const resolvedPath = path.resolve(relativePath);
      
      mockContext.workingDirectory = relativePath;
      
      // Mock successful path validation
      mockFs.access.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({
        isDirectory: () => true
      } as any);

      const args = await (dockerRunner as any).buildDockerArgs(mockContext);

      expect(args).toContain(`${resolvedPath}:/workspace`);
      expect(mockFs.access).toHaveBeenCalledWith(resolvedPath, fs.constants.R_OK);
    });

    it('should handle Windows paths with backslashes', async () => {
      const windowsPath = 'C:\\Users\\test\\workspace';
      const resolvedPath = path.resolve(windowsPath);
      
      mockContext.workingDirectory = windowsPath;
      
      // Mock successful path validation
      mockFs.access.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({
        isDirectory: () => true
      } as any);

      const args = await (dockerRunner as any).buildDockerArgs(mockContext);

      expect(args).toContain(`${resolvedPath}:/workspace`);
      expect(mockFs.access).toHaveBeenCalledWith(resolvedPath, fs.constants.R_OK);
    });

    it('should handle paths with spaces correctly', async () => {
      const pathWithSpaces = '/test/my workspace/project';
      const resolvedPath = path.resolve(pathWithSpaces);
      
      mockContext.workingDirectory = pathWithSpaces;
      
      // Mock successful path validation
      mockFs.access.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({
        isDirectory: () => true
      } as any);

      const args = await (dockerRunner as any).buildDockerArgs(mockContext);

      expect(args).toContain(`${resolvedPath}:/workspace`);
      expect(mockFs.access).toHaveBeenCalledWith(resolvedPath, fs.constants.R_OK);
    });

    it('should maintain correct mount argument order', async () => {
      // Add custom volumes to test ordering
      mockDefinition.volumes = ['/host/custom:/container/custom'];
      dockerRunner = new DockerRunner('test-runner', mockDefinition);
      
      // Mock successful path validation
      mockFs.access.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({
        isDirectory: () => true
      } as any);

      const args = await (dockerRunner as any).buildDockerArgs(mockContext);

      // Find indices of different mount types
      const customVolumeIndex = args.findIndex((arg: string) => arg === '/host/custom:/container/custom');
      const workspaceMountIndex = args.findIndex((arg: string) => arg.includes(':/workspace'));
      const outputMountIndex = args.findIndex((arg: string) => arg.includes(':/test-results'));
      const workingDirIndex = args.findIndex((arg: string) => arg === '/workspace');

      // Verify order: custom volumes -> workspace mount -> output mount -> working directory
      expect(customVolumeIndex).toBeLessThan(workspaceMountIndex);
      expect(workspaceMountIndex).toBeLessThan(outputMountIndex);
      expect(outputMountIndex).toBeLessThan(workingDirIndex);
    });

    it('should format workspace mount correctly', async () => {
      const testPath = '/test/workspace';
      const resolvedPath = path.resolve(testPath);
      
      // Mock successful path validation
      mockFs.access.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({
        isDirectory: () => true
      } as any);

      const args = await (dockerRunner as any).buildDockerArgs(mockContext);

      // Find the workspace mount argument
      const volumeIndex = args.findIndex((arg: string) => arg.includes(':/workspace'));
      expect(volumeIndex).toBeGreaterThan(-1);
      
      const volumeMount = args[volumeIndex];
      expect(volumeMount).toBe(`${resolvedPath}:/workspace`);
      
      // Verify it's preceded by -v flag
      expect(args[volumeIndex - 1]).toBe('-v');
    });

    it('should include all required Docker arguments with workspace mount', async () => {
      // Mock successful path validation
      mockFs.access.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({
        isDirectory: () => true
      } as any);

      const args = await (dockerRunner as any).buildDockerArgs(mockContext);

      // Verify basic Docker run structure
      expect(args[0]).toBe('docker');
      expect(args[1]).toBe('run');
      expect(args[2]).toBe('--rm');
      
      // Verify workspace mount is present
      expect(args).toContain('-v');
      expect(args.some((arg: string) => arg.includes(':/workspace'))).toBe(true);
      
      // Verify working directory is set
      expect(args).toContain('-w');
      expect(args).toContain('/workspace');
      
      // Verify output directory mount
      expect(args.some((arg: string) => arg.includes(':/test-results'))).toBe(true);
      
      // Verify image is included
      expect(args).toContain('node:18-alpine');
    });

    it('should throw error when workspace path validation fails', async () => {
      const testPath = '/nonexistent/workspace';
      
      // Mock fs.access to throw ENOENT error
      const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockFs.access.mockRejectedValue(error);

      await expect((dockerRunner as any).buildDockerArgs(mockContext))
        .rejects.toThrow('Failed to build Docker arguments for workspace mounting');
    });

    it('should handle environment variables correctly with workspace mount', async () => {
      // Add environment variables to context
      mockContext.environment = {
        NODE_ENV: 'test',
        DEBUG: 'true'
      };
      
      // Mock successful path validation
      mockFs.access.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({
        isDirectory: () => true
      } as any);

      const args = await (dockerRunner as any).buildDockerArgs(mockContext);

      // Verify environment variables are included
      expect(args).toContain('-e');
      expect(args).toContain('NODE_ENV=test');
      expect(args).toContain('DEBUG=true');
      
      // Verify workspace mount is still present
      expect(args.some((arg: string) => arg.includes(':/workspace'))).toBe(true);
    });

    it('should preserve custom volumes alongside workspace mount', async () => {
      // Add custom volumes
      mockDefinition.volumes = [
        '/host/data:/container/data',
        '/host/config:/container/config:ro'
      ];
      dockerRunner = new DockerRunner('test-runner', mockDefinition);
      
      // Mock successful path validation
      mockFs.access.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({
        isDirectory: () => true
      } as any);

      const args = await (dockerRunner as any).buildDockerArgs(mockContext);

      // Verify custom volumes are present
      expect(args).toContain('/host/data:/container/data');
      expect(args).toContain('/host/config:/container/config:ro');
      
      // Verify workspace mount is also present
      expect(args.some((arg: string) => arg.includes(':/workspace'))).toBe(true);
      
      // Count total volume mounts (custom + workspace + output)
      const volumeCount = args.filter((arg: string) => arg === '-v').length;
      expect(volumeCount).toBe(4); // 2 custom + 1 workspace + 1 output
    });
  });

  describe('Error Scenarios and Edge Cases', () => {
    describe('Non-existent working directory scenarios', () => {
      it('should throw specific error for completely non-existent path', async () => {
        const nonExistentPath = '/completely/nonexistent/path/that/does/not/exist';
        mockContext.workingDirectory = nonExistentPath;
        
        const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        mockFs.access.mockRejectedValue(error);

        await expect((dockerRunner as any).buildDockerArgs(mockContext))
          .rejects.toThrow('Failed to build Docker arguments for workspace mounting');
        
        // Verify the underlying validation was called
        expect(mockFs.access).toHaveBeenCalledWith(path.resolve(nonExistentPath), fs.constants.R_OK);
      });

      it('should throw specific error for nested non-existent path', async () => {
        const nestedPath = '/existing/parent/nonexistent/child/workspace';
        mockContext.workingDirectory = nestedPath;
        
        const error = new Error('ENOENT: no such file or directory, access \'/existing/parent/nonexistent/child/workspace\'') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        error.path = nestedPath;
        mockFs.access.mockRejectedValue(error);

        await expect((dockerRunner as any).buildDockerArgs(mockContext))
          .rejects.toThrow('Failed to build Docker arguments for workspace mounting');
      });

      it('should handle relative path that resolves to non-existent directory', async () => {
        const relativePath = '../nonexistent/workspace';
        mockContext.workingDirectory = relativePath;
        
        const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        mockFs.access.mockRejectedValue(error);

        await expect((dockerRunner as any).buildDockerArgs(mockContext))
          .rejects.toThrow('Failed to build Docker arguments for workspace mounting');
        
        // Verify path was resolved before validation
        expect(mockFs.access).toHaveBeenCalledWith(path.resolve(relativePath), fs.constants.R_OK);
      });

      it('should handle empty or undefined working directory', async () => {
        mockContext.workingDirectory = '';
        
        const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        mockFs.access.mockRejectedValue(error);

        await expect((dockerRunner as any).buildDockerArgs(mockContext))
          .rejects.toThrow('Failed to build Docker arguments for workspace mounting');
      });
    });

    describe('Path validation error handling and messaging', () => {
      it('should provide clear error message for permission denied', async () => {
        const restrictedPath = '/root/restricted/workspace';
        mockContext.workingDirectory = restrictedPath;
        
        const error = new Error('EACCES: permission denied, access \'/root/restricted/workspace\'') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        error.path = restrictedPath;
        mockFs.access.mockRejectedValue(error);

        try {
          await (dockerRunner as any).buildDockerArgs(mockContext);
          fail('Expected error to be thrown');
        } catch (thrownError: any) {
          expect(thrownError.message).toContain('Failed to build Docker arguments for workspace mounting');
          expect(thrownError.message).toContain('permission denied accessing directory');
        }
      });

      it('should provide clear error message when path is not a directory', async () => {
        const filePath = '/test/file.txt';
        mockContext.workingDirectory = filePath;
        
        // Mock fs.access to succeed (file exists)
        mockFs.access.mockResolvedValue(undefined);
        
        // Mock fs.stat to return file stats (not directory)
        mockFs.stat.mockResolvedValue({
          isDirectory: () => false
        } as any);

        try {
          await (dockerRunner as any).buildDockerArgs(mockContext);
          fail('Expected error to be thrown');
        } catch (thrownError: any) {
          expect(thrownError.message).toContain('Failed to build Docker arguments for workspace mounting');
          expect(thrownError.message).toContain('is not a directory');
        }
      });

      it('should handle file system errors with detailed context', async () => {
        const problematicPath = '/test/problematic/workspace';
        mockContext.workingDirectory = problematicPath;
        
        const error = new Error('EIO: i/o error, access \'/test/problematic/workspace\'') as NodeJS.ErrnoException;
        error.code = 'EIO';
        error.path = problematicPath;
        mockFs.access.mockRejectedValue(error);

        try {
          await (dockerRunner as any).buildDockerArgs(mockContext);
          fail('Expected error to be thrown');
        } catch (thrownError: any) {
          expect(thrownError.message).toContain('Failed to build Docker arguments for workspace mounting');
          expect(thrownError.message).toContain('EIO: i/o error');
        }
      });

      it('should handle stat errors after successful access check', async () => {
        const testPath = '/test/workspace';
        mockContext.workingDirectory = testPath;
        
        // Mock fs.access to succeed
        mockFs.access.mockResolvedValue(undefined);
        
        // Mock fs.stat to fail
        const statError = new Error('EACCES: permission denied, stat \'/test/workspace\'') as NodeJS.ErrnoException;
        statError.code = 'EACCES';
        mockFs.stat.mockRejectedValue(statError);

        try {
          await (dockerRunner as any).buildDockerArgs(mockContext);
          fail('Expected error to be thrown');
        } catch (thrownError: any) {
          expect(thrownError.message).toContain('Failed to build Docker arguments for workspace mounting');
          expect(thrownError.message).toContain('permission denied accessing directory');
        }
      });
    });

    describe('Paths with spaces and special characters', () => {
      it('should handle paths with spaces correctly', async () => {
        const pathWithSpaces = '/test/my workspace/project folder';
        mockContext.workingDirectory = pathWithSpaces;
        const resolvedPath = path.resolve(pathWithSpaces);
        
        // Mock successful path validation
        mockFs.access.mockResolvedValue(undefined);
        mockFs.stat.mockResolvedValue({
          isDirectory: () => true
        } as any);

        const args = await (dockerRunner as any).buildDockerArgs(mockContext);

        // Verify workspace mount includes the full path with spaces
        expect(args).toContain(`${resolvedPath}:/workspace`);
        expect(mockFs.access).toHaveBeenCalledWith(resolvedPath, fs.constants.R_OK);
      });

      it('should handle paths with multiple consecutive spaces', async () => {
        const pathWithMultipleSpaces = '/test/my   workspace/project    folder';
        mockContext.workingDirectory = pathWithMultipleSpaces;
        const resolvedPath = path.resolve(pathWithMultipleSpaces);
        
        // Mock successful path validation
        mockFs.access.mockResolvedValue(undefined);
        mockFs.stat.mockResolvedValue({
          isDirectory: () => true
        } as any);

        const args = await (dockerRunner as any).buildDockerArgs(mockContext);

        expect(args).toContain(`${resolvedPath}:/workspace`);
        expect(mockFs.access).toHaveBeenCalledWith(resolvedPath, fs.constants.R_OK);
      });

      it('should handle paths with special characters', async () => {
        const pathWithSpecialChars = '/test/my-workspace_v2/project[1]/folder(test)';
        mockContext.workingDirectory = pathWithSpecialChars;
        const resolvedPath = path.resolve(pathWithSpecialChars);
        
        // Mock successful path validation
        mockFs.access.mockResolvedValue(undefined);
        mockFs.stat.mockResolvedValue({
          isDirectory: () => true
        } as any);

        const args = await (dockerRunner as any).buildDockerArgs(mockContext);

        expect(args).toContain(`${resolvedPath}:/workspace`);
        expect(mockFs.access).toHaveBeenCalledWith(resolvedPath, fs.constants.R_OK);
      });

      it('should handle paths with Unicode characters', async () => {
        const pathWithUnicode = '/test/workspace-测试/项目文件夹';
        mockContext.workingDirectory = pathWithUnicode;
        const resolvedPath = path.resolve(pathWithUnicode);
        
        // Mock successful path validation
        mockFs.access.mockResolvedValue(undefined);
        mockFs.stat.mockResolvedValue({
          isDirectory: () => true
        } as any);

        const args = await (dockerRunner as any).buildDockerArgs(mockContext);

        expect(args).toContain(`${resolvedPath}:/workspace`);
        expect(mockFs.access).toHaveBeenCalledWith(resolvedPath, fs.constants.R_OK);
      });

      it('should handle Windows-style paths with spaces and backslashes', async () => {
        const windowsPathWithSpaces = 'C:\\Users\\Test User\\My Projects\\workspace folder';
        mockContext.workingDirectory = windowsPathWithSpaces;
        const resolvedPath = path.resolve(windowsPathWithSpaces);
        
        // Mock successful path validation
        mockFs.access.mockResolvedValue(undefined);
        mockFs.stat.mockResolvedValue({
          isDirectory: () => true
        } as any);

        const args = await (dockerRunner as any).buildDockerArgs(mockContext);

        expect(args).toContain(`${resolvedPath}:/workspace`);
        expect(mockFs.access).toHaveBeenCalledWith(resolvedPath, fs.constants.R_OK);
      });

      it('should handle paths with quotes and escape characters', async () => {
        const pathWithQuotes = '/test/workspace "quoted"/folder\'s content';
        mockContext.workingDirectory = pathWithQuotes;
        const resolvedPath = path.resolve(pathWithQuotes);
        
        // Mock successful path validation
        mockFs.access.mockResolvedValue(undefined);
        mockFs.stat.mockResolvedValue({
          isDirectory: () => true
        } as any);

        const args = await (dockerRunner as any).buildDockerArgs(mockContext);

        expect(args).toContain(`${resolvedPath}:/workspace`);
        expect(mockFs.access).toHaveBeenCalledWith(resolvedPath, fs.constants.R_OK);
      });

      it('should handle very long paths', async () => {
        const longPath = '/test/' + 'very-long-directory-name-'.repeat(10) + 'workspace';
        mockContext.workingDirectory = longPath;
        const resolvedPath = path.resolve(longPath);
        
        // Mock successful path validation
        mockFs.access.mockResolvedValue(undefined);
        mockFs.stat.mockResolvedValue({
          isDirectory: () => true
        } as any);

        const args = await (dockerRunner as any).buildDockerArgs(mockContext);

        expect(args).toContain(`${resolvedPath}:/workspace`);
        expect(mockFs.access).toHaveBeenCalledWith(resolvedPath, fs.constants.R_OK);
      });

      it('should handle paths with leading and trailing spaces', async () => {
        const pathWithLeadingTrailingSpaces = '  /test/workspace/project  ';
        mockContext.workingDirectory = pathWithLeadingTrailingSpaces;
        const resolvedPath = path.resolve(pathWithLeadingTrailingSpaces);
        
        // Mock successful path validation
        mockFs.access.mockResolvedValue(undefined);
        mockFs.stat.mockResolvedValue({
          isDirectory: () => true
        } as any);

        const args = await (dockerRunner as any).buildDockerArgs(mockContext);

        expect(args).toContain(`${resolvedPath}:/workspace`);
        expect(mockFs.access).toHaveBeenCalledWith(resolvedPath, fs.constants.R_OK);
      });
    });

    describe('Error message validation', () => {
      it('should include workspace path in error messages', async () => {
        const testPath = '/test/specific/workspace/path';
        mockContext.workingDirectory = testPath;
        
        const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        mockFs.access.mockRejectedValue(error);

        try {
          await (dockerRunner as any).buildDockerArgs(mockContext);
          fail('Expected error to be thrown');
        } catch (thrownError: any) {
          expect(thrownError.message).toContain('Failed to build Docker arguments for workspace mounting');
          // The path will be resolved to an absolute Windows path, so check for the resolved path
          expect(thrownError.message).toContain(path.resolve(testPath));
        }
      });

      it('should preserve original error details in error chain', async () => {
        const testPath = '/test/workspace';
        mockContext.workingDirectory = testPath;
        
        const originalError = new Error('Original file system error') as NodeJS.ErrnoException;
        originalError.code = 'EACCES';
        originalError.path = testPath;
        mockFs.access.mockRejectedValue(originalError);

        try {
          await (dockerRunner as any).buildDockerArgs(mockContext);
          fail('Expected error to be thrown');
        } catch (thrownError: any) {
          expect(thrownError.message).toContain('Failed to build Docker arguments for workspace mounting');
          expect(thrownError.message).toContain('permission denied accessing directory');
        }
      });

      it('should provide actionable error messages for common scenarios', async () => {
        const testPath = '/test/workspace';
        mockContext.workingDirectory = testPath;
        
        // Test permission denied scenario
        const permissionError = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
        permissionError.code = 'EACCES';
        mockFs.access.mockRejectedValue(permissionError);

        try {
          await (dockerRunner as any).buildDockerArgs(mockContext);
          fail('Expected error to be thrown');
        } catch (thrownError: any) {
          expect(thrownError.message).toContain('permission denied accessing directory');
          expect(thrownError.message).toContain(path.resolve(testPath));
        }
      });
    });

    describe('Edge cases with path resolution', () => {
      it('should handle current directory reference', async () => {
        const currentDirPath = '.';
        mockContext.workingDirectory = currentDirPath;
        const resolvedPath = path.resolve(currentDirPath);
        
        // Mock successful path validation
        mockFs.access.mockResolvedValue(undefined);
        mockFs.stat.mockResolvedValue({
          isDirectory: () => true
        } as any);

        const args = await (dockerRunner as any).buildDockerArgs(mockContext);

        expect(args).toContain(`${resolvedPath}:/workspace`);
        expect(mockFs.access).toHaveBeenCalledWith(resolvedPath, fs.constants.R_OK);
      });

      it('should handle parent directory references', async () => {
        const parentDirPath = '../workspace';
        mockContext.workingDirectory = parentDirPath;
        const resolvedPath = path.resolve(parentDirPath);
        
        // Mock successful path validation
        mockFs.access.mockResolvedValue(undefined);
        mockFs.stat.mockResolvedValue({
          isDirectory: () => true
        } as any);

        const args = await (dockerRunner as any).buildDockerArgs(mockContext);

        expect(args).toContain(`${resolvedPath}:/workspace`);
        expect(mockFs.access).toHaveBeenCalledWith(resolvedPath, fs.constants.R_OK);
      });

      it('should handle complex relative paths', async () => {
        const complexPath = './test/../workspace/./project/../final';
        mockContext.workingDirectory = complexPath;
        const resolvedPath = path.resolve(complexPath);
        
        // Mock successful path validation
        mockFs.access.mockResolvedValue(undefined);
        mockFs.stat.mockResolvedValue({
          isDirectory: () => true
        } as any);

        const args = await (dockerRunner as any).buildDockerArgs(mockContext);

        expect(args).toContain(`${resolvedPath}:/workspace`);
        expect(mockFs.access).toHaveBeenCalledWith(resolvedPath, fs.constants.R_OK);
      });

      it('should handle symlink resolution errors', async () => {
        const symlinkPath = '/test/symlink/workspace';
        mockContext.workingDirectory = symlinkPath;
        
        // Mock fs.access to succeed but stat to fail with symlink error
        mockFs.access.mockResolvedValue(undefined);
        
        const symlinkError = new Error('ELOOP: too many symbolic links encountered') as NodeJS.ErrnoException;
        symlinkError.code = 'ELOOP';
        mockFs.stat.mockRejectedValue(symlinkError);

        try {
          await (dockerRunner as any).buildDockerArgs(mockContext);
          fail('Expected error to be thrown');
        } catch (thrownError: any) {
          expect(thrownError.message).toContain('Failed to build Docker arguments for workspace mounting');
          expect(thrownError.message).toContain('ELOOP: too many symbolic links encountered');
        }
      });
    });
  });
});