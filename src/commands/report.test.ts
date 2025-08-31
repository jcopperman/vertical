/**
 * Tests for Report Command
 */

import { ReportCommand } from './report';
import { CommandContext } from './types';

describe('ReportCommand', () => {
  let reportCommand: ReportCommand;
  let context: CommandContext;

  beforeEach(() => {
    reportCommand = new ReportCommand();
    context = {
      verbose: false,
      logger: { debug: jest.fn(), error: jest.fn() },
    };
  });

  describe('constructor', () => {
    it('should create report command with correct properties', () => {
      expect(reportCommand.name).toBe('report');
      expect(reportCommand.description).toContain('Grafana dashboards');
      expect(reportCommand.aliases).toContain('rep');
      expect(reportCommand.options).toHaveLength(9);
    });
  });

  describe('validateArgs', () => {
    it('should reject invalid time formats', async () => {
      const args = {
        from: 'invalid-time'
      };

      const result = await reportCommand.execute(args, context);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid time format');
    });

    it('should reject invalid status values', async () => {
      const args = {
        status: 'invalid-status'
      };

      const result = await reportCommand.execute(args, context);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid status');
    });
  });

  describe('time format validation', () => {
    it('should accept valid relative time formats', () => {
      const command = reportCommand as any;
      expect(command.isValidTimeFormat('now')).toBe(true);
      expect(command.isValidTimeFormat('now-1h')).toBe(true);
      expect(command.isValidTimeFormat('now-30m')).toBe(true);
      expect(command.isValidTimeFormat('now-1d')).toBe(true);
    });

    it('should accept valid ISO 8601 dates', () => {
      const command = reportCommand as any;
      expect(command.isValidTimeFormat('2023-01-01T00:00:00Z')).toBe(true);
      expect(command.isValidTimeFormat('2023-12-31T23:59:59.999Z')).toBe(true);
    });

    it('should reject invalid time formats', () => {
      const command = reportCommand as any;
      expect(command.isValidTimeFormat('invalid-time')).toBe(false);
      expect(command.isValidTimeFormat('now-')).toBe(false);
      expect(command.isValidTimeFormat('not-a-date')).toBe(false);
    });
  });

  describe('filter building', () => {
    it('should build filters from arguments', () => {
      const command = reportCommand as any;
      const args = {
        suite: 'api-tests',
        environment: 'staging',
        status: 'failed',
        from: 'now-2h',
        to: 'now-1h'
      };

      const filters = command.buildFilters(args);

      expect(filters).toEqual({
        suite: 'api-tests',
        environment: 'staging',
        status: 'failed',
        timeRange: {
          from: 'now-2h',
          to: 'now-1h'
        }
      });
    });

    it('should handle partial filter arguments', () => {
      const command = reportCommand as any;
      const args = {
        suite: 'api-tests'
      };

      const filters = command.buildFilters(args);

      expect(filters).toEqual({
        suite: 'api-tests'
      });
    });

    it('should set default time range when only from is provided', () => {
      const command = reportCommand as any;
      const args = {
        from: 'now-2h'
      };

      const filters = command.buildFilters(args);

      expect(filters.timeRange).toEqual({
        from: 'now-2h',
        to: 'now'
      });
    });
  });
});