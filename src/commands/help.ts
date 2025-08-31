/**
 * Help command - Provides dynamic command discovery and help generation
 */

import { BaseCommand } from './base';
import { CommandContext, CommandResult, CommandManager } from './types';

export class HelpCommand extends BaseCommand {
  public readonly name = 'help';
  public readonly description = 'Display help information for commands';
  public readonly usage = '[command]';
  public readonly aliases = ['h'];
  public readonly examples = [
    'otp help',
    'otp help up',
    'otp help status',
  ];

  constructor(private commandManager: CommandManager) {
    super();
  }

  public async execute(args: any, context: CommandContext): Promise<CommandResult> {
    try {
      const commandName = args.command || args._?.[0];
      
      if (commandName) {
        return this.showCommandHelp(commandName);
      } else {
        return this.showGlobalHelp();
      }
    } catch (error) {
      return this.error(error as Error);
    }
  }

  private showCommandHelp(commandName: string): CommandResult {
    const command = this.commandManager.getCommand(commandName);
    
    if (!command) {
      const suggestions = this.commandManager.getSuggestions(commandName);
      let message = `❌ Unknown command: ${commandName}`;
      
      if (suggestions.length > 0) {
        message += `\n\n💡 Did you mean one of these?\n`;
        suggestions.forEach(suggestion => {
          const cmd = this.commandManager.getCommand(suggestion);
          if (cmd) {
            message += `  ${suggestion.padEnd(15)} ${cmd.description}\n`;
          }
        });
        message += `\nUse "otp help <command>" for detailed information.`;
      } else {
        message += `\n\n💡 Available commands:\n`;
        const allCommands = this.commandManager.getAllCommands()
          .slice(0, 5) // Show first 5 commands
          .map(cmd => `  ${cmd.name.padEnd(15)} ${cmd.description}`)
          .join('\n');
        message += allCommands;
        message += `\n\nUse "otp help" to see all commands.`;
      }
      
      return this.failure(message);
    }

    const helpText = this.buildEnhancedCommandHelp(command);
    return this.success(helpText);
  }

  private buildEnhancedCommandHelp(command: any): string {
    let help = `\n📖 ${command.name.toUpperCase()} Command Help\n`;
    help += `${'='.repeat(50)}\n\n`;
    
    help += `📝 Description:\n   ${command.description}\n\n`;
    
    help += `🚀 Usage:\n   otp ${command.name}`;
    if (command.usage) {
      help += ` ${command.usage}`;
    }
    help += `\n\n`;

    if (command.aliases && command.aliases.length > 0) {
      help += `🔗 Aliases: ${command.aliases.join(', ')}\n\n`;
    }

    if (command.options && command.options.length > 0) {
      help += `⚙️  Options:\n`;
      for (const option of command.options) {
        const required = option.required ? ' (required)' : '';
        const defaultVal = option.defaultValue ? ` [default: ${option.defaultValue}]` : '';
        help += `   ${option.flags.padEnd(25)} ${option.description}${required}${defaultVal}\n`;
      }
      help += `\n`;
    }

    if (command.examples && command.examples.length > 0) {
      help += `💡 Examples:\n`;
      for (const example of command.examples) {
        help += `   ${example}\n`;
      }
      help += `\n`;
    }

    // Add contextual tips based on command
    help += this.getCommandTips(command.name);

    help += `📚 More Information:\n`;
    help += `   Full documentation: https://docs.otp.example.com/cli/${command.name}\n`;
    help += `   Report issues: https://github.com/your-org/otp-cli/issues\n`;

    return help;
  }

  private getCommandTips(commandName: string): string {
    const tips: Record<string, string[]> = {
      up: [
        'Use --build to ensure you have the latest images',
        'Add --no-wait for faster startup in CI environments',
        'Check service health with "otp status" after deployment'
      ],
      down: [
        'Use --clean to remove all data volumes',
        'Add --force if services are not responding',
        'Data is preserved by default unless --clean is used'
      ],
      run: [
        'Use --dry-run to see what would be executed',
        'Filter tests with --tags for faster feedback',
        'Set --target to run against different environments'
      ],
      status: [
        'Use --verbose for detailed diagnostic information',
        'Check specific services with --service <name>',
        'Add --refresh to bypass status cache'
      ],
      seed: [
        'Use --dry-run to validate fixtures without loading',
        'Different fixture sets are available for different scenarios',
        'Use "reset" action to clear existing data first'
      ],
      report: [
        'Use "open" to launch Grafana dashboards',
        'Generate reports with different formats (html, json, pdf)',
        'Specify --run-id to view specific test run results'
      ],
      logs: [
        'Use --follow to stream logs in real-time',
        'Filter logs with --filter for specific patterns',
        'Use --since to limit log timeframe'
      ]
    };

    const commandTips = tips[commandName];
    if (!commandTips || commandTips.length === 0) {
      return '';
    }

    let tipSection = `💡 Tips:\n`;
    commandTips.forEach(tip => {
      tipSection += `   • ${tip}\n`;
    });
    tipSection += `\n`;

    return tipSection;
  }

  private showGlobalHelp(): CommandResult {
    const helpText = this.buildGlobalHelp();
    return this.success(helpText);
  }

  private buildGlobalHelp(): string {
    const commands = this.commandManager.getAllCommands()
      .sort((a, b) => a.name.localeCompare(b.name));

    let help = `
🧪 OTP CLI - Outeniqua Test Platform Command Line Interface

The OTP CLI provides a unified interface for managing test infrastructure,
executing test suites, and accessing test results across different environments.

Usage: otp <command> [options]

📋 Core Commands:
`;

    // Group commands by category
    const coreCommands = ['up', 'down', 'status'];
    const testCommands = ['run', 'seed'];
    const reportCommands = ['report', 'logs'];
    const utilityCommands = ['help', 'version'];

    // Core infrastructure commands
    for (const command of commands.filter(c => coreCommands.includes(c.name))) {
      const nameWithAliases = command.aliases && command.aliases.length > 0
        ? `${command.name}, ${command.aliases.join(', ')}`
        : command.name;
      help += `  ${nameWithAliases.padEnd(20)} ${command.description}\n`;
    }

    help += `\n🧪 Testing Commands:\n`;
    for (const command of commands.filter(c => testCommands.includes(c.name))) {
      const nameWithAliases = command.aliases && command.aliases.length > 0
        ? `${command.name}, ${command.aliases.join(', ')}`
        : command.name;
      help += `  ${nameWithAliases.padEnd(20)} ${command.description}\n`;
    }

    help += `\n📊 Reporting Commands:\n`;
    for (const command of commands.filter(c => reportCommands.includes(c.name))) {
      const nameWithAliases = command.aliases && command.aliases.length > 0
        ? `${command.name}, ${command.aliases.join(', ')}`
        : command.name;
      help += `  ${nameWithAliases.padEnd(20)} ${command.description}\n`;
    }

    help += `\n🔧 Utility Commands:\n`;
    for (const command of commands.filter(c => utilityCommands.includes(c.name))) {
      const nameWithAliases = command.aliases && command.aliases.length > 0
        ? `${command.name}, ${command.aliases.join(', ')}`
        : command.name;
      help += `  ${nameWithAliases.padEnd(20)} ${command.description}\n`;
    }

    help += `
🌐 Global Options:
  -h, --help           Display help for command
  -v, --version        Display version information
  --verbose            Enable verbose logging
  --config <path>      Path to configuration file
  --profile <name>     Configuration profile to use (local, ci, k8s)

📚 Getting Started:
  1. Configure your environment:     otp config init
  2. Start the infrastructure:       otp up
  3. Check service health:           otp status
  4. Load test data:                 otp seed
  5. Run your first test:            otp run api
  6. View results:                   otp report open

💡 Common Workflows:
  # Quick health check and test
  otp status && otp run api --tags smoke

  # Full development cycle
  otp up && otp seed && otp run api && otp report open

  # Clean restart
  otp down --clean && otp up --build

  # CI/CD pipeline
  otp up --profile ci && otp run api --target ci

📖 Documentation:
  Use "otp help <command>" for detailed command help
  Visit: https://docs.otp.example.com for complete documentation
  
🔍 Examples:
  otp up --profile local --build     Start with fresh images
  otp run api --tags "smoke,fast"    Run quick API tests
  otp status --service grafana       Check specific service
  otp logs api --follow              Monitor API logs
  otp seed --fixture-set minimal     Load minimal test data
`;

    return help;
  }
}