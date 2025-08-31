/**
 * Grafana Integration - Handles authentication and dashboard URL generation
 */

import axios, { AxiosInstance } from 'axios';
import { createLogger } from '../utils/logger';
import { GrafanaConfig, AuthConfig } from '../config/types';

export interface GrafanaIntegration {
  authenticate(): Promise<string>;
  buildDashboardUrl(runId?: string, filters?: DashboardFilters): string;
  validateConnection(): Promise<boolean>;
  getDashboards(): Promise<DashboardInfo[]>;
  openDashboard(dashboardUid: string, runId?: string): Promise<string>;
}

export interface DashboardFilters {
  suite?: string;
  environment?: string;
  status?: string;
  timeRange?: {
    from: string;
    to: string;
  };
  [key: string]: any;
}

export interface DashboardInfo {
  uid: string;
  title: string;
  url: string;
  tags: string[];
}

export interface GrafanaAuthResult {
  success: boolean;
  token?: string;
  error?: string;
}

export class DefaultGrafanaIntegration implements GrafanaIntegration {
  private logger = createLogger('GrafanaIntegration');
  private config: GrafanaConfig;
  private httpClient: AxiosInstance;
  private authToken?: string;

  constructor(config: GrafanaConfig) {
    this.config = config;
    this.httpClient = axios.create({
      baseURL: this.config.url,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Set up request interceptor for authentication
    this.httpClient.interceptors.request.use((config) => {
      if (this.authToken) {
        config.headers.Authorization = `Bearer ${this.authToken}`;
      } else if (this.config.auth) {
        this.addAuthHeaders(config);
      }
      return config;
    });
  }

  /**
   * Authenticate with Grafana and obtain access token
   */
  async authenticate(): Promise<string> {
    this.logger.debug('Authenticating with Grafana');

    try {
      if (!this.config.auth) {
        this.logger.debug('No authentication configured, assuming anonymous access');
        return 'anonymous';
      }

      const authResult = await this.performAuthentication();
      
      if (!authResult.success) {
        throw new Error(authResult.error || 'Authentication failed');
      }

      if (authResult.token) {
        this.authToken = authResult.token;
        this.logger.debug('Successfully authenticated with Grafana');
        return authResult.token;
      }

      return 'authenticated';

    } catch (error) {
      this.logger.error('Failed to authenticate with Grafana:', error);
      throw error;
    }
  }

  /**
   * Build dashboard URL with optional run filtering and custom filters
   */
  buildDashboardUrl(runId?: string, filters?: DashboardFilters): string {
    this.logger.debug(`Building dashboard URL for run ${runId || 'latest'}`);

    try {
      // Use the first configured dashboard or default to explore
      const dashboard = this.config.dashboards[0];
      const dashboardPath = dashboard ? `/d/${dashboard.uid}/${dashboard.name}` : '/explore';
      
      const url = new URL(`${this.config.url}${dashboardPath}`);
      
      // Add run ID filter if provided
      if (runId) {
        url.searchParams.set('var-run_id', runId);
      }

      // Add dashboard-specific filters
      if (dashboard?.filters) {
        Object.entries(dashboard.filters).forEach(([key, value]) => {
          url.searchParams.set(`var-${key}`, value);
        });
      }

      // Add custom filters
      if (filters) {
        this.addFiltersToUrl(url, filters);
      }

      // Set default time range if not specified
      if (!filters?.timeRange) {
        url.searchParams.set('from', 'now-1h');
        url.searchParams.set('to', 'now');
      }

      const finalUrl = url.toString();
      this.logger.debug(`Generated dashboard URL: ${finalUrl}`);
      return finalUrl;

    } catch (error) {
      this.logger.error('Failed to build dashboard URL:', error);
      // Return basic URL as fallback
      return `${this.config.url}/explore`;
    }
  }

  /**
   * Validate connection to Grafana instance
   */
  async validateConnection(): Promise<boolean> {
    this.logger.debug('Validating Grafana connection');

    try {
      // Try to access the health endpoint
      const response = await this.httpClient.get('/api/health');
      
      if (response.status === 200) {
        this.logger.debug('Grafana connection validated successfully');
        return true;
      }

      this.logger.warn(`Grafana health check returned status ${response.status}`);
      return false;

    } catch (error) {
      this.logger.debug('Grafana connection validation failed:', error);
      return false;
    }
  }

  /**
   * Get list of available dashboards
   */
  async getDashboards(): Promise<DashboardInfo[]> {
    this.logger.debug('Fetching available dashboards');

    try {
      // Ensure we're authenticated
      await this.authenticate();

      const response = await this.httpClient.get('/api/search', {
        params: {
          type: 'dash-db',
          limit: 100
        }
      });

      const dashboards: DashboardInfo[] = response.data.map((item: any) => ({
        uid: item.uid,
        title: item.title,
        url: `${this.config.url}/d/${item.uid}/${item.url}`,
        tags: item.tags || []
      }));

      this.logger.debug(`Found ${dashboards.length} dashboards`);
      return dashboards;

    } catch (error) {
      this.logger.error('Failed to fetch dashboards:', error);
      // Return configured dashboards as fallback
      return this.config.dashboards.map(dashboard => ({
        uid: dashboard.uid,
        title: dashboard.name,
        url: `${this.config.url}/d/${dashboard.uid}/${dashboard.name}`,
        tags: []
      }));
    }
  }

  /**
   * Open a specific dashboard with optional run filtering
   */
  async openDashboard(dashboardUid: string, runId?: string): Promise<string> {
    this.logger.debug(`Opening dashboard ${dashboardUid} for run ${runId || 'latest'}`);

    try {
      // Find the dashboard configuration
      const dashboard = this.config.dashboards.find(d => d.uid === dashboardUid);
      
      if (!dashboard) {
        throw new Error(`Dashboard with UID ${dashboardUid} not found in configuration`);
      }

      // Build URL with dashboard-specific filters
      const filters: DashboardFilters = {};
      
      if (dashboard.filters) {
        Object.assign(filters, dashboard.filters);
      }

      return this.buildDashboardUrl(runId, filters);

    } catch (error) {
      this.logger.error(`Failed to open dashboard ${dashboardUid}:`, error);
      throw error;
    }
  }

  /**
   * Perform authentication based on configured auth type
   */
  private async performAuthentication(): Promise<GrafanaAuthResult> {
    const auth = this.config.auth!;

    switch (auth.type) {
      case 'token':
        return this.authenticateWithToken(auth.token!);
      
      case 'basic':
        return this.authenticateWithBasic(auth.username!, auth.password!);
      
      case 'oauth':
        return this.authenticateWithOAuth();
      
      default:
        return {
          success: false,
          error: `Unsupported authentication type: ${auth.type}`
        };
    }
  }

  /**
   * Authenticate using API token
   */
  private async authenticateWithToken(token: string): Promise<GrafanaAuthResult> {
    try {
      // Test the token by making a simple API call
      const response = await this.httpClient.get('/api/user', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (response.status === 200) {
        return {
          success: true,
          token: token
        };
      }

      return {
        success: false,
        error: 'Invalid token'
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Token authentication failed'
      };
    }
  }

  /**
   * Authenticate using basic authentication
   */
  private async authenticateWithBasic(username: string, password: string): Promise<GrafanaAuthResult> {
    try {
      const credentials = Buffer.from(`${username}:${password}`).toString('base64');
      
      const response = await this.httpClient.get('/api/user', {
        headers: {
          Authorization: `Basic ${credentials}`
        }
      });

      if (response.status === 200) {
        return {
          success: true,
          token: credentials
        };
      }

      return {
        success: false,
        error: 'Invalid credentials'
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Basic authentication failed'
      };
    }
  }

  /**
   * Authenticate using OAuth (placeholder implementation)
   */
  private async authenticateWithOAuth(): Promise<GrafanaAuthResult> {
    // OAuth implementation would be more complex and depend on the specific OAuth provider
    // For now, return a placeholder implementation
    return {
      success: false,
      error: 'OAuth authentication not yet implemented'
    };
  }

  /**
   * Add authentication headers to request config
   */
  private addAuthHeaders(config: any): void {
    const auth = this.config.auth!;

    switch (auth.type) {
      case 'token':
        if (auth.token) {
          config.headers.Authorization = `Bearer ${auth.token}`;
        }
        break;
      
      case 'basic':
        if (auth.username && auth.password) {
          const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
          config.headers.Authorization = `Basic ${credentials}`;
        }
        break;
    }
  }

  /**
   * Add filters to URL search parameters
   */
  private addFiltersToUrl(url: URL, filters: DashboardFilters): void {
    Object.entries(filters).forEach(([key, value]) => {
      if (key === 'timeRange' && typeof value === 'object') {
        url.searchParams.set('from', value.from);
        url.searchParams.set('to', value.to);
      } else if (typeof value === 'string') {
        url.searchParams.set(`var-${key}`, value);
      }
    });
  }
}