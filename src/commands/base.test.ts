/**
 * Tests for BaseCommand
 */

import { BaseCommand } from './base';
import { CommandContext, CommandResult } from './types';

class TestCommand extends BaseCommand {
  public readonly name = 'test';
  public readonly description = 'Test command';
  public readonly usage = '[options]';
  public readonly aliases = ['t'];
  public readonly examples = ['otp test --verbose'];

  public async execute(args: any, context: CommandContext): Promise<CommandResult> {
    this.validateArgs(args);
    
    if (args.fail) {
      return this.failure('Test failure');
    }
    
    if (args.error) {
      throw new Error('Test error');
    }
    
    return this.success('Test success', { processed: true });
  }

  protected validateArgs(args: any): void {
    if (args.invalid) {
      throw new Error('Invalid arguments');
    }
  }
}

describe('BaseCommand', () => {
  let command: TestCommand;
  let mockContext: CommandContext;

  beforeEach(() => {
    command = new TestCommand();
    mockContext = {
      verbose: false,
      logger: { debug: jest.fn(), error: jest.fn() },
    };
  });

  describe('command properties', () => {
    it('should have required properties', () => {
      expect(command.name).toBe('test');
      expect(command.description).toBe('Test command');
      expect(command.usage).toBe('[options]');
      expect(command.aliases).toEqual(['t']);
      expect(command.examples).toEqual(['otp test --verbose']);
    });

    it('should have a handler function', () => {
      expect(typeof command.handler).toBe('function');
    });
  });

  describe('execute', () => {
    it('should execute successfully', async () => {
      const result = await command.execute({}, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('Test success');
      expect(result.data).toEqual({ processed: true });
      expect(result.exitCode).toBe(0);
    });

    it('should handle validation errors', async () => {
      try {
        await command.execute({ invalid: true }, mockContext);
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Invalid arguments');
      }
    });

    it('should handle execution errors', async () => {
      try {
        await command.execute({ error: true }, mockContext);
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Test error');
      }
    });

    it('should handle failure results', async () => {
      const result = await command.execute({ fail: true }, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Test failure');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('result helpers', () => {
    it('should create success result', () => {
      const result = (command as any).success('Success message', { data: 'test' });
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('Success message');
      expect(result.data).toEqual({ data: 'test' });
      expect(result.exitCode).toBe(0);
    });

    it('should create failure result', () => {
      const result = (command as any).failure('Failure message', 2, { error: 'test' });
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Failure message');
      expect(result.data).toEqual({ error: 'test' });
      expect(result.exitCode).toBe(2);
    });

    it('should create error result', () => {
      const error = new Error('Test error');
      const result = (command as any).error(error, 3);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Test error');
      expect(result.exitCode).toBe(3);
    });

    it('should use default exit codes', () => {
      const failureResult = (command as any).failure('Failure');
      const errorResult = (command as any).error(new Error('Error'));
      
      expect(failureResult.exitCode).toBe(1);
      expect(errorResult.exitCode).toBe(1);
    });
  });

  describe('handler binding', () => {
    it('should bind handler to command instance', async () => {
      const handler = command.handler;
      const result = await handler({}, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('Test success');
    });
  });
});