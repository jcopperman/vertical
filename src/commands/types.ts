/**
 * Core types and interfaces for the OTP CLI command system
 */

export interface CommandOption {
  flags: string;
  description: string;
  defaultValue?: any;
  required?: boolean;
}

export interface CommandResult {
  success: boolean;
  message?: string;
  data?: any;
  exitCode: number;
}

export interface CommandContext {
  verbose: boolean;
  config?: string;
  profile?: string;
  logger: any;
}

export type CommandHandler = (
  args: any,
  context: CommandContext
) => Promise<CommandResult>;

export interface Command {
  name: string;
  description: string;
  usage?: string;
  options: CommandOption[];
  handler: CommandHandler;
  aliases?: string[];
  examples?: string[];
}

export interface CommandManager {
  registerCommand(command: Command): void;
  executeCommand(commandName: string, args: any, context: CommandContext): Promise<CommandResult>;
  getCommand(name: string): Command | undefined;
  getAllCommands(): Command[];
  getHelp(commandName?: string): string;
  getSuggestions(input: string): string[];
}