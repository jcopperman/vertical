/**
 * Report command - Open Grafana dashboards and access test reports
 */

import { BaseCommand } from './base';
import { CommandContext, CommandResult, CommandOption } from './types';
import { ConfigurationManager, DefaultConfigurationManager } from '../config/manager';
import { DefaultGrafanaIntegration, DashboardFilters } from '../reporting/grafana-integration';
import { DefaultReportManager } from '../reporting/manager';
import { exec } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';

const execAsync = promisify(exec);

export interface ReportCommandArgs {
  runId?: string;
  dashboard?: string;
  suite?: string;
  environment?: string;
  status?: string;
  from?: string;
  to?: string;
  list?: boolean;
  url?: boolean;
}

export class ReportCommand extends BaseCommand {
  public readonly name = 'report';
  public readonly description = 'Open Grafana dashboards and access test reports';
  public readonly usage = '[options] [action]';
  public readonly aliases = ['rep'];
  public readonly examples = [
    'otp report open',
    'otp report open --run-id abc123',
    'otp report open --dashboard test-overview',
    'otp report list',
    'otp report url --run-id abc123',
  ];

  public readonly options: CommandOption[] = [
    {
      flags: '--run-id <id>',
      description: 'Specific run ID to filter dashboard',
      required: false,
    },
    {
      flags: '--dashboard <name>',
      description: 'Specific dashboard to open (UID or name)',
      required: false,
    },
    {
      flags: '--suite <suite>',
      description: 'Filter by test suite',
      required: false,
    },
    {
      flags: '--environment <env>',
      description: 'Filter by environment',
      required: false,
    },
    {
      flags: '--status <status>',
      description: 'Filter by test status (passed, failed, error)',
      required: false,
    },
    {
      flags: '--from <time>',
      description: 'Time range start (e.g., now-1h, 2023-01-01T00:00:00Z)',
      required: false,
    },
    {
      flags: '--to <time>',
      description: 'Time range end (e.g., now, 2023-01-01T23:59:59Z)',
      required: false,
    },
    {
      flags: '--list',
      description: 'List available dashboards',
      required: false,
    },
    {
      flags: '--url',
      description: 'Print dashboard URL instead of opening browser',
      required: false,
    },
  ];

  private configManager: ConfigurationManager;
  private grafanaIntegration?: DefaultGrafanaIntegration;
  private reportManager?: DefaultReportManager;

  constructor(configManager?: ConfigurationManager) {
    super();
    this.configManager = configManager || new DefaultConfigurationManager();
  }

  public async execute(args: ReportCommandArgs, context: CommandContext): Promise<CommandResult> {
    try {
      this.validateArgs(args);

      // Load configuration
      const config = await this.configManager.loadConfig(context.profile);
      this.grafanaIntegration = new DefaultGrafanaIntegration(config.reporting.grafana);
      this.reportManager = new DefaultReportManager(config);

      // Determine action
      const action = this.determineAction(args);

      switch (action) {
        case 'list':
          return await this.listDashboards();
        case 'url':
          return await this.getDashboardUrl(args);
        case 'open':
        default:
          return await this.openDashboard(args);
      }
    } catch (error) {
      return this.error(error as Error);
    }
  }

  protected validateArgs(args: ReportCommandArgs): void {
    // Validate time range format if provided
    if (args.from && !this.isValidTimeFormat(args.from)) {
      throw new Error(`Invalid time format for --from: ${args.from}. Use formats like 'now-1h' or ISO 8601.`);
    }

    if (args.to && !this.isValidTimeFormat(args.to)) {
      throw new Error(`Invalid time format for --to: ${args.to}. Use formats like 'now' or ISO 8601.`);
    }

    // Validate status values
    if (args.status && !['passed', 'failed', 'error'].includes(args.status)) {
      throw new Error(`Invalid status: ${args.status}. Must be one of: passed, failed, error`);
    }
  }

  private determineAction(args: ReportCommandArgs): string {
    if (args.list) return 'list';
    if (args.url) return 'url';
    return 'open';
  }

  private async listDashboards(): Promise<CommandResult> {
    this.logger.debug('Listing available dashboards');

    try {
      // Validate Grafana connection
      const isConnected = await this.grafanaIntegration!.validateConnection();
      if (!isConnected) {
        return this.failure('Cannot connect to Grafana. Please check your configuration and ensure Grafana is running.');
      }

      const dashboards = await this.grafanaIntegration!.getDashboards();
      
      if (dashboards.length === 0) {
        return this.success('No dashboards found.');
      }

      let output = '\nAvailable Dashboards:\n\n';
      
      for (const dashboard of dashboards) {
        output += `  ${dashboard.uid.padEnd(20)} ${dashboard.title}\n`;
        if (dashboard.tags.length > 0) {
          output += `${' '.repeat(22)} Tags: ${dashboard.tags.join(', ')}\n`;
        }
        output += `${' '.repeat(22)} URL: ${dashboard.url}\n\n`;
      }

      return this.success(output, { dashboards });

    } catch (error) {
      this.logger.error('Failed to list dashboards:', error);
      return this.failure(`Failed to list dashboards: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async getDashboardUrl(args: ReportCommandArgs): Promise<CommandResult> {
    this.logger.debug('Generating dashboard URL');

    try {
      const runId = await this.resolveRunId(args.runId);
      const filters = this.buildFilters(args);
      
      let url: string;

      if (args.dashboard) {
        // Open specific dashboard
        url = await this.grafanaIntegration!.openDashboard(args.dashboard, runId);
      } else {
        // Open default dashboard with filters
        url = this.grafanaIntegration!.buildDashboardUrl(runId, filters);
      }

      return this.success(url, { url, runId, filters });

    } catch (error) {
      this.logger.error('Failed to generate dashboard URL:', error);
      return this.failure(`Failed to generate dashboard URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async openDashboard(args: ReportCommandArgs): Promise<CommandResult> {
    this.logger.debug('Opening dashboard in browser');

    try {
      // Validate Grafana connection
      const isConnected = await this.grafanaIntegration!.validateConnection();
      if (!isConnected) {
        return this.failure('Cannot connect to Grafana. Please check your configuration and ensure Grafana is running.');
      }

      const runId = await this.resolveRunId(args.runId);
      const filters = this.buildFilters(args);
      
      let url: string;

      if (args.dashboard) {
        // Open specific dashboard
        url = await this.grafanaIntegration!.openDashboard(args.dashboard, runId);
      } else {
        // Open default dashboard with filters
        url = this.grafanaIntegration!.buildDashboardUrl(runId, filters);
      }

      // Open URL in system browser
      await this.openUrlInBrowser(url);

      let message = 'Dashboard opened in browser';
      if (runId) {
        message += ` (Run ID: ${runId})`;
      }

      return this.success(message, { url, runId, filters });

    } catch (error) {
      this.logger.error('Failed to open dashboard:', error);
      return this.failure(`Failed to open dashboard: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async resolveRunId(providedRunId?: string): Promise<string | undefined> {
    if (providedRunId) {
      return providedRunId;
    }

    // Try to get the last run ID from the report manager
    try {
      const lastRunId = await this.reportManager!.getLastRunId();
      if (lastRunId) {
        this.logger.debug(`Using last run ID: ${lastRunId}`);
        return lastRunId;
      }
    } catch (error) {
      this.logger.debug('Could not retrieve last run ID:', error);
    }

    return undefined;
  }

  private buildFilters(args: ReportCommandArgs): DashboardFilters {
    const filters: DashboardFilters = {};

    if (args.suite) {
      filters.suite = args.suite;
    }

    if (args.environment) {
      filters.environment = args.environment;
    }

    if (args.status) {
      filters.status = args.status;
    }

    if (args.from || args.to) {
      filters.timeRange = {
        from: args.from || 'now-1h',
        to: args.to || 'now',
      };
    }

    return filters;
  }

  private async openUrlInBrowser(url: string): Promise<void> {
    const currentPlatform = platform();
    let command: string;

    switch (currentPlatform) {
      case 'win32':
        command = `start "" "${url}"`;
        break;
      case 'darwin':
        command = `open "${url}"`;
        break;
      case 'linux':
        command = `xdg-open "${url}"`;
        break;
      default:
        throw new Error(`Unsupported platform: ${currentPlatform}`);
    }

    try {
      await execAsync(command);
      this.logger.debug(`Opened URL in browser: ${url}`);
    } catch (error) {
      this.logger.error('Failed to open URL in browser:', error);
      throw new Error(`Failed to open browser. You can manually open: ${url}`);
    }
  }

  private isValidTimeFormat(time: string): boolean {
    // Check for relative time formats (now, now-1h, now-30m, etc.)
    if (/^now(-\d+[smhdwMy])?$/.test(time)) {
      return true;
    }

    // Check for ISO 8601 format
    try {
      const date = new Date(time);
      return !isNaN(date.getTime());
    } catch {
      return false;
    }
  }
}