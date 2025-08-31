/**
 * Base command class providing common functionality for all OTP CLI commands
 */

import { Command, CommandContext, CommandResult, CommandHandler } from './types';
import { createLogger } from '../utils/logger';

export abstract class BaseCommand implements Command {
  public abstract readonly name: string;
  public abstract readonly description: string;
  public readonly usage?: string;
  public readonly options: any[] = [];
  public readonly aliases?: string[];
  public readonly examples?: string[];

  protected logger = createLogger(this.constructor.name);

  public get handler(): CommandHandler {
    return this.execute.bind(this);
  }

  /**
   * Execute the command with the provided arguments and context
   */
  public abstract execute(args: any, context: CommandContext): Promise<CommandResult>;

  /**
   * Validate command arguments before execution
   */
  protected validateArgs(args: any): void {
    // Base validation - can be overridden by subclasses
  }

  /**
   * Create a successful command result
   */
  protected success(message?: string, data?: any): CommandResult {
    return {
      success: true,
      message,
      data,
      exitCode: 0,
    };
  }

  /**
   * Create a failed command result
   */
  protected failure(message: string, exitCode: number = 1, data?: any): CommandResult {
    return {
      success: false,
      message,
      data,
      exitCode,
    };
  }

  /**
   * Create an error command result
   */
  protected error(error: Error, exitCode: number = 1): CommandResult {
    this.logger.error(`Command ${this.name} failed:`, error);
    return {
      success: false,
      message: error.message,
      exitCode,
    };
  }
}