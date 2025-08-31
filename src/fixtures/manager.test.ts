/**
 * Tests for FixtureManager
 */

import { promises as fs } from 'fs';
import path from 'path';
import { FixtureManager } from './manager';
import { FixtureConfig } from '../config/types';
import { FixtureData, FixtureSeedOptions } from './types';

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    readFile: jest.fn()
  }
}));

// Mock logger
jest.mock('../utils/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }))
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('FixtureManager', () => {
  let fixtureManager: FixtureManager;
  let mockConfig: FixtureConfig;
  const workspaceRoot = '/test/workspace';

  beforeEach(() => {
    mockConfig = {
      defaultSet: 'basic',
      sets: {
        basic: {
          name: 'Basic Test Data',
          description: 'Basic fixture set for testing',
          files: ['fixtures/users.json', 'fixtures/products.json']
        },
        advanced: {
          name: 'Advanced Test Data',
          description: 'Advanced fixture set with dependencies',
          files: ['fixtures/advanced-users.json'],
          dependencies: ['basic']
        }
      }
    };

    fixtureManager = new FixtureManager(mockConfig, workspaceRoot);
    jest.clearAllMocks();
  });

  describe('loadFixtureSet', () => {
    it('should load default fixture set when no name provided', async () => {
      const mockUserData: FixtureData[] = [
        {
          id: 'user1',
          type: 'user',
          data: { email: 'test@example.com', name: 'Test User' }
        }
      ];

      const mockProductData: FixtureData[] = [
        {
          id: 'product1',
          type: 'product',
          data: { name: 'Test Product', price: 100 }
        }
      ];

      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(mockUserData))
        .mockResolvedValueOnce(JSON.stringify(mockProductData));

      const result = await fixtureManager.loadFixtureSet();

      expect(result.success).toBe(true);
      expect(result.loaded).toHaveLength(2);
      expect(result.metadata.setName).toBe('basic');
      expect(result.metadata.totalRecords).toBe(2);
    });

    it('should load specific fixture set by name', async () => {
      const mockData: FixtureData[] = [
        {
          id: 'advanced1',
          type: 'user',
          data: { email: 'advanced@example.com', name: 'Advanced User' }
        }
      ];

      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockData));

      const result = await fixtureManager.loadFixtureSet('advanced');

      expect(result.success).toBe(true);
      expect(result.loaded).toHaveLength(1);
      expect(result.metadata.setName).toBe('advanced');
    });

    it('should throw error for non-existent fixture set', async () => {
      await expect(fixtureManager.loadFixtureSet('nonexistent'))
        .rejects.toThrow("Fixture set 'nonexistent' not found");
    });

    it('should handle file loading errors', async () => {
      mockFs.access.mockRejectedValue(new Error('File not found'));

      const result = await fixtureManager.loadFixtureSet();

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(2); // Two files in basic set
      expect(result.errors[0].message).toContain('Failed to load fixture file');
    });

    it('should validate dependencies before loading', async () => {
      // Remove the basic set that advanced depends on
      delete mockConfig.sets.basic;

      await expect(fixtureManager.loadFixtureSet('advanced'))
        .rejects.toThrow("Dependency fixture set 'basic' not found");
    });
  });

  describe('validateFixtures', () => {
    it('should validate fixture data successfully', async () => {
      const fixtures: FixtureData[] = [
        {
          id: 'user1',
          type: 'user',
          data: { email: 'test@example.com', name: 'Test User' }
        }
      ];

      const result = await fixtureManager.validateFixtures(fixtures, 'test.json');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', async () => {
      const fixtures: FixtureData[] = [
        {
          id: '',
          type: 'user',
          data: { email: 'test@example.com' }
        },
        {
          id: 'user2',
          type: '',
          data: { email: 'test2@example.com' }
        }
      ];

      const result = await fixtureManager.validateFixtures(fixtures, 'test.json');

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].message).toContain('missing required field: id');
      expect(result.errors[1].message).toContain('missing required field: type');
    });

    it('should detect duplicate IDs', async () => {
      const fixtures: FixtureData[] = [
        {
          id: 'user1',
          type: 'user',
          data: { email: 'test1@example.com' }
        },
        {
          id: 'user1',
          type: 'user',
          data: { email: 'test2@example.com' }
        }
      ];

      const result = await fixtureManager.validateFixtures(fixtures, 'test.json');

      expect(result.warnings).toContain("Duplicate fixture ID 'user1' found in test.json");
    });

    it('should validate type-specific fields', async () => {
      const fixtures: FixtureData[] = [
        {
          id: 'user1',
          type: 'user',
          data: { name: 'Test User' } // Missing email
        },
        {
          id: 'product1',
          type: 'product',
          data: { price: 100 } // Missing name
        }
      ];

      const result = await fixtureManager.validateFixtures(fixtures, 'test.json');

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].message).toContain('User fixture missing email field');
      expect(result.errors[1].message).toContain('Product fixture missing name field');
    });
  });

  describe('resetFixtures', () => {
    it('should reset fixtures with default options', async () => {
      await expect(fixtureManager.resetFixtures('local')).resolves.not.toThrow();
    });

    it('should reset fixtures with truncate only option', async () => {
      await expect(fixtureManager.resetFixtures('local', { truncateOnly: true }))
        .resolves.not.toThrow();
    });

    it('should reset fixtures with schema preservation', async () => {
      await expect(fixtureManager.resetFixtures('local', { preserveSchema: true }))
        .resolves.not.toThrow();
    });
  });

  describe('seedFixtures', () => {
    beforeEach(() => {
      const mockData: FixtureData[] = [
        {
          id: 'user1',
          type: 'user',
          data: { email: 'test@example.com', name: 'Test User' }
        }
      ];

      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockData));
    });

    it('should seed fixtures successfully', async () => {
      const options: FixtureSeedOptions = {
        target: 'local'
      };

      const result = await fixtureManager.seedFixtures(options);

      expect(result.success).toBe(true);
      expect(result.loaded).toHaveLength(2); // Two files in basic set
    });

    it('should perform dry run without actual seeding', async () => {
      const options: FixtureSeedOptions = {
        target: 'local',
        dryRun: true
      };

      const result = await fixtureManager.seedFixtures(options);

      expect(result.success).toBe(true);
    });

    it('should force seed even with validation errors', async () => {
      // Create invalid fixture data
      const invalidData: FixtureData[] = [
        {
          id: '',
          type: 'user',
          data: {}
        }
      ];

      mockFs.readFile.mockResolvedValue(JSON.stringify(invalidData));

      const options: FixtureSeedOptions = {
        target: 'local',
        force: true
      };

      const result = await fixtureManager.seedFixtures(options);

      expect(result.success).toBe(false); // Validation failed
      // But seeding should still proceed due to force flag
    });

    it('should throw error on validation failure without force', async () => {
      // Create invalid fixture data
      const invalidData: FixtureData[] = [
        {
          id: '',
          type: 'user',
          data: {}
        }
      ];

      mockFs.readFile.mockResolvedValue(JSON.stringify(invalidData));

      const options: FixtureSeedOptions = {
        target: 'local'
      };

      await expect(fixtureManager.seedFixtures(options))
        .rejects.toThrow('Fixture validation failed. Use --force to seed anyway.');
    });

    it('should use specific fixture set when provided', async () => {
      const options: FixtureSeedOptions = {
        target: 'local',
        fixtureSet: 'advanced'
      };

      const result = await fixtureManager.seedFixtures(options);

      expect(result.metadata.setName).toBe('advanced');
    });
  });

  describe('getAvailableFixtureSets', () => {
    it('should return list of available fixture sets', () => {
      const sets = fixtureManager.getAvailableFixtureSets();

      expect(sets).toEqual(['basic', 'advanced']);
    });
  });

  describe('getFixtureSetInfo', () => {
    it('should return fixture set information', () => {
      const info = fixtureManager.getFixtureSetInfo('basic');

      expect(info).toEqual(mockConfig.sets.basic);
    });

    it('should return null for non-existent fixture set', () => {
      const info = fixtureManager.getFixtureSetInfo('nonexistent');

      expect(info).toBeNull();
    });
  });
});