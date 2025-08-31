/**
 * Types for Kubernetes and Helm integration
 */

export interface KubernetesClientConfig {
  kubeconfig?: string;
  context?: string;
  namespace?: string;
  timeout?: number;
}

export interface KubernetesConnectionStatus {
  connected: boolean;
  version?: string;
  serverVersion?: string;
  error?: string;
}

export interface ResourceStatus {
  phase?: string;
  status?: string;
  ready: boolean;
  conditions?: Array<{
    type: string;
    status: string;
    reason?: string;
    message?: string;
  }>;
}

export interface PodInfo {
  name: string;
  namespace: string;
  phase: string;
  ready: boolean;
  restarts: number;
  age: string;
  node?: string;
}

export interface ServiceInfo {
  name: string;
  namespace: string;
  type: string;
  clusterIP: string;
  externalIP?: string;
  ports: Array<{
    name?: string;
    port: number;
    targetPort: string | number;
    protocol: string;
  }>;
}

export interface NamespaceInfo {
  name: string;
  status: string;
  age: string;
}

export interface HelmConfig {
  chartPath: string;
  releaseName: string;
  namespace: string;
  valuesFiles?: string[];
  values?: Record<string, any>;
  kubeconfig?: string;
  timeout?: number;
  wait?: boolean;
  atomic?: boolean;
}

export interface HelmDeploymentOptions {
  upgrade?: boolean;
  install?: boolean;
  createNamespace?: boolean;
  dryRun?: boolean;
  debug?: boolean;
  force?: boolean;
  resetValues?: boolean;
  reuseValues?: boolean;
  waitForJobs?: boolean;
  wait?: boolean;
  atomic?: boolean;
  timeout?: number;
  values?: Record<string, any>;
  setValues?: Record<string, string>;
}

export interface HelmDeploymentResult {
  success: boolean;
  releaseName: string;
  namespace: string;
  revision: number;
  status: string;
  deploymentTime: number;
  resources: KubernetesResource[];
  errors: string[];
  warnings: string[];
}

export interface KubernetesResource {
  kind: string;
  name: string;
  namespace: string;
  status: string;
  ready: boolean;
}

export interface HelmRelease {
  name: string;
  namespace: string;
  revision: number;
  updated: Date;
  status: string;
  chart: string;
  appVersion: string;
}

export interface HelmStatus {
  releaseName: string;
  namespace: string;
  status: string;
  revision: number;
  lastDeployed: Date;
  resources: KubernetesResource[];
  notes?: string;
}

export interface KubernetesServiceManager {
  getServices(namespace?: string, labelSelector?: string): Promise<ServiceInfo[]>;
  getService(name: string, namespace: string): Promise<ServiceInfo | null>;
  getPods(namespace?: string, labelSelector?: string): Promise<PodInfo[]>;
  getPodLogs(podName: string, namespace: string, tail?: number): Promise<Record<string, string>>;
  validateConnection(): Promise<KubernetesConnectionStatus>;
}