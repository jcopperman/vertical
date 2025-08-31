/**
 * Tests for VersionCommand
 */

import { VersionCommand } from './version';
import { CommandContext } from './types';
import * as versionUtils from '../utils/version';

// Mock the version utilities
jest.mock('../utils/version');

describe('VersionCommand', () => {
  let versionCommand: VersionCommand;
  let mockContext: CommandContext;
  let mockGetVersion: jest.MockedFunction<typeof versionUtils.getVersion>;
  let mockGetBuildInfo: jest.MockedFunction<typeof versionUtils.getBuildInfo>;

  beforeEach(() => {
    versionCommand = new VersionCommand();
    mockContext = {
      verbose: false,
      logger: { debug: jest.fn(), error: jest.fn() },
    };

    mockGetVersion = versionUtils.getVersion as jest.MockedFunction<typeof versionUtils.getVersion>;
    mockGetBuildInfo = versionUtils.getBuildInfo as jest.MockedFunction<typeof versionUtils.getBuildInfo>;

    // Setup default mocks
    mockGetVersion.mockReturnValue('1.2.3');
    mockGetBuildInfo.mockReturnValue({
      version: '1.2.3',
      buildDate: '2023-12-01T10:00:00.000Z',
      nodeVersion: 'v18.17.0',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('command properties', () => {
    it('should have correct properties', () => {
      expect(versionCommand.name).toBe('version');
      expect(versionCommand.description).toBe('Display version and build information');
      expect(versionCommand.aliases).toEqual(['v']);
      expect(versionCommand.examples).toContain('otp version');
    });
  });

  describe('execute', () => {
    it('should show simple version by default', async () => {
      const result = await versionCommand.execute({}, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('1.2.3');
      expect(mockGetVersion).toHaveBeenCalled();
      expect(mockGetBuildInfo).not.toHaveBeenCalled();
    });

    it('should show detailed version when verbose context', async () => {
      const verboseContext = { ...mockContext, verbose: true };
      const result = await versionCommand.execute({}, verboseContext);
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('OTP CLI Version Information:');
      expect(result.message).toContain('Version:      1.2.3');
      expect(result.message).toContain('Build Date:   2023-12-01T10:00:00.000Z');
      expect(result.message).toContain('Node.js:      v18.17.0');
      expect(result.message).toContain('Platform:');
      expect(result.message).toContain('Runtime Information:');
      expect(mockGetBuildInfo).toHaveBeenCalled();
    });

    it('should show detailed version when verbose argument', async () => {
      const result = await versionCommand.execute({ verbose: true }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('OTP CLI Version Information:');
      expect(result.message).toContain('Version:      1.2.3');
      expect(mockGetBuildInfo).toHaveBeenCalled();
    });

    it('should include runtime information in detailed version', async () => {
      const result = await versionCommand.execute({ verbose: true }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Working Directory:');
      expect(result.message).toContain('Executable Path:');
      expect(result.message).toContain('Process ID:');
      expect(result.message).toContain('Memory Usage:');
    });

    it('should return build info as data in detailed version', async () => {
      const result = await versionCommand.execute({ verbose: true }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        version: '1.2.3',
        buildDate: '2023-12-01T10:00:00.000Z',
        nodeVersion: 'v18.17.0',
      });
    });

    it('should handle errors gracefully', async () => {
      mockGetVersion.mockImplementation(() => {
        throw new Error('Version error');
      });

      const result = await versionCommand.execute({}, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Version error');
      expect(result.exitCode).toBe(1);
    });

    it('should show environment information', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const result = await versionCommand.execute({ verbose: true }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Environment:  production');

      process.env.NODE_ENV = originalEnv;
    });

    it('should default to development environment', async () => {
      const originalEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;

      const result = await versionCommand.execute({ verbose: true }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Environment:  development');

      process.env.NODE_ENV = originalEnv;
    });
  });
});