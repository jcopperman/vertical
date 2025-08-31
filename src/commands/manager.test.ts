/**
 * Tests for CommandManager
 */

import { CommandManager } from './manager';
import { Command, CommandContext, CommandResult } from './types';

describe('CommandManager', () => {
  let manager: CommandManager;
  let mockContext: CommandContext;

  beforeEach(() => {
    manager = new CommandManager();
    mockContext = {
      verbose: false,
      logger: { debug: jest.fn(), error: jest.fn() },
    };
  });

  describe('registerCommand', () => {
    it('should register a valid command', () => {
      const command: Command = {
        name: 'test',
        description: 'Test command',
        options: [],
        handler: jest.fn().mockResolvedValue({ success: true, exitCode: 0 }),
      };

      expect(() => manager.registerCommand(command)).not.toThrow();
      expect(manager.getCommand('test')).toBe(command);
    });

    it('should register command aliases', () => {
      const command: Command = {
        name: 'test',
        description: 'Test command',
        options: [],
        aliases: ['t', 'tst'],
        handler: jest.fn().mockResolvedValue({ success: true, exitCode: 0 }),
      };

      manager.registerCommand(command);
      
      expect(manager.getCommand('test')).toBe(command);
      expect(manager.getCommand('t')).toBe(command);
      expect(manager.getCommand('tst')).toBe(command);
    });

    it('should throw error for duplicate command names', () => {
      const command1: Command = {
        name: 'test',
        description: 'Test command 1',
        options: [],
        handler: jest.fn(),
      };
      
      const command2: Command = {
        name: 'test',
        description: 'Test command 2',
        options: [],
        handler: jest.fn(),
      };

      manager.registerCommand(command1);
      expect(() => manager.registerCommand(command2)).toThrow('already registered');
    });

    it('should throw error for conflicting aliases', () => {
      const command1: Command = {
        name: 'test1',
        description: 'Test command 1',
        options: [],
        aliases: ['t'],
        handler: jest.fn(),
      };
      
      const command2: Command = {
        name: 'test2',
        description: 'Test command 2',
        options: [],
        aliases: ['t'],
        handler: jest.fn(),
      };

      manager.registerCommand(command1);
      expect(() => manager.registerCommand(command2)).toThrow('conflicts with existing');
    });

    it('should validate required command properties', () => {
      expect(() => manager.registerCommand({} as Command)).toThrow('name is required');
      
      expect(() => manager.registerCommand({
        name: 'test',
        description: '',
        options: [],
        handler: jest.fn(),
      })).toThrow('description is required');
      
      expect(() => manager.registerCommand({
        name: 'test',
        description: 'Test',
        options: [],
        handler: undefined,
      } as any)).toThrow('handler is required');
    });
  });

  describe('executeCommand', () => {
    it('should execute a registered command successfully', async () => {
      const mockHandler = jest.fn().mockResolvedValue({
        success: true,
        message: 'Command executed',
        exitCode: 0,
      });

      const command: Command = {
        name: 'test',
        description: 'Test command',
        options: [],
        handler: mockHandler,
      };

      manager.registerCommand(command);
      
      const result = await manager.executeCommand('test', { arg1: 'value1' }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('Command executed');
      expect(result.exitCode).toBe(0);
      expect(mockHandler).toHaveBeenCalledWith({ arg1: 'value1' }, mockContext);
    });

    it('should handle command execution errors', async () => {
      const mockHandler = jest.fn().mockRejectedValue(new Error('Command failed'));

      const command: Command = {
        name: 'test',
        description: 'Test command',
        options: [],
        handler: mockHandler,
      };

      manager.registerCommand(command);
      
      const result = await manager.executeCommand('test', {}, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Command failed');
      expect(result.exitCode).toBe(1);
    });

    it('should return error for unknown command', async () => {
      const result = await manager.executeCommand('unknown', {}, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown command: unknown');
      expect(result.exitCode).toBe(1);
    });

    it('should execute command by alias', async () => {
      const mockHandler = jest.fn().mockResolvedValue({
        success: true,
        exitCode: 0,
      });

      const command: Command = {
        name: 'test',
        description: 'Test command',
        options: [],
        aliases: ['t'],
        handler: mockHandler,
      };

      manager.registerCommand(command);
      
      const result = await manager.executeCommand('t', {}, mockContext);
      
      expect(result.success).toBe(true);
      expect(mockHandler).toHaveBeenCalled();
    });
  });

  describe('getHelp', () => {
    beforeEach(() => {
      const command: Command = {
        name: 'test',
        description: 'Test command for help',
        usage: '[options]',
        options: [
          { flags: '-v, --verbose', description: 'Enable verbose output' },
          { flags: '-f, --file <path>', description: 'Specify file path' },
        ],
        aliases: ['t'],
        examples: ['otp test --verbose', 'otp test -f config.json'],
        handler: jest.fn(),
      };

      manager.registerCommand(command);
    });

    it('should generate help for specific command', () => {
      const help = manager.getHelp('test');
      
      expect(help).toContain('Usage: otp test [options]');
      expect(help).toContain('Test command for help');
      expect(help).toContain('-v, --verbose');
      expect(help).toContain('Enable verbose output');
      expect(help).toContain('Aliases: t');
      expect(help).toContain('otp test --verbose');
    });

    it('should generate global help', () => {
      const help = manager.getHelp();
      
      expect(help).toContain('Available commands:');
      expect(help).toContain('test');
      expect(help).toContain('Test command for help');
      expect(help).toContain('Use "otp <command> --help"');
    });

    it('should handle unknown command in help', () => {
      const help = manager.getHelp('unknown');
      expect(help).toBe('Unknown command: unknown');
    });
  });

  describe('getSuggestions', () => {
    beforeEach(() => {
      const commands: Command[] = [
        { name: 'status', description: 'Show status', options: [], handler: jest.fn() },
        { name: 'start', description: 'Start services', options: [], handler: jest.fn() },
        { name: 'stop', description: 'Stop services', options: [], handler: jest.fn() },
        { name: 'help', description: 'Show help', options: [], handler: jest.fn() },
      ];

      commands.forEach(cmd => manager.registerCommand(cmd));
    });

    it('should suggest similar commands', () => {
      const suggestions = manager.getSuggestions('stat');
      expect(suggestions).toContain('status');
      expect(suggestions).toContain('start');
    });

    it('should limit suggestions', () => {
      const suggestions = manager.getSuggestions('s');
      expect(suggestions.length).toBeLessThanOrEqual(3);
    });

    it('should return empty array for no matches', () => {
      const suggestions = manager.getSuggestions('xyz123');
      expect(suggestions).toEqual([]);
    });
  });

  describe('getAllCommands', () => {
    it('should return all registered commands', () => {
      const command1: Command = {
        name: 'test1',
        description: 'Test command 1',
        options: [],
        handler: jest.fn(),
      };
      
      const command2: Command = {
        name: 'test2',
        description: 'Test command 2',
        options: [],
        handler: jest.fn(),
      };

      manager.registerCommand(command1);
      manager.registerCommand(command2);
      
      const commands = manager.getAllCommands();
      expect(commands).toHaveLength(2);
      expect(commands).toContain(command1);
      expect(commands).toContain(command2);
    });
  });
});