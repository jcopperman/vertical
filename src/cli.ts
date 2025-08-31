#!/usr/bin/env node

import { Command } from 'commander';
import { createLogger } from './utils/logger';
import { getVersion } from './utils/version';
import { CommandManager, HelpCommand, VersionCommand, StatusCommand, RunCommand, ReportCommand, SeedCommand, LogsCommand } from './commands';

const logger = createLogger('CLI');

async function main() {
  const program = new Command();
  const commandManager = new CommandManager();

  // Register commands
  commandManager.registerCommand(new HelpCommand(commandManager));
  commandManager.registerCommand(new VersionCommand());
  commandManager.registerCommand(new StatusCommand());
  commandManager.registerCommand(new RunCommand());
  commandManager.registerCommand(new ReportCommand());
  commandManager.registerCommand(new SeedCommand());
  commandManager.registerCommand(new LogsCommand());

  // Configure the main program
  program
    .name('otp')
    .description(
      'Outeniqua Test Platform CLI - Infrastructure orchestration and test execution'
    )
    .version(getVersion(), '-v, --version', 'Display version information')
    .helpOption('-h, --help', 'Display help for command');

  // Global options
  program
    .option('--verbose', 'Enable verbose logging')
    .option('--config <path>', 'Path to configuration file')
    .option(
      '--profile <name>',
      'Configuration profile to use (local, ci, k8s)'
    );

  // Add commands dynamically from command manager
  for (const command of commandManager.getAllCommands()) {
    let cmdString = command.name;
    if (command.usage) {
      cmdString += ` ${command.usage}`;
    }
    
    const cmd = program
      .command(cmdString)
      .description(command.description);

    if (command.usage) {
      cmd.usage(command.usage);
    }

    if (command.aliases) {
      cmd.aliases(command.aliases);
    }

    // Add command-specific options
    for (const option of command.options) {
      cmd.option(option.flags, option.description, option.defaultValue);
    }

    cmd.action(async (...args) => {
      // Commander.js passes different arguments based on command signature
      // For 'run <suite>': [suite, options, command]
      // For 'status': [options, command]
      

      let commandArgs: any;
      let cmdInstance: any;
      
      if (args.length === 4) {
        // Command with arguments like 'run <suite>'
        const [suite, , options, cmdObj] = args;
        commandArgs = { _: [suite], ...options };
        cmdInstance = cmdObj;
      } else if (args.length === 2) {
        // Command without arguments
        const [options, cmdObj] = args;
        commandArgs = { _: [], ...options };
        cmdInstance = cmdObj;
      } else {
        // Fallback
        commandArgs = { _: [] };
        cmdInstance = args[args.length - 1];
      }

      const context = {
        verbose: cmdInstance.parent?.opts().verbose || false,
        config: cmdInstance.parent?.opts().config,
        profile: cmdInstance.parent?.opts().profile,
        logger,
      };

      const result = await commandManager.executeCommand(command.name, commandArgs, context);
      
      if (result.message) {
        console.log(result.message);
      }
      
      if (!result.success) {
        process.exit(result.exitCode);
      }
    });
  }

  // Set up global error handling
  program.configureHelp({
    sortSubcommands: true,
    subcommandTerm: cmd => cmd.name() + ' ' + cmd.usage(),
  });

  // Parse arguments
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    logger.error('Command execution failed:', error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', error => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

if (require.main === module) {
  main().catch(error => {
    logger.error('CLI startup failed:', error);
    process.exit(1);
  });
}

export { main };
