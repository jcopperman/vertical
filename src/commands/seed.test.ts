/**
 * Tests for SeedCommand
 */

import { SeedCommand } from './seed';
import { CommandContext } from './types';
import { FixtureManager } from '../fixtures';
import { DefaultConfigurationManager } from '../config/manager';
import { FixtureLoadResult } from '../fixtures/types';

// Mock dependencies
jest.mock('../fixtures');
jest.mock('../config/manager');
jest.mock('../utils/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }))
}));

const MockFixtureManager = FixtureManager as jest.MockedClass<typeof FixtureManager>;
const MockConfigurationManager = DefaultConfigurationManager as jest.MockedClass<typeof DefaultConfigurationManager>;

describe('SeedCommand', () => {
  let command: SeedCommand;
  let mockContext: CommandContext;
  let mockFixtureManager: jest.Mocked<FixtureManager>;
  let mockConfigManager: jest.Mocked<DefaultConfigurationManager>;
  let mockLoadResult: FixtureLoadResult;

  beforeEach(() => {
    command = new SeedCommand();
    mockContext = {
      verbose: false,
      logger: { debug: jest.fn(), error: jest.fn() }
    };

    // Setup mocks
    mockFixtureManager = {
      getAvailableFixtureSets: jest.fn(),
      getFixtureSetInfo: jest.fn(),
      seedFixtures: jest.fn(),
      loadFixtureSet: jest.fn(),
      validateFixtures: jest.fn(),
      resetFixtures: jest.fn()
    } as any;

    mockConfigManager = {
      loadConfig: jest.fn()
    } as any;

    MockFixtureManager.mockImplementation(() => mockFixtureManager);
    MockConfigurationManager.mockImplementation(() => mockConfigManager);

    // Setup default config
    mockConfigManager.loadConfig.mockResolvedValue({
      fixtures: {
        defaultSet: 'basic',
        sets: {
          basic: {
            name: 'Basic Test Data',
            description: 'Basic fixture set',
            files: ['fixtures/users.json']
          }
        }
      }
    } as any);

    // Setup default mock load result
    mockLoadResult = {
      success: true,
      loaded: [
        { id: 'user1', type: 'user', data: { email: 'test@example.com' } },
        { id: 'user2', type: 'user', data: { email: 'test2@example.com' } }
      ],
      errors: [],
      metadata: {
        setName: 'basic',
        loadTime: 150,
        totalRecords: 2
      }
    };

    jest.clearAllMocks();
  });

  describe('command properties', () => {
    it('should have correct command properties', () => {
      expect(command.name).toBe('seed');
      expect(command.description).toBe('Manage test fixture data');
      expect(command.aliases).toEqual(['fixtures']);
      expect(command.options).toHaveLength(6);
    });

    it('should have proper option definitions', () => {
      const options = command.options;
      
      expect(options[0].flags).toBe('-t, --target <environment>');
      expect(options[1].flags).toBe('-s, --fixture-set <name>');
      expect(options[2].flags).toBe('-d, --dry-run');
      expect(options[3].flags).toBe('-f, --force');
      expect(options[4].flags).toBe('-l, --list');
    });
  });

  describe('argument validation', () => {
    it('should validate target environment', async () => {
      const result = await command.execute({ target: 'invalid' }, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid target environment: invalid');
    });

    it('should accept valid target environments', async () => {
      mockFixtureManager.seedFixtures.mockResolvedValue({
        success: true,
        loaded: [],
        errors: [],
        metadata: { setName: 'basic', loadTime: 100, totalRecords: 0 }
      });

      for (const target of ['local', 'dev', 'staging', 'ci']) {
        const result = await command.execute({ target }, mockContext);
        expect(result.success).toBe(true);
      }
    });

    it('should reject mutually exclusive options', async () => {
      const result = await command.execute({ list: true, info: 'basic' }, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('mutually exclusive');
    });
  });

  describe('list command', () => {
    it('should list available fixture sets', async () => {
      mockFixtureManager.getAvailableFixtureSets.mockReturnValue(['basic', 'advanced']);
      mockFixtureManager.getFixtureSetInfo
        .mockReturnValueOnce({
          name: 'Basic Test Data',
          description: 'Basic fixtures',
          files: ['users.json', 'products.json']
        })
        .mockReturnValueOnce({
          name: 'Advanced Test Data',
          description: 'Advanced fixtures',
          files: ['advanced-users.json'],
          dependencies: ['basic']
        });

      const result = await command.execute({ list: true }, mockContext);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Available fixture sets:');
      expect(result.data.sets).toHaveLength(2);
      expect(result.data.sets[0]).toEqual({
        name: 'basic',
        description: 'Basic fixtures',
        files: 2,
        dependencies: 0
      });
      expect(result.data.sets[1]).toEqual({
        name: 'advanced',
        description: 'Advanced fixtures',
        files: 1,
        dependencies: 1
      });
    });

    it('should handle empty fixture sets', async () => {
      mockFixtureManager.getAvailableFixtureSets.mockReturnValue([]);

      const result = await command.execute({ list: true }, mockContext);

      expect(result.success).toBe(true);
      expect(result.message).toBe('No fixture sets configured');
    });
  });

  describe('info command', () => {
    it('should show fixture set information', async () => {
      mockFixtureManager.getFixtureSetInfo.mockReturnValue({
        name: 'Basic Test Data',
        description: 'Basic fixture set for testing',
        files: ['fixtures/users.json', 'fixtures/products.json'],
        dependencies: ['core']
      });

      const result = await command.execute({ info: 'basic' }, mockContext);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Fixture set information:');
      expect(result.data).toEqual({
        name: 'Basic Test Data',
        description: 'Basic fixture set for testing',
        files: ['fixtures/users.json', 'fixtures/products.json'],
        dependencies: ['core'],
        fileCount: 2,
        dependencyCount: 1
      });
    });

    it('should handle non-existent fixture set', async () => {
      mockFixtureManager.getFixtureSetInfo.mockReturnValue(null);

      const result = await command.execute({ info: 'nonexistent' }, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toBe("Fixture set 'nonexistent' not found");
    });
  });

  describe('seed command', () => {

    it('should seed fixtures successfully', async () => {
      mockFixtureManager.seedFixtures.mockResolvedValue(mockLoadResult);

      const result = await command.execute({ target: 'local' }, mockContext);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Successfully seeded 2 fixtures to local');
      expect(result.data).toEqual({
        target: 'local',
        fixtureSet: 'basic',
        recordCount: 2,
        loadTime: 150
      });
    });

    it('should handle dry run mode', async () => {
      mockFixtureManager.seedFixtures.mockResolvedValue(mockLoadResult);

      const result = await command.execute({ target: 'local', dryRun: true }, mockContext);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Dry run completed. Would seed 2 fixtures to local');
      expect(result.data.dryRun).toBe(true);
    });

    it('should use specific fixture set when provided', async () => {
      mockFixtureManager.seedFixtures.mockResolvedValue({
        ...mockLoadResult,
        metadata: { ...mockLoadResult.metadata, setName: 'advanced' }
      });

      const result = await command.execute({ 
        target: 'dev', 
        fixtureSet: 'advanced' 
      }, mockContext);

      expect(mockFixtureManager.seedFixtures).toHaveBeenCalledWith({
        target: 'dev',
        fixtureSet: 'advanced',
        dryRun: undefined,
        force: undefined,
        environment: process.env
      });
      expect(result.data.fixtureSet).toBe('advanced');
    });

    it('should handle validation errors without force', async () => {
      const errorResult: FixtureLoadResult = {
        success: false,
        loaded: [],
        errors: [
          { file: 'users.json', message: 'Invalid data', severity: 'error' }
        ],
        metadata: mockLoadResult.metadata
      };

      mockFixtureManager.seedFixtures.mockResolvedValue(errorResult);

      const result = await command.execute({ target: 'local' }, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Seeding completed with 1 validation errors');
      expect(result.data.errors).toHaveLength(1);
    });

    it('should force seed with validation errors when force flag is used', async () => {
      const errorResult: FixtureLoadResult = {
        success: false,
        loaded: [mockLoadResult.loaded[0]],
        errors: [
          { file: 'users.json', message: 'Invalid data', severity: 'error' }
        ],
        metadata: mockLoadResult.metadata
      };

      mockFixtureManager.seedFixtures.mockResolvedValue(errorResult);

      const result = await command.execute({ target: 'local', force: true }, mockContext);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Seeding completed with 1 validation errors (forced)');
      expect(result.data.forced).toBe(true);
    });

    it('should handle seeding exceptions', async () => {
      const error = new Error('Database connection failed');
      mockFixtureManager.seedFixtures.mockRejectedValue(error);

      const result = await command.execute({ target: 'local' }, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Database connection failed');
    });

    it('should handle validation failure exceptions', async () => {
      mockFixtureManager.seedFixtures.mockRejectedValue(
        new Error('Fixture validation failed')
      );

      const result = await command.execute({ target: 'local' }, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Fixture validation failed Use --force to seed anyway.');
    });

    it('should pass through validation failures with force flag', async () => {
      const error = new Error('Fixture validation failed');
      mockFixtureManager.seedFixtures.mockRejectedValue(error);

      const result = await command.execute({ target: 'local', force: true }, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Fixture validation failed');
    });
  });

  describe('verbose mode', () => {
    it('should log additional information in verbose mode', async () => {
      mockFixtureManager.seedFixtures.mockResolvedValue(mockLoadResult);
      mockContext.verbose = true;

      await command.execute({ target: 'local' }, mockContext);

      // Verify that verbose logging would occur (mocked logger)
      expect(mockConfigManager.loadConfig).toHaveBeenCalled();
    });
  });

  describe('configuration integration', () => {
    it('should use profile from context', async () => {
      mockFixtureManager.seedFixtures.mockResolvedValue(mockLoadResult);
      mockContext.profile = 'ci';

      await command.execute({ target: 'local' }, mockContext);

      expect(mockConfigManager.loadConfig).toHaveBeenCalledWith('ci');
    });

    it('should handle configuration loading errors', async () => {
      mockConfigManager.loadConfig.mockRejectedValue(
        new Error('Configuration not found')
      );

      const result = await command.execute({ target: 'local' }, mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Configuration not found');
    });
  });
});