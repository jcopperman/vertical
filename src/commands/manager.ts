/**
 * Command Manager - Handles registration, discovery, and execution of CLI commands
 */

import { Command, CommandContext, CommandResult, CommandManager as ICommandManager } from './types';
import { createLogger } from '../utils/logger';

export class CommandManager implements ICommandManager {
  private commands = new Map<string, Command>();
  private aliases = new Map<string, string>();
  private logger = createLogger('CommandManager');

  /**
   * Register a command with the manager
   */
  public registerCommand(command: Command): void {
    this.logger.debug(`Registering command: ${command.name}`);
    
    // Validate command
    this.validateCommand(command);
    
    // Register main command name
    this.commands.set(command.name, command);
    
    // Register aliases if any
    if (command.aliases) {
      for (const alias of command.aliases) {
        if (this.aliases.has(alias) || this.commands.has(alias)) {
          throw new Error(`Command alias '${alias}' conflicts with existing command or alias`);
        }
        this.aliases.set(alias, command.name);
      }
    }
    
    this.logger.debug(`Command '${command.name}' registered successfully`);
  }

  /**
   * Execute a command by name
   */
  public async executeCommand(
    commandName: string,
    args: any,
    context: CommandContext
  ): Promise<CommandResult> {
    const command = this.getCommand(commandName);
    
    if (!command) {
      return {
        success: false,
        message: `Unknown command: ${commandName}. Use 'otp help' to see available commands.`,
        exitCode: 1,
      };
    }

    try {
      this.logger.debug(`Executing command: ${commandName}`);
      const result = await command.handler(args, context);
      this.logger.debug(`Command '${commandName}' completed with exit code: ${result.exitCode}`);
      return result;
    } catch (error) {
      this.logger.error(`Command '${commandName}' failed:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        exitCode: 1,
      };
    }
  }

  /**
   * Get a command by name or alias
   */
  public getCommand(name: string): Command | undefined {
    // Check direct command name first
    if (this.commands.has(name)) {
      return this.commands.get(name);
    }
    
    // Check aliases
    const aliasTarget = this.aliases.get(name);
    if (aliasTarget) {
      return this.commands.get(aliasTarget);
    }
    
    return undefined;
  }

  /**
   * Get all registered commands
   */
  public getAllCommands(): Command[] {
    return Array.from(this.commands.values());
  }

  /**
   * Generate help text for a specific command or all commands
   */
  public getHelp(commandName?: string): string {
    if (commandName) {
      return this.getCommandHelp(commandName);
    }
    return this.getGlobalHelp();
  }

  /**
   * Get help for a specific command
   */
  private getCommandHelp(commandName: string): string {
    const command = this.getCommand(commandName);
    if (!command) {
      return `Unknown command: ${commandName}`;
    }

    let help = `\nUsage: otp ${command.name}`;
    if (command.usage) {
      help += ` ${command.usage}`;
    }
    help += `\n\n${command.description}\n`;

    if (command.options && command.options.length > 0) {
      help += '\nOptions:\n';
      for (const option of command.options) {
        help += `  ${option.flags.padEnd(20)} ${option.description}\n`;
      }
    }

    if (command.aliases && command.aliases.length > 0) {
      help += `\nAliases: ${command.aliases.join(', ')}\n`;
    }

    if (command.examples && command.examples.length > 0) {
      help += '\nExamples:\n';
      for (const example of command.examples) {
        help += `  ${example}\n`;
      }
    }

    return help;
  }

  /**
   * Get global help showing all commands
   */
  private getGlobalHelp(): string {
    let help = '\nAvailable commands:\n\n';
    
    const commands = this.getAllCommands().sort((a, b) => a.name.localeCompare(b.name));
    
    for (const command of commands) {
      help += `  ${command.name.padEnd(15)} ${command.description}\n`;
    }
    
    help += '\nUse "otp <command> --help" for more information about a specific command.\n';
    
    return help;
  }

  /**
   * Validate a command before registration
   */
  private validateCommand(command: Command): void {
    if (!command.name || command.name.trim() === '') {
      throw new Error('Command name is required');
    }
    
    if (!command.description || command.description.trim() === '') {
      throw new Error('Command description is required');
    }
    
    if (!command.handler || typeof command.handler !== 'function') {
      throw new Error('Command handler is required and must be a function');
    }
    
    if (this.commands.has(command.name)) {
      throw new Error(`Command '${command.name}' is already registered`);
    }
  }

  /**
   * Get command suggestions for unknown commands
   */
  public getSuggestions(input: string): string[] {
    const allNames = [
      ...Array.from(this.commands.keys()),
      ...Array.from(this.aliases.keys())
    ];
    
    return allNames
      .filter(name => name.includes(input) || this.levenshteinDistance(input, name) <= 2)
      .sort((a, b) => {
        const distA = this.levenshteinDistance(input, a);
        const distB = this.levenshteinDistance(input, b);
        return distA - distB;
      })
      .slice(0, 3);
  }

  /**
   * Calculate Levenshtein distance for command suggestions
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  }
}