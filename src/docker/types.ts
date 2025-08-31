/**
 * Docker integration types and interfaces
 */

export interface DockerClientConfig {
  socketPath?: string;
  host?: string;
  port?: number;
  protocol?: 'http' | 'https';
  timeout?: number;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead';
  state: 'running' | 'stopped' | 'error';
  ports: PortMapping[];
  labels: Record<string, string>;
  created: Date;
}

export interface PortMapping {
  privatePort: number;
  publicPort?: number;
  type: 'tcp' | 'udp';
  ip?: string;
}

export interface ServiceInfo {
  name: string;
  containers: ContainerInfo[];
  status: 'running' | 'starting' | 'stopped' | 'error';
  health: 'healthy' | 'unhealthy' | 'unknown';
  endpoints: ServiceEndpoint[];
}

export interface ServiceEndpoint {
  name: string;
  url: string;
  port: number;
  protocol: 'http' | 'https' | 'tcp' | 'udp';
}

export interface DockerConnectionStatus {
  connected: boolean;
  version?: string;
  apiVersion?: string;
  error?: string;
}

export interface ContainerStats {
  cpuUsage: number;
  memoryUsage: number;
  memoryLimit: number;
  networkRx: number;
  networkTx: number;
}

export interface DockerClientOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}