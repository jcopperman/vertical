/**
 * Kubernetes service management utilities
 */

import { KubernetesClient } from './client';
import { createLogger } from '../utils/logger';
import {
  KubernetesClientConfig,
  KubernetesConnectionStatus,
  ServiceInfo,
  PodInfo,
  KubernetesServiceManager
} from './types';

const logger = createLogger('k8s-service-manager');

export interface K8sServiceManagerConfig {
  namespace?: string;
  labelSelector?: string;
  timeout?: number;
}

export interface ServiceOperation {
  service: string;
  operation: 'start' | 'stop' | 'restart' | 'scale' | 'delete';
  success: boolean;
  error?: string;
}

export interface ServiceOperationResult {
  success: boolean;
  operations: ServiceOperation[];
  errors: string[];
}

export class K8sServiceManager implements KubernetesServiceManager {
  private k8sClient: KubernetesClient;
  private config: K8sServiceManagerConfig;

  constructor(
    k8sConfig: KubernetesClientConfig = {},
    config: K8sServiceManagerConfig = {}
  ) {
    this.k8sClient = new KubernetesClient(k8sConfig);
    this.config = {
      timeout: 30000,
      ...config
    };

    logger.debug('K8sServiceManager initialized', { config: this.config });
  }

  /**
   * Get all services in the configured namespace
   */
  async getServices(namespace?: string, labelSelector?: string): Promise<ServiceInfo[]> {
    try {
      const ns = namespace || this.config.namespace;
      const selector = labelSelector || this.config.labelSelector;
      
      logger.debug('Getting Kubernetes services', { namespace: ns, labelSelector: selector });
      
      const services = await this.k8sClient.listServices(ns, selector);
      
      logger.debug(`Found ${services.length} Kubernetes services`);
      return services;
    } catch (error) {
      logger.error('Failed to get Kubernetes services', { error });
      throw new Error(`Failed to get services: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get a specific service by name
   */
  async getService(name: string, namespace: string): Promise<ServiceInfo | null> {
    try {
      logger.debug('Getting Kubernetes service', { name, namespace });
      
      const services = await this.getServices(namespace);
      const service = services.find(s => s.name === name);
      
      if (service) {
        logger.debug('Kubernetes service found', { name });
      } else {
        logger.debug('Kubernetes service not found', { name });
      }
      
      return service || null;
    } catch (error) {
      logger.error('Failed to get Kubernetes service', { name, namespace, error });
      throw new Error(`Failed to get service: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get pods for services (equivalent to containers in Docker)
   */
  async getPods(namespace?: string, labelSelector?: string): Promise<PodInfo[]> {
    try {
      const ns = namespace || this.config.namespace;
      const selector = labelSelector || this.config.labelSelector;
      
      logger.debug('Getting Kubernetes pods', { namespace: ns, labelSelector: selector });
      
      const pods = await this.k8sClient.listPods(ns, selector);
      
      logger.debug(`Found ${pods.length} Kubernetes pods`);
      return pods;
    } catch (error) {
      logger.error('Failed to get Kubernetes pods', { error });
      throw new Error(`Failed to get pods: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get logs from pods associated with a service
   */
  async getPodLogs(serviceName: string, namespace: string, tail: number = 100): Promise<Record<string, string>> {
    try {
      logger.debug('Getting pod logs for service', { serviceName, namespace, tail });
      
      // Get pods that belong to this service (by label selector)
      const labelSelector = `app=${serviceName}`;
      const pods = await this.k8sClient.listPods(namespace, labelSelector);
      
      if (pods.length === 0) {
        logger.warn('No pods found for service', { serviceName, namespace });
        return {};
      }

      const logs: Record<string, string> = {};
      
      for (const pod of pods) {
        try {
          const podLogs = await this.k8sClient.getPodLogs(pod.name, pod.namespace, {
            tail,
            timestamps: true
          });
          logs[pod.name] = podLogs;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logs[pod.name] = `Error getting logs: ${errorMessage}`;
          logger.warn('Failed to get logs for pod', { podName: pod.name, error: errorMessage });
        }
      }

      logger.debug('Pod logs retrieved for service', { serviceName, podCount: Object.keys(logs).length });
      return logs;
    } catch (error) {
      logger.error('Failed to get pod logs for service', { serviceName, namespace, error });
      throw new Error(`Failed to get pod logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Scale a deployment (equivalent to starting/stopping services)
   */
  async scaleDeployment(deploymentName: string, namespace: string, replicas: number): Promise<ServiceOperation> {
    try {
      logger.info('Scaling deployment', { deploymentName, namespace, replicas });
      
      const command = `kubectl scale deployment ${deploymentName} --replicas=${replicas} -n ${namespace}`;
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      await execAsync(command, { timeout: this.config.timeout });

      logger.info('Deployment scaled successfully', { deploymentName, replicas });
      
      return {
        service: deploymentName,
        operation: replicas > 0 ? 'start' : 'stop',
        success: true
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to scale deployment', { deploymentName, namespace, replicas, error: errorMessage });
      
      return {
        service: deploymentName,
        operation: replicas > 0 ? 'start' : 'stop',
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Restart a deployment by triggering a rollout restart
   */
  async restartDeployment(deploymentName: string, namespace: string): Promise<ServiceOperation> {
    try {
      logger.info('Restarting deployment', { deploymentName, namespace });
      
      const command = `kubectl rollout restart deployment ${deploymentName} -n ${namespace}`;
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      await execAsync(command, { timeout: this.config.timeout });

      logger.info('Deployment restarted successfully', { deploymentName });
      
      return {
        service: deploymentName,
        operation: 'restart',
        success: true
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to restart deployment', { deploymentName, namespace, error: errorMessage });
      
      return {
        service: deploymentName,
        operation: 'restart',
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Delete a deployment and its associated resources
   */
  async deleteDeployment(deploymentName: string, namespace: string): Promise<ServiceOperation> {
    try {
      logger.info('Deleting deployment', { deploymentName, namespace });
      
      const command = `kubectl delete deployment ${deploymentName} -n ${namespace}`;
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      await execAsync(command, { timeout: this.config.timeout });

      logger.info('Deployment deleted successfully', { deploymentName });
      
      return {
        service: deploymentName,
        operation: 'delete',
        success: true
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to delete deployment', { deploymentName, namespace, error: errorMessage });
      
      return {
        service: deploymentName,
        operation: 'delete',
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Scale multiple deployments
   */
  async scaleDeployments(deployments: Array<{ name: string; namespace: string; replicas: number }>): Promise<ServiceOperationResult> {
    logger.info('Scaling multiple deployments', { count: deployments.length });
    
    const operations: ServiceOperation[] = [];
    const errors: string[] = [];

    for (const deployment of deployments) {
      const result = await this.scaleDeployment(deployment.name, deployment.namespace, deployment.replicas);
      operations.push(result);
      
      if (!result.success && result.error) {
        errors.push(`${deployment.name}: ${result.error}`);
      }
    }

    const success = operations.every(op => op.success);
    
    logger.info('Multiple deployment scaling completed', { 
      success, 
      successCount: operations.filter(op => op.success).length,
      totalCount: operations.length 
    });

    return {
      success,
      operations,
      errors
    };
  }

  /**
   * Wait for deployment to be ready
   */
  async waitForDeploymentReady(
    deploymentName: string, 
    namespace: string,
    timeout: number = 300000 // 5 minutes
  ): Promise<boolean> {
    logger.debug('Waiting for deployment to be ready', { deploymentName, namespace, timeout });
    
    const startTime = Date.now();
    const checkInterval = 5000; // 5 seconds
    
    while (Date.now() - startTime < timeout) {
      try {
        const command = `kubectl get deployment ${deploymentName} -n ${namespace} -o json`;
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        const result = await execAsync(command);
        const deployment = JSON.parse(result.stdout);
        
        const readyReplicas = deployment.status?.readyReplicas || 0;
        const replicas = deployment.status?.replicas || 0;
        
        if (readyReplicas === replicas && replicas > 0) {
          logger.info('Deployment is ready', { deploymentName, elapsed: Date.now() - startTime });
          return true;
        }
        
        logger.debug('Deployment not yet ready, waiting...', { 
          deploymentName, 
          readyReplicas,
          replicas,
          elapsed: Date.now() - startTime 
        });
        
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      } catch (error) {
        logger.debug('Error checking deployment readiness, retrying...', { deploymentName, error });
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
    }
    
    logger.warn('Deployment readiness check timed out', { deploymentName, timeout });
    return false;
  }

  /**
   * Get deployment status
   */
  async getDeploymentStatus(deploymentName: string, namespace: string): Promise<{
    name: string;
    namespace: string;
    replicas: number;
    readyReplicas: number;
    availableReplicas: number;
    status: string;
  }> {
    try {
      logger.debug('Getting deployment status', { deploymentName, namespace });
      
      const command = `kubectl get deployment ${deploymentName} -n ${namespace} -o json`;
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const result = await execAsync(command);
      const deployment = JSON.parse(result.stdout);
      
      const status = {
        name: deployment.metadata.name,
        namespace: deployment.metadata.namespace,
        replicas: deployment.status?.replicas || 0,
        readyReplicas: deployment.status?.readyReplicas || 0,
        availableReplicas: deployment.status?.availableReplicas || 0,
        status: deployment.status?.conditions?.find((c: any) => c.type === 'Progressing')?.status === 'True' ? 'Ready' : 'NotReady'
      };

      logger.debug('Deployment status retrieved', { deploymentName, status: status.status });
      return status;
    } catch (error) {
      logger.error('Failed to get deployment status', { deploymentName, namespace, error });
      throw new Error(`Failed to get deployment status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate Kubernetes connectivity
   */
  async validateConnection(): Promise<KubernetesConnectionStatus> {
    return this.k8sClient.getConnectionStatus();
  }

  /**
   * Get the Kubernetes client instance
   */
  getKubernetesClient(): KubernetesClient {
    return this.k8sClient;
  }
}