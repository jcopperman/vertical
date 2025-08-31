/**
 * Tests for HelpCommand
 */

import { HelpCommand } from './help';
import { CommandManager } from './manager';
import { Command, CommandContext } from './types';

describe('HelpCommand', () => {
  let helpCommand: HelpCommand;
  let commandManager: CommandManager;
  let mockContext: CommandContext;

  beforeEach(() => {
    commandManager = new CommandManager();
    helpCommand = new HelpCommand(commandManager);
    mockContext = {
      verbose: false,
      logger: { debug: jest.fn(), error: jest.fn() },
    };

    // Register some test commands
    const testCommands: Command[] = [
      {
        name: 'up',
        description: 'Start infrastructure',
        usage: '[options]',
        options: [
          { flags: '--clean', description: 'Clean start' },
        ],
        aliases: ['start'],
        examples: ['otp up', 'otp up --clean'],
        handler: jest.fn(),
      },
      {
        name: 'down',
        description: 'Stop infrastructure',
        options: [],
        handler: jest.fn(),
      },
      {
        name: 'status',
        description: 'Show status',
        options: [],
        handler: jest.fn(),
      },
    ];

    testCommands.forEach(cmd => commandManager.registerCommand(cmd));
  });

  describe('command properties', () => {
    it('should have correct properties', () => {
      expect(helpCommand.name).toBe('help');
      expect(helpCommand.description).toBe('Display help information for commands');
      expect(helpCommand.usage).toBe('[command]');
      expect(helpCommand.aliases).toEqual(['h']);
      expect(helpCommand.examples).toContain('otp help');
    });
  });

  describe('execute', () => {
    it('should show global help when no command specified', async () => {
      const result = await helpCommand.execute({}, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('OTP CLI - Outeniqua Test Platform');
      expect(result.message).toContain('Commands:');
      expect(result.message).toContain('up');
      expect(result.message).toContain('down');
      expect(result.message).toContain('status');
      expect(result.message).toContain('Global Options:');
    });

    it('should show command-specific help', async () => {
      const result = await helpCommand.execute({ command: 'up' }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Usage: otp up [options]');
      expect(result.message).toContain('Start infrastructure');
      expect(result.message).toContain('--clean');
      expect(result.message).toContain('Aliases: start');
      expect(result.message).toContain('otp up --clean');
    });

    it('should show command help using positional argument', async () => {
      const result = await helpCommand.execute({ _: ['status'] }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Usage: otp status');
      expect(result.message).toContain('Show status');
    });

    it('should handle unknown command with suggestions', async () => {
      // Mock getSuggestions to return predictable results
      jest.spyOn(commandManager, 'getSuggestions').mockReturnValue(['up', 'status']);
      
      const result = await helpCommand.execute({ command: 'stat' }, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown command: stat');
      expect(result.message).toContain('Did you mean one of these?');
      expect(result.message).toContain('up');
      expect(result.message).toContain('status');
    });

    it('should handle unknown command without suggestions', async () => {
      jest.spyOn(commandManager, 'getSuggestions').mockReturnValue([]);
      
      const result = await helpCommand.execute({ command: 'xyz123' }, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Unknown command: xyz123');
      expect(result.message).not.toContain('Did you mean');
    });
  });

  describe('global help formatting', () => {
    it('should include command aliases in listing', async () => {
      const result = await helpCommand.execute({}, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('up, start');
    });

    it('should sort commands alphabetically', async () => {
      const result = await helpCommand.execute({}, mockContext);
      
      expect(result.success).toBe(true);
      const lines = result.message!.split('\n');
      const commandLines = lines.filter(line => line.trim().match(/^[a-z]/));
      
      // Should be sorted: down, status, up
      expect(commandLines[0]).toContain('down');
      expect(commandLines[1]).toContain('status');
      expect(commandLines[2]).toContain('up, start');
    });

    it('should include usage examples', async () => {
      const result = await helpCommand.execute({}, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Examples:');
      expect(result.message).toContain('otp up');
      expect(result.message).toContain('otp status');
      expect(result.message).toContain('otp help up');
    });
  });
});