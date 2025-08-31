import { createLogger } from './logger';

describe('Logger Utils', () => {
  describe('createLogger', () => {
    it('should create a logger with the specified component name', () => {
      const logger = createLogger('TEST');

      expect(logger).toHaveProperty('error');
      expect(logger).toHaveProperty('warn');
      expect(logger).toHaveProperty('info');
      expect(logger).toHaveProperty('debug');

      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('should log messages without throwing errors', () => {
      const logger = createLogger('TEST');

      expect(() => {
        logger.info('Test info message');
        logger.warn('Test warning message');
        logger.error('Test error message');
        logger.debug('Test debug message');
      }).not.toThrow();
    });

    it('should handle metadata in log messages', () => {
      const logger = createLogger('TEST');

      expect(() => {
        logger.info('Test message with metadata', { key: 'value', number: 42 });
        logger.error('Error with metadata', new Error('Test error'));
      }).not.toThrow();
    });
  });
});
