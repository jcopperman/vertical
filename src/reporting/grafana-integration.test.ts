/**
 * Tests for Grafana Integration
 */

import axios from 'axios';
import { DefaultGrafanaIntegration, DashboardFilters } from './grafana-integration';
import { GrafanaConfig } from '../config/types';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DefaultGrafanaIntegration', () => {
  let grafanaIntegration: DefaultGrafanaIntegration;
  let mockAxiosInstance: any;
  let grafanaConfig: GrafanaConfig;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock axios instance
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      interceptors: {
        request: {
          use: jest.fn()
        }
      }
    };

    mockedAxios.create.mockReturnValue(mockAxiosInstance);

    // Create test configuration
    grafanaConfig = {
      url: 'http://localhost:3000',
      dashboards: [
        {
          name: 'test-dashboard',
          uid: 'test-uid',
          filters: {
            environment: 'test'
          }
        }
      ]
    };

    grafanaIntegration = new DefaultGrafanaIntegration(grafanaConfig);
  });

  describe('constructor', () => {
    it('should create axios instance with correct configuration', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:3000',
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    });

    it('should set up request interceptor', () => {
      expect(mockAxiosInstance.interceptors.request.use).toHaveBeenCalled();
    });
  });

  describe('authenticate', () => {
    it('should return anonymous when no auth configured', async () => {
      const result = await grafanaIntegration.authenticate();
      expect(result).toBe('anonymous');
    });

    it('should authenticate with token successfully', async () => {
      grafanaConfig.auth = {
        type: 'token',
        token: 'test-token'
      };
      grafanaIntegration = new DefaultGrafanaIntegration(grafanaConfig);

      mockAxiosInstance.get.mockResolvedValue({
        status: 200,
        data: { id: 1, login: 'admin' }
      });

      const result = await grafanaIntegration.authenticate();
      expect(result).toBe('test-token');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/user', {
        headers: {
          Authorization: 'Bearer test-token'
        }
      });
    });

    it('should authenticate with basic auth successfully', async () => {
      grafanaConfig.auth = {
        type: 'basic',
        username: 'admin',
        password: 'password'
      };
      grafanaIntegration = new DefaultGrafanaIntegration(grafanaConfig);

      mockAxiosInstance.get.mockResolvedValue({
        status: 200,
        data: { id: 1, login: 'admin' }
      });

      const result = await grafanaIntegration.authenticate();
      expect(result).toBe('YWRtaW46cGFzc3dvcmQ='); // base64 encoded admin:password

      const expectedAuth = Buffer.from('admin:password').toString('base64');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/user', {
        headers: {
          Authorization: `Basic ${expectedAuth}`
        }
      });
    });

    it('should handle authentication failure', async () => {
      grafanaConfig.auth = {
        type: 'token',
        token: 'invalid-token'
      };
      grafanaIntegration = new DefaultGrafanaIntegration(grafanaConfig);

      mockAxiosInstance.get.mockRejectedValue(new Error('Unauthorized'));

      await expect(grafanaIntegration.authenticate()).rejects.toThrow('Unauthorized');
    });

    it('should handle unsupported auth type', async () => {
      grafanaConfig.auth = {
        type: 'oauth' as any
      };
      grafanaIntegration = new DefaultGrafanaIntegration(grafanaConfig);

      await expect(grafanaIntegration.authenticate()).rejects.toThrow('OAuth authentication not yet implemented');
    });
  });

  describe('buildDashboardUrl', () => {
    it('should build URL with dashboard UID and run ID', () => {
      const url = grafanaIntegration.buildDashboardUrl('test-run-123');
      
      expect(url).toContain('/d/test-uid/test-dashboard');
      expect(url).toContain('var-run_id=test-run-123');
      expect(url).toContain('var-environment=test');
    });

    it('should build URL without run ID', () => {
      const url = grafanaIntegration.buildDashboardUrl();
      
      expect(url).toContain('/d/test-uid/test-dashboard');
      expect(url).not.toContain('var-run_id');
      expect(url).toContain('var-environment=test');
    });

    it('should add custom filters', () => {
      const filters: DashboardFilters = {
        suite: 'api-tests',
        status: 'failed',
        timeRange: {
          from: 'now-2h',
          to: 'now-1h'
        }
      };

      const url = grafanaIntegration.buildDashboardUrl('test-run-123', filters);
      
      expect(url).toContain('var-suite=api-tests');
      expect(url).toContain('var-status=failed');
      expect(url).toContain('from=now-2h');
      expect(url).toContain('to=now-1h');
    });

    it('should use default time range when not specified', () => {
      const url = grafanaIntegration.buildDashboardUrl('test-run-123');
      
      expect(url).toContain('from=now-1h');
      expect(url).toContain('to=now');
    });

    it('should fallback to explore when no dashboards configured', () => {
      grafanaConfig.dashboards = [];
      grafanaIntegration = new DefaultGrafanaIntegration(grafanaConfig);

      const url = grafanaIntegration.buildDashboardUrl('test-run-123');
      
      expect(url).toContain('/explore');
      expect(url).toContain('var-run_id=test-run-123');
    });

    it('should handle URL building errors gracefully', () => {
      // Create config with invalid URL to trigger error
      const invalidConfig = {
        ...grafanaConfig,
        url: 'not-a-valid-url'
      };
      grafanaIntegration = new DefaultGrafanaIntegration(invalidConfig);

      const url = grafanaIntegration.buildDashboardUrl('test-run-123');
      
      // Should return fallback URL
      expect(url).toBe('not-a-valid-url/explore');
    });
  });

  describe('validateConnection', () => {
    it('should return true for successful health check', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        status: 200,
        data: { database: 'ok' }
      });

      const result = await grafanaIntegration.validateConnection();
      
      expect(result).toBe(true);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/health');
    });

    it('should return false for non-200 status', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        status: 503,
        data: { database: 'failing' }
      });

      const result = await grafanaIntegration.validateConnection();
      
      expect(result).toBe(false);
    });

    it('should return false for connection errors', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Connection refused'));

      const result = await grafanaIntegration.validateConnection();
      
      expect(result).toBe(false);
    });
  });

  describe('getDashboards', () => {
    it('should fetch dashboards from API', async () => {
      // Add auth config to trigger authentication
      grafanaConfig.auth = {
        type: 'token',
        token: 'test-token'
      };
      grafanaIntegration = new DefaultGrafanaIntegration(grafanaConfig);

      const mockDashboards = [
        {
          uid: 'dash-1',
          title: 'Dashboard 1',
          url: 'dashboard-1',
          tags: ['test']
        },
        {
          uid: 'dash-2',
          title: 'Dashboard 2',
          url: 'dashboard-2',
          tags: []
        }
      ];

      mockAxiosInstance.get
        .mockResolvedValueOnce({ status: 200, data: { id: 1 } }) // authenticate call
        .mockResolvedValueOnce({ 
          status: 200, 
          data: mockDashboards 
        }); // search call

      const result = await grafanaIntegration.getDashboards();
      
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        uid: 'dash-1',
        title: 'Dashboard 1',
        url: 'http://localhost:3000/d/dash-1/dashboard-1',
        tags: ['test']
      });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/search', {
        params: {
          type: 'dash-db',
          limit: 100
        }
      });
    });

    it('should return configured dashboards on API failure', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('API Error'));

      const result = await grafanaIntegration.getDashboards();
      
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        uid: 'test-uid',
        title: 'test-dashboard',
        url: 'http://localhost:3000/d/test-uid/test-dashboard',
        tags: []
      });
    });
  });

  describe('openDashboard', () => {
    it('should open dashboard with run ID', async () => {
      const url = await grafanaIntegration.openDashboard('test-uid', 'run-123');
      
      expect(url).toContain('/d/test-uid/test-dashboard');
      expect(url).toContain('var-run_id=run-123');
      expect(url).toContain('var-environment=test');
    });

    it('should open dashboard without run ID', async () => {
      const url = await grafanaIntegration.openDashboard('test-uid');
      
      expect(url).toContain('/d/test-uid/test-dashboard');
      expect(url).not.toContain('var-run_id');
      expect(url).toContain('var-environment=test');
    });

    it('should throw error for unknown dashboard UID', async () => {
      await expect(
        grafanaIntegration.openDashboard('unknown-uid', 'run-123')
      ).rejects.toThrow('Dashboard with UID unknown-uid not found in configuration');
    });
  });

  describe('request interceptor', () => {
    it('should add Bearer token when authToken is set', () => {
      // Simulate setting auth token
      (grafanaIntegration as any).authToken = 'test-token';

      // Get the interceptor function
      const interceptorCall = mockAxiosInstance.interceptors.request.use.mock.calls[0];
      const interceptorFn = interceptorCall[0];

      const config = { headers: {} };
      const result = interceptorFn(config);

      expect(result.headers.Authorization).toBe('Bearer test-token');
    });

    it('should add auth headers when config auth is present', () => {
      grafanaConfig.auth = {
        type: 'token',
        token: 'config-token'
      };
      grafanaIntegration = new DefaultGrafanaIntegration(grafanaConfig);

      // Get the interceptor function
      const interceptorCall = mockAxiosInstance.interceptors.request.use.mock.calls[0];
      const interceptorFn = interceptorCall[0];

      const config = { headers: {} };
      const result = interceptorFn(config);

      expect(result.headers.Authorization).toBe('Bearer config-token');
    });

    it('should add basic auth headers', () => {
      grafanaConfig.auth = {
        type: 'basic',
        username: 'user',
        password: 'pass'
      };
      grafanaIntegration = new DefaultGrafanaIntegration(grafanaConfig);

      // Get the interceptor function
      const interceptorCall = mockAxiosInstance.interceptors.request.use.mock.calls[0];
      const interceptorFn = interceptorCall[0];

      const config = { headers: {} };
      const result = interceptorFn(config);

      const expectedAuth = Buffer.from('user:pass').toString('base64');
      expect(result.headers.Authorization).toBe(`Basic ${expectedAuth}`);
    });
  });
});