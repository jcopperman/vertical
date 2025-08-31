/**
 * Seed command for fixture data management
 */

import { BaseCommand } from './base';
import { CommandContext, CommandResult, CommandOption } from './types';
import { FixtureManager } from '../fixtures';
import { DefaultConfigurationManager } from '../config/manager';
import { FixtureSeedOptions } from '../fixtures/types';

export interface SeedCommandArgs {
  target?: string;
  fixtureSet?: string;
  dryRun?: boolean;
  force?: boolean;
  list?: boolean;
  info?: string;
}

export class SeedCommand extends BaseCommand {
  public readonly name = 'seed';
  public readonly description = 'Manage test fixture data';
  public readonly usage = '[options]';
  public readonly aliases = ['fixtures'];
  public readonly examples = [
    'otp seed --target local',
    'otp seed --fixture-set advanced --target dev',
    'otp seed --dry-run --target staging',
    'otp seed --list',
    'otp seed --info basic'
  ];

  public readonly options: CommandOption[] = [
    {
      flags: '-t, --target <environment>',
      description: 'Target environment for seeding (local, dev, staging)',
      defaultValue: 'local'
    },
    {
      flags: '-s, --fixture-set <name>',
      description: 'Specific fixture set to load (defaults to configured default)'
    },
    {
      flags: '-d, --dry-run',
      description: 'Preview what would be seeded without making changes',
      defaultValue: false
    },
    {
      flags: '-f, --force',
      description: 'Force seeding even if validation fails',
      defaultValue: false
    },
    {
      flags: '-l, --list',
      description: 'List available fixture sets',
      defaultValue: false
    },
    {
      flags: '-i, --info <name>',
      description: 'Show information about a specific fixture set'
    }
  ];

  public async execute(args: SeedCommandArgs, context: CommandContext): Promise<CommandResult> {
    try {
      this.validateArgs(args);

      // Load configuration
      const configManager = new DefaultConfigurationManager();
      const config = await configManager.loadConfig(context.profile);
      
      const fixtureManager = new FixtureManager(
        config.fixtures,
        process.cwd()
      );

      // Handle list command
      if (args.list) {
        return this.handleListCommand(fixtureManager);
      }

      // Handle info command
      if (args.info) {
        return this.handleInfoCommand(fixtureManager, args.info);
      }

      // Handle seed command
      return this.handleSeedCommand(fixtureManager, args, context);

    } catch (error) {
      return this.error(error instanceof Error ? error : new Error(String(error)));
    }
  }

  protected validateArgs(args: SeedCommandArgs): void {
    // Validate target environment
    if (args.target && !['local', 'dev', 'staging', 'ci'].includes(args.target)) {
      throw new Error(`Invalid target environment: ${args.target}. Must be one of: local, dev, staging, ci`);
    }

    // Validate mutually exclusive options
    const exclusiveOptions = [args.list, args.info, !args.list && !args.info];
    const activeOptions = exclusiveOptions.filter(Boolean).length;
    
    if (activeOptions > 1) {
      throw new Error('Options --list, --info, and seeding operations are mutually exclusive');
    }
  }

  private async handleListCommand(fixtureManager: FixtureManager): Promise<CommandResult> {
    const sets = fixtureManager.getAvailableFixtureSets();
    
    if (sets.length === 0) {
      return this.success('No fixture sets configured');
    }

    const setInfo = sets.map(setName => {
      const info = fixtureManager.getFixtureSetInfo(setName);
      return {
        name: setName,
        description: info?.description || 'No description',
        files: info?.files.length || 0,
        dependencies: info?.dependencies?.length || 0
      };
    });

    return this.success('Available fixture sets:', { sets: setInfo });
  }

  private async handleInfoCommand(fixtureManager: FixtureManager, setName: string): Promise<CommandResult> {
    const info = fixtureManager.getFixtureSetInfo(setName);
    
    if (!info) {
      return this.failure(`Fixture set '${setName}' not found`);
    }

    return this.success(`Fixture set information:`, {
      name: info.name,
      description: info.description,
      files: info.files,
      dependencies: info.dependencies || [],
      fileCount: info.files.length,
      dependencyCount: info.dependencies?.length || 0
    });
  }

  private async handleSeedCommand(
    fixtureManager: FixtureManager,
    args: SeedCommandArgs,
    context: CommandContext
  ): Promise<CommandResult> {
    const target = args.target || 'local';
    
    this.logger.info(`Starting fixture seeding for target: ${target}`);

    const seedOptions: FixtureSeedOptions = {
      target,
      fixtureSet: args.fixtureSet,
      dryRun: args.dryRun,
      force: args.force,
      environment: process.env as Record<string, string>
    };

    if (context.verbose) {
      this.logger.info('Seed options:', seedOptions);
    }

    try {
      const result = await fixtureManager.seedFixtures(seedOptions);

      if (args.dryRun) {
        return this.success(
          `Dry run completed. Would seed ${result.loaded.length} fixtures to ${target}`,
          {
            target,
            fixtureSet: result.metadata.setName,
            recordCount: result.loaded.length,
            loadTime: result.metadata.loadTime,
            dryRun: true,
            errors: result.errors
          }
        );
      }

      if (!result.success && result.errors.length > 0) {
        const errorMessage = `Seeding completed with ${result.errors.length} validation errors`;
        return args.force 
          ? this.success(`${errorMessage} (forced)`, {
              target,
              fixtureSet: result.metadata.setName,
              recordCount: result.loaded.length,
              errors: result.errors,
              forced: true
            })
          : this.failure(errorMessage, 1, {
              target,
              fixtureSet: result.metadata.setName,
              errors: result.errors
            });
      }

      return this.success(
        `Successfully seeded ${result.loaded.length} fixtures to ${target}`,
        {
          target,
          fixtureSet: result.metadata.setName,
          recordCount: result.loaded.length,
          loadTime: result.metadata.loadTime
        }
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('validation failed') && !args.force) {
        return this.failure(
          `${errorMessage} Use --force to seed anyway.`,
          1,
          { target, fixtureSet: args.fixtureSet }
        );
      }

      return this.error(error instanceof Error ? error : new Error(errorMessage));
    }
  }
}