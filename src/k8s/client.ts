/**
 * Kubernetes API client implementation
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../utils/logger';
import {
  KubernetesClientConfig,
  KubernetesConnectionStatus,
  ResourceStatus,
  PodInfo,
  ServiceInfo,
  NamespaceInfo
} from './types';

const execAsync = promisify(exec);
const logger = createLogger('k8s-client');



export class KubernetesClient {
  private config: KubernetesClientConfig;

  constructor(config: KubernetesClientConfig = {}) {
    this.config = {
      timeout: 30000,
      ...config
    };

    logger.debug('KubernetesClient initialized', { config: this.config });
  }

  /**
   * Validate Kubernetes cluster connectivity
   */
  async validateConnection(): Promise<boolean> {
    try {
      logger.debug('Validating Kubernetes connection');
      
      const command = 'kubectl cluster-info';
      await execAsync(command, {
        env: this.buildEnvironment(),
        timeout: this.config.timeout
      });

      logger.debug('Kubernetes connection validated');
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Kubernetes connection validation failed', { error: errorMessage });
      return false;
    }
  }

  /**
   * Get Kubernetes cluster and client version information
   */
  async getConnectionStatus(): Promise<KubernetesConnectionStatus> {
    try {
      logger.debug('Getting Kubernetes connection status');
      
      const command = 'kubectl version --output=json';
      const result = await execAsync(command, {
        env: this.buildEnvironment(),
        timeout: this.config.timeout
      });

      const versionInfo = JSON.parse(result.stdout);
      
      const status: KubernetesConnectionStatus = {
        connected: true,
        version: versionInfo.clientVersion?.gitVersion,
        serverVersion: versionInfo.serverVersion?.gitVersion
      };

      logger.debug('Kubernetes connection status retrieved', status);
      return status;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get Kubernetes connection status', { error: errorMessage });
      
      return {
        connected: false,
        error: errorMessage
      };
    }
  }

  /**
   * Create a namespace if it doesn't exist
   */
  async createNamespace(namespace: string): Promise<void> {
    try {
      logger.debug('Creating namespace', { namespace });
      
      const command = `kubectl create namespace ${namespace} --dry-run=client -o yaml | kubectl apply -f -`;
      await execAsync(command, {
        env: this.buildEnvironment(),
        timeout: this.config.timeout
      });

      logger.debug('Namespace created or already exists', { namespace });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to create namespace', { namespace, error: errorMessage });
      throw new Error(`Failed to create namespace: ${errorMessage}`);
    }
  }

  /**
   * Delete a namespace
   */
  async deleteNamespace(namespace: string, force: boolean = false): Promise<void> {
    try {
      logger.debug('Deleting namespace', { namespace, force });
      
      let command = `kubectl delete namespace ${namespace}`;
      if (force) {
        command += ' --force --grace-period=0';
      }

      await execAsync(command, {
        env: this.buildEnvironment(),
        timeout: this.config.timeout
      });

      logger.debug('Namespace deleted', { namespace });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to delete namespace', { namespace, error: errorMessage });
      throw new Error(`Failed to delete namespace: ${errorMessage}`);
    }
  }

  /**
   * List all namespaces
   */
  async listNamespaces(): Promise<NamespaceInfo[]> {
    try {
      logger.debug('Listing namespaces');
      
      const command = 'kubectl get namespaces -o json';
      const result = await execAsync(command, {
        env: this.buildEnvironment(),
        timeout: this.config.timeout
      });

      const namespacesData = JSON.parse(result.stdout);
      
      const namespaces: NamespaceInfo[] = namespacesData.items.map((ns: any) => ({
        name: ns.metadata.name,
        status: ns.status.phase,
        age: this.calculateAge(ns.metadata.creationTimestamp)
      }));

      logger.debug('Namespaces listed', { count: namespaces.length });
      return namespaces;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to list namespaces', { error: errorMessage });
      throw new Error(`Failed to list namespaces: ${errorMessage}`);
    }
  }

  /**
   * Get status of a specific Kubernetes resource
   */
  async getResourceStatus(kind: string, name: string, namespace: string): Promise<ResourceStatus> {
    try {
      logger.debug('Getting resource status', { kind, name, namespace });
      
      const command = `kubectl get ${kind} ${name} -n ${namespace} -o json`;
      const result = await execAsync(command, {
        env: this.buildEnvironment(),
        timeout: this.config.timeout
      });

      const resource = JSON.parse(result.stdout);
      
      const status: ResourceStatus = {
        phase: resource.status?.phase,
        status: resource.status?.status,
        ready: this.isResourceReady(resource),
        conditions: resource.status?.conditions || []
      };

      logger.debug('Resource status retrieved', { kind, name, status: status.phase || status.status });
      return status;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get resource status', { kind, name, namespace, error: errorMessage });
      throw new Error(`Failed to get resource status: ${errorMessage}`);
    }
  }

  /**
   * List pods in a namespace
   */
  async listPods(namespace?: string, labelSelector?: string): Promise<PodInfo[]> {
    try {
      logger.debug('Listing pods', { namespace, labelSelector });
      
      let command = 'kubectl get pods -o json';
      
      if (namespace) {
        command += ` -n ${namespace}`;
      } else {
        command += ' --all-namespaces';
      }
      
      if (labelSelector) {
        command += ` -l "${labelSelector}"`;
      }

      const result = await execAsync(command, {
        env: this.buildEnvironment(),
        timeout: this.config.timeout
      });

      const podsData = JSON.parse(result.stdout);
      
      const pods: PodInfo[] = podsData.items.map((pod: any) => ({
        name: pod.metadata.name,
        namespace: pod.metadata.namespace,
        phase: pod.status.phase,
        ready: this.isPodReady(pod),
        restarts: this.getPodRestarts(pod),
        age: this.calculateAge(pod.metadata.creationTimestamp),
        node: pod.spec.nodeName
      }));

      logger.debug('Pods listed', { count: pods.length });
      return pods;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to list pods', { namespace, error: errorMessage });
      throw new Error(`Failed to list pods: ${errorMessage}`);
    }
  }

  /**
   * List services in a namespace
   */
  async listServices(namespace?: string, labelSelector?: string): Promise<ServiceInfo[]> {
    try {
      logger.debug('Listing services', { namespace, labelSelector });
      
      let command = 'kubectl get services -o json';
      
      if (namespace) {
        command += ` -n ${namespace}`;
      } else {
        command += ' --all-namespaces';
      }
      
      if (labelSelector) {
        command += ` -l "${labelSelector}"`;
      }

      const result = await execAsync(command, {
        env: this.buildEnvironment(),
        timeout: this.config.timeout
      });

      const servicesData = JSON.parse(result.stdout);
      
      const services: ServiceInfo[] = servicesData.items.map((svc: any) => ({
        name: svc.metadata.name,
        namespace: svc.metadata.namespace,
        type: svc.spec.type,
        clusterIP: svc.spec.clusterIP,
        externalIP: svc.status?.loadBalancer?.ingress?.[0]?.ip,
        ports: svc.spec.ports?.map((port: any) => ({
          name: port.name,
          port: port.port,
          targetPort: port.targetPort,
          protocol: port.protocol
        })) || []
      }));

      logger.debug('Services listed', { count: services.length });
      return services;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to list services', { namespace, error: errorMessage });
      throw new Error(`Failed to list services: ${errorMessage}`);
    }
  }

  /**
   * Get logs from a pod
   */
  async getPodLogs(
    podName: string, 
    namespace: string, 
    options: {
      container?: string;
      tail?: number;
      since?: string;
      follow?: boolean;
      timestamps?: boolean;
    } = {}
  ): Promise<string> {
    try {
      logger.debug('Getting pod logs', { podName, namespace, options });
      
      let command = `kubectl logs ${podName} -n ${namespace}`;
      
      if (options.container) {
        command += ` -c ${options.container}`;
      }
      
      if (options.tail) {
        command += ` --tail=${options.tail}`;
      }
      
      if (options.since) {
        command += ` --since=${options.since}`;
      }
      
      if (options.timestamps) {
        command += ' --timestamps';
      }
      
      // Note: follow mode would require streaming, not implemented here

      const result = await execAsync(command, {
        env: this.buildEnvironment(),
        timeout: this.config.timeout
      });

      logger.debug('Pod logs retrieved', { podName, logLength: result.stdout.length });
      return result.stdout;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get pod logs', { podName, namespace, error: errorMessage });
      throw new Error(`Failed to get pod logs: ${errorMessage}`);
    }
  }

  /**
   * Execute a command in a pod
   */
  async execInPod(
    podName: string,
    namespace: string,
    command: string,
    options: {
      container?: string;
      stdin?: boolean;
      tty?: boolean;
    } = {}
  ): Promise<string> {
    try {
      logger.debug('Executing command in pod', { podName, namespace, command, options });
      
      let execCommand = `kubectl exec ${podName} -n ${namespace}`;
      
      if (options.container) {
        execCommand += ` -c ${options.container}`;
      }
      
      if (options.stdin) {
        execCommand += ' -i';
      }
      
      if (options.tty) {
        execCommand += ' -t';
      }
      
      execCommand += ` -- ${command}`;

      const result = await execAsync(execCommand, {
        env: this.buildEnvironment(),
        timeout: this.config.timeout
      });

      logger.debug('Command executed in pod', { podName, outputLength: result.stdout.length });
      return result.stdout;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to execute command in pod', { podName, namespace, command, error: errorMessage });
      throw new Error(`Failed to execute command in pod: ${errorMessage}`);
    }
  }

  /**
   * Apply Kubernetes manifests from YAML
   */
  async applyManifest(manifest: string, namespace?: string): Promise<void> {
    try {
      logger.debug('Applying Kubernetes manifest', { namespace });
      
      let command = 'kubectl apply -f -';
      
      if (namespace) {
        command += ` -n ${namespace}`;
      }

      const { spawn } = await import('child_process');
      
      return new Promise((resolve, reject) => {
        const kubectl = spawn('kubectl', command.split(' ').slice(1), {
          env: this.buildEnvironment(),
          stdio: ['pipe', 'pipe', 'pipe']
        });

        kubectl.stdin.write(manifest);
        kubectl.stdin.end();

        let stdout = '';
        let stderr = '';

        kubectl.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        kubectl.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        kubectl.on('close', (code) => {
          if (code === 0) {
            logger.debug('Kubernetes manifest applied successfully');
            resolve();
          } else {
            logger.error('Failed to apply Kubernetes manifest', { code, stderr });
            reject(new Error(`kubectl apply failed: ${stderr}`));
          }
        });

        kubectl.on('error', (error) => {
          logger.error('Error executing kubectl apply', { error });
          reject(error);
        });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to apply manifest', { error: errorMessage });
      throw new Error(`Failed to apply manifest: ${errorMessage}`);
    }
  }

  /**
   * Delete Kubernetes resources by manifest
   */
  async deleteManifest(manifest: string, namespace?: string): Promise<void> {
    try {
      logger.debug('Deleting Kubernetes resources from manifest', { namespace });
      
      let command = 'kubectl delete -f -';
      
      if (namespace) {
        command += ` -n ${namespace}`;
      }

      const { spawn } = await import('child_process');
      
      return new Promise((resolve, reject) => {
        const kubectl = spawn('kubectl', command.split(' ').slice(1), {
          env: this.buildEnvironment(),
          stdio: ['pipe', 'pipe', 'pipe']
        });

        kubectl.stdin.write(manifest);
        kubectl.stdin.end();

        let stdout = '';
        let stderr = '';

        kubectl.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        kubectl.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        kubectl.on('close', (code) => {
          if (code === 0) {
            logger.debug('Kubernetes resources deleted successfully');
            resolve();
          } else {
            logger.error('Failed to delete Kubernetes resources', { code, stderr });
            reject(new Error(`kubectl delete failed: ${stderr}`));
          }
        });

        kubectl.on('error', (error) => {
          logger.error('Error executing kubectl delete', { error });
          reject(error);
        });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to delete manifest', { error: errorMessage });
      throw new Error(`Failed to delete manifest: ${errorMessage}`);
    }
  }

  /**
   * Build environment variables for kubectl commands
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
    
    if (this.config.context) {
      env.KUBECTL_CONTEXT = this.config.context;
    }
    
    return env;
  }

  /**
   * Check if a resource is ready based on its status
   */
  private isResourceReady(resource: any): boolean {
    // Check different resource types
    switch (resource.kind) {
      case 'Pod':
        return this.isPodReady(resource);
      case 'Deployment':
        return resource.status?.readyReplicas === resource.status?.replicas;
      case 'Service':
        return true; // Services are generally ready when created
      case 'StatefulSet':
        return resource.status?.readyReplicas === resource.status?.replicas;
      case 'DaemonSet':
        return resource.status?.numberReady === resource.status?.desiredNumberScheduled;
      default:
        // For unknown resource types, check conditions
        const conditions = resource.status?.conditions || [];
        return conditions.some((condition: any) => 
          condition.type === 'Ready' && condition.status === 'True'
        );
    }
  }

  /**
   * Check if a pod is ready
   */
  private isPodReady(pod: any): boolean {
    const conditions = pod.status?.conditions || [];
    return conditions.some((condition: any) => 
      condition.type === 'Ready' && condition.status === 'True'
    );
  }

  /**
   * Get the number of restarts for a pod
   */
  private getPodRestarts(pod: any): number {
    const containerStatuses = pod.status?.containerStatuses || [];
    return containerStatuses.reduce((total: number, status: any) => 
      total + (status.restartCount || 0), 0
    );
  }

  /**
   * Calculate age from creation timestamp
   */
  private calculateAge(creationTimestamp: string): string {
    const created = new Date(creationTimestamp);
    const now = new Date();
    const diffMs = now.getTime() - created.getTime();
    
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) {
      return `${days}d`;
    } else if (hours > 0) {
      return `${hours}h`;
    } else {
      return `${minutes}m`;
    }
  }
}