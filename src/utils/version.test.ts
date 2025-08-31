import { getVersion, getBuildInfo } from './version';

describe('Version Utils', () => {
  describe('getVersion', () => {
    it('should return a valid version string', () => {
      const version = getVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should return fallback version if package.json is not accessible', () => {
      // Mock fs.readFileSync to throw an error
      const originalReadFileSync = require('fs').readFileSync;
      require('fs').readFileSync = jest.fn(() => {
        throw new Error('File not found');
      });

      const version = getVersion();
      expect(version).toBe('1.0.0');

      // Restore original function
      require('fs').readFileSync = originalReadFileSync;
    });
  });

  describe('getBuildInfo', () => {
    it('should return build information object', () => {
      const buildInfo = getBuildInfo();

      expect(buildInfo).toHaveProperty('version');
      expect(buildInfo).toHaveProperty('buildDate');
      expect(buildInfo).toHaveProperty('nodeVersion');

      expect(buildInfo.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(buildInfo.buildDate).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
      );
      expect(buildInfo.nodeVersion).toMatch(/^v\d+\.\d+\.\d+/);
    });
  });
});
