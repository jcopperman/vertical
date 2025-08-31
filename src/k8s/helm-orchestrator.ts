/**
 * Helm orchestrator for managing OTP infrastructure on Kubernetes
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createLogger } from '../utils/logger';
import { KubernetesClient } from './client';
import {
  HelmConfig,
  HelmDeploymentOptions,
  HelmDeploymentResult,
  KubernetesResource,
  HelmRelease,
  HelmStatus
} from './types';

const execAsync = promisify(exec);
const logger = createLogger('helm-orchestrator');



export class HelmOrchestrator {
  private config: HelmConfig;
  private k8sClient: KubernetesClient;

  constructor(config: HelmConfig) {
    this.config = {
      timeout: 300, // 5 minutes default
      wait: true,
      atomic: true,
      ...config
    };

    this.k8sClient = new KubernetesClient({
      kubeconfig: this.config.kubeconfig
    });

    logger.debug('HelmOrchestrator initialized', { config: this.config });
  }

  /**
   * Deploy or upgrade a Helm release
   */
  async deploy(options: HelmDeploymentOptions = {}): Promise<HelmDeploymentResult> {
    const startTime = Date.now();
    logger.info('Starting Helm deployment', { 
      releaseName: this.config.releaseName,
      namespace: this.config.namespace,
      options 
    });

    try {
      // Validate prerequisites
      await this.validatePrerequisites();

      // Ensure namespace exists if createNamespace is true
      if (options.createNamespace) {
        await this.ensureNamespace();
      }

      // Build Helm command
      const helmCommand = await this.buildHelmCommand(options);
      
      logger.debug('Executing Helm command', { command: helmCommand });

      // Execute Helm deployment
      const result = await execAsync(helmCommand, {
        env: this.buildEnvironment(),
        timeout: (options.timeout || this.config.timeout!) * 1000
      });

      logger.debug('Helm deployment completed', { 
        stdout: result.stdout.substring(0, 500) // Log first 500 chars
      });

      // Get deployment status and resources
      const status = await this.getStatus();
      const resources = await this.getResources();

      const deploymentTime = Date.now() - startTime;

      const deploymentResult: HelmDeploymentResult = {
        success: true,
        releaseName: this.config.releaseName,
        namespace: this.config.namespace,
        revision: status.revision,
        status: status.status,
        deploymentTime,
        resources,
        errors: [],
        warnings: this.parseWarnings(result.stdout)
      };

      logger.info('Helm deployment successful', {
        releaseName: this.config.releaseName,
        revision: status.revision,
        deploymentTime
      });

      return deploymentResult;
    } catch (error) {
      const deploymentTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error('Helm deployment failed', { 
        releaseName: this.config.releaseName,
        error: errorMessage, 
        deploymentTime 
      });

      return {
        success: false,
        releaseName: this.config.releaseName,
        namespace: this.config.namespace,
        revision: 0,
        status: 'failed',
        deploymentTime,
        resources: [],
        errors: [errorMessage],
        warnings: []
      };
    }
  }

  /**
   * Uninstall a Helm release
   */
  async uninstall(options: { 
    keepHistory?: boolean; 
    timeout?: number;
    wait?: boolean;
  } = {}): Promise<void> {
    logger.info('Uninstalling Helm release', { 
      releaseName: this.config.releaseName,
      namespace: this.config.namespace,
      options 
    });

    try {
      let command = `helm uninstall ${this.config.releaseName}`;
      
      if (this.config.namespace) {
        command += ` --namespace ${this.config.namespace}`;
      }
      
      if (options.keepHistory) {
        command += ' --keep-history';
      }
      
      if (options.timeout) {
        command += ` --timeout ${options.timeout}s`;
      }
      
      if (options.wait !== false) {
        command += ' --wait';
      }

      logger.debug('Executing Helm uninstall', { command });

      const result = await execAsync(command, {
        env: this.buildEnvironment(),
        timeout: (options.timeout || this.config.timeout!) * 1000
      });

      logger.info('Helm release uninstalled successfully', {
        releaseName: this.config.releaseName
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to uninstall Helm release', { 
        releaseName: this.config.releaseName,
        error: errorMessage 
      });
      throw new Error(`Failed to uninstall release: ${errorMessage}`);
    }
  }

  /**
   * Get the status of a Helm release
   */
  async getStatus(): Promise<HelmStatus> {
    logger.debug('Getting Helm release status', { 
      releaseName: this.config.releaseName 
    });

    try {
      let command = `helm status ${this.config.releaseName} --output json`;
      
      if (this.config.namespace) {
        command += ` --namespace ${this.config.namespace}`;
      }

      const result = await execAsync(command, {
        env: this.buildEnvironment()
      });

      const statusData = JSON.parse(result.stdout);
      const resources = await this.getResources();

      const status: HelmStatus = {
        releaseName: statusData.name,
        namespace: statusData.namespace,
        status: statusData.info.status,
        revision: statusData.version,
        lastDeployed: new Date(statusData.info.last_deployed),
        resources,
        notes: statusData.info.notes
      };

      logger.debug('Helm release status retrieved', { status: status.status });
      return status;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get Helm release status', { 
        releaseName: this.config.releaseName,
        error: errorMessage 
      });
      throw new Error(`Failed to get release status: ${errorMessage}`);
    }
  }

  /**
   * List all Helm releases in the namespace
   */
  async listReleases(): Promise<HelmRelease[]> {
    logger.debug('Listing Helm releases', { namespace: this.config.namespace });

    try {
      let command = 'helm list --output json';
      
      if (this.config.namespace) {
        command += ` --namespace ${this.config.namespace}`;
      }

      const result = await execAsync(command, {
        env: this.buildEnvironment()
      });

      const releases = JSON.parse(result.stdout);
      
      const helmReleases: HelmRelease[] = releases.map((release: any) => ({
        name: release.name,
        namespace: release.namespace,
        revision: release.revision,
        updated: new Date(release.updated),
        status: release.status,
        chart: release.chart,
        appVersion: release.app_version
      }));

      logger.debug('Helm releases listed', { count: helmReleases.length });
      return helmReleases;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to list Helm releases', { error: errorMessage });
      throw new Error(`Failed to list releases: ${errorMessage}`);
    }
  }

  /**
   * Get Kubernetes resources managed by the Helm release
   */
  async getResources(): Promise<KubernetesResource[]> {
    logger.debug('Getting Kubernetes resources for Helm release', { 
      releaseName: this.config.releaseName 
    });

    try {
      // Get resources from Helm
      let command = `helm get manifest ${this.config.releaseName}`;
      
      if (this.config.namespace) {
        command += ` --namespace ${this.config.namespace}`;
      }

      const result = await execAsync(command, {
        env: this.buildEnvironment()
      });

      // Parse YAML manifests to extract resource information
      const resources = await this.parseManifestResources(result.stdout);
      
      // Get current status of each resource from Kubernetes API
      const resourcesWithStatus = await Promise.all(
        resources.map(async (resource) => {
          try {
            const status = await this.k8sClient.getResourceStatus(
              resource.kind,
              resource.name,
              resource.namespace
            );
            return {
              ...resource,
              status: status.phase || status.status || 'Unknown',
              ready: status.ready || false
            };
          } catch (error) {
            logger.warn(`Failed to get status for resource ${resource.name}:`, error);
            return {
              ...resource,
              status: 'Unknown',
              ready: false
            };
          }
        })
      );

      logger.debug('Kubernetes resources retrieved', { 
        count: resourcesWithStatus.length 
      });
      
      return resourcesWithStatus;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get Kubernetes resources', { 
        releaseName: this.config.releaseName,
        error: errorMessage 
      });
      throw new Error(`Failed to get resources: ${errorMessage}`);
    }
  }

  /**
   * Rollback a Helm release to a previous revision
   */
  async rollback(revision?: number, options: {
    wait?: boolean;
    timeout?: number;
    force?: boolean;
  } = {}): Promise<void> {
    logger.info('Rolling back Helm release', { 
      releaseName: this.config.releaseName,
      revision,
      options 
    });

    try {
      let command = `helm rollback ${this.config.releaseName}`;
      
      if (revision) {
        command += ` ${revision}`;
      }
      
      if (this.config.namespace) {
        command += ` --namespace ${this.config.namespace}`;
      }
      
      if (options.wait !== false) {
        command += ' --wait';
      }
      
      if (options.timeout) {
        command += ` --timeout ${options.timeout}s`;
      }
      
      if (options.force) {
        command += ' --force';
      }

      logger.debug('Executing Helm rollback', { command });

      const result = await execAsync(command, {
        env: this.buildEnvironment(),
        timeout: (options.timeout || this.config.timeout!) * 1000
      });

      logger.info('Helm release rolled back successfully', {
        releaseName: this.config.releaseName,
        revision
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to rollback Helm release', { 
        releaseName: this.config.releaseName,
        error: errorMessage 
      });
      throw new Error(`Failed to rollback release: ${errorMessage}`);
    }
  }

  /**
   * Test a Helm release
   */
  async test(options: {
    timeout?: number;
    logs?: boolean;
  } = {}): Promise<string> {
    logger.info('Testing Helm release', { 
      releaseName: this.config.releaseName,
      options 
    });

    try {
      let command = `helm test ${this.config.releaseName}`;
      
      if (this.config.namespace) {
        command += ` --namespace ${this.config.namespace}`;
      }
      
      if (options.timeout) {
        command += ` --timeout ${options.timeout}s`;
      }
      
      if (options.logs) {
        command += ' --logs';
      }

      logger.debug('Executing Helm test', { command });

      const result = await execAsync(command, {
        env: this.buildEnvironment(),
        timeout: (options.timeout || this.config.timeout!) * 1000
      });

      logger.info('Helm release test completed successfully', {
        releaseName: this.config.releaseName
      });

      return result.stdout;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Helm release test failed', { 
        releaseName: this.config.releaseName,
        error: errorMessage 
      });
      throw new Error(`Helm test failed: ${errorMessage}`);
    }
  }

  /**
   * Validate prerequisites for Helm operations
   */
  private async validatePrerequisites(): Promise<void> {
    // Check if Helm is installed
    try {
      await execAsync('helm version --client', { timeout: 5000 });
    } catch (error) {
      throw new Error('Helm is not installed or not available in PATH');
    }

    // Validate Kubernetes connectivity
    const isConnected = await this.k8sClient.validateConnection();
    if (!isConnected) {
      throw new Error('Cannot connect to Kubernetes cluster');
    }

    // Validate chart path exists
    if (this.config.chartPath) {
      try {
        await fs.access(this.config.chartPath, fs.constants.R_OK);
      } catch (error) {
        throw new Error(`Chart path not found or not readable: ${this.config.chartPath}`);
      }
    }
  }

  /**
   * Ensure the target namespace exists
   */
  private async ensureNamespace(): Promise<void> {
    try {
      await this.k8sClient.createNamespace(this.config.namespace);
      logger.debug('Namespace ensured', { namespace: this.config.namespace });
    } catch (error) {
      logger.warn('Failed to ensure namespace:', error);
      // Don't throw - namespace might already exist
    }
  }

  /**
   * Build the Helm command for deployment
   */
  private async buildHelmCommand(options: HelmDeploymentOptions): Promise<string> {
    const isUpgrade = options.upgrade !== false;
    const command = isUpgrade ? 'helm upgrade' : 'helm install';
    
    let args = [command];
    
    if (isUpgrade) {
      args.push(this.config.releaseName);
    } else {
      args.push(this.config.releaseName);
    }
    
    args.push(this.config.chartPath);
    
    // Add namespace
    if (this.config.namespace) {
      args.push('--namespace', this.config.namespace);
    }
    
    // Add install flag for upgrade command
    if (isUpgrade && options.install !== false) {
      args.push('--install');
    }
    
    // Add create namespace flag
    if (options.createNamespace) {
      args.push('--create-namespace');
    }
    
    // Add values files
    if (this.config.valuesFiles) {
      for (const valuesFile of this.config.valuesFiles) {
        args.push('--values', valuesFile);
      }
    }
    
    // Add inline values
    const allValues = { ...this.config.values, ...options.values };
    if (Object.keys(allValues).length > 0) {
      const valuesJson = JSON.stringify(allValues);
      args.push('--set-json', `'${valuesJson}'`);
    }
    
    // Add set values
    if (options.setValues) {
      for (const [key, value] of Object.entries(options.setValues)) {
        args.push('--set', `${key}=${value}`);
      }
    }
    
    // Add flags
    if (options.wait !== false && this.config.wait) {
      args.push('--wait');
    }
    
    if (options.waitForJobs) {
      args.push('--wait-for-jobs');
    }
    
    if (this.config.atomic && options.atomic !== false) {
      args.push('--atomic');
    }
    
    if (options.force) {
      args.push('--force');
    }
    
    if (options.dryRun) {
      args.push('--dry-run');
    }
    
    if (options.debug) {
      args.push('--debug');
    }
    
    // Add timeout
    const timeout = options.timeout || this.config.timeout;
    if (timeout) {
      args.push('--timeout', `${timeout}s`);
    }

    return args.join(' ');
  }

  /**
   * Build environment variables for Helm commands
   */
  private buildEnvironment(): Record<string, string> {
    const env: Record<string, string> = {};
    
    // Copy process.env, filtering out undefined values
    Object.entries(process.env).forEach(([key, value]) => {
      if (value !== undefined) {
        env[key] = value;
      }
    });
    
    if (this.config.kubeconfig) {
      env.KUBECONFIG = this.config.kubeconfig;
    }
    
    return env;
  }

  /**
   * Parse warnings from Helm output
   */
  private parseWarnings(output: string): string[] {
    const warnings: string[] = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (line.toLowerCase().includes('warning') || line.toLowerCase().includes('warn')) {
        warnings.push(line.trim());
      }
    }

    return warnings;
  }

  /**
   * Parse Kubernetes resources from Helm manifest output
   */
  private async parseManifestResources(manifest: string): Promise<KubernetesResource[]> {
    const resources: KubernetesResource[] = [];
    
    // Split manifest by document separator
    const documents = manifest.split('---').filter(doc => doc.trim());
    
    for (const doc of documents) {
      try {
        // Simple YAML parsing for kind, name, and namespace
        const kindMatch = doc.match(/^kind:\s*(.+)$/m);
        const nameMatch = doc.match(/^\s*name:\s*(.+)$/m);
        const namespaceMatch = doc.match(/^\s*namespace:\s*(.+)$/m);
        
        if (kindMatch && nameMatch) {
          resources.push({
            kind: kindMatch[1].trim(),
            name: nameMatch[1].trim(),
            namespace: namespaceMatch ? namespaceMatch[1].trim() : this.config.namespace,
            status: 'Unknown',
            ready: false
          });
        }
      } catch (error) {
        logger.warn('Failed to parse manifest document:', error);
      }
    }
    
    return resources;
  }
}