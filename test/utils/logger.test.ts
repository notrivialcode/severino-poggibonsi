import { MockLogger } from '@/src/utils/logger';

describe('MockLogger', () => {
  let logger: MockLogger;

  beforeEach(() => {
    logger = new MockLogger();
  });

  describe('logging methods', () => {
    it('should log debug messages', () => {
      logger.debug('Debug message', { key: 'value' });

      const logs = logger.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('debug');
      expect(logs[0].message).toBe('Debug message');
      expect(logs[0].meta).toEqual({ key: 'value' });
    });

    it('should log info messages', () => {
      logger.info('Info message');

      const logs = logger.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('info');
      expect(logs[0].message).toBe('Info message');
    });

    it('should log warn messages', () => {
      logger.warn('Warning message', { important: true });

      const logs = logger.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('warn');
      expect(logs[0].message).toBe('Warning message');
    });

    it('should log error messages', () => {
      logger.error('Error message', { error: 'something went wrong' });

      const logs = logger.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('error');
      expect(logs[0].message).toBe('Error message');
    });

    it('should include timestamp in logs', () => {
      const before = new Date();
      logger.info('Test message');
      const after = new Date();

      const logs = logger.getLogs();
      expect(logs[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(logs[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('getLogsByLevel', () => {
    it('should filter logs by level', () => {
      logger.debug('Debug 1');
      logger.info('Info 1');
      logger.debug('Debug 2');
      logger.error('Error 1');

      expect(logger.getLogsByLevel('debug')).toHaveLength(2);
      expect(logger.getLogsByLevel('info')).toHaveLength(1);
      expect(logger.getLogsByLevel('error')).toHaveLength(1);
      expect(logger.getLogsByLevel('warn')).toHaveLength(0);
    });
  });

  describe('clearLogs', () => {
    it('should clear all logs', () => {
      logger.info('Message 1');
      logger.info('Message 2');
      expect(logger.getLogs()).toHaveLength(2);

      logger.clearLogs();
      expect(logger.getLogs()).toHaveLength(0);
    });
  });

  describe('hasLogMatching', () => {
    it('should find log with matching string', () => {
      logger.info('User logged in successfully');
      logger.error('Connection failed');

      expect(logger.hasLogMatching('info', 'logged in')).toBe(true);
      expect(logger.hasLogMatching('error', 'Connection')).toBe(true);
      expect(logger.hasLogMatching('info', 'not found')).toBe(false);
    });

    it('should find log with matching regex', () => {
      logger.info('User 123 logged in');
      logger.warn('Rate limit: 50/100');

      expect(logger.hasLogMatching('info', /User \d+ logged/)).toBe(true);
      expect(logger.hasLogMatching('warn', /Rate limit: \d+\/\d+/)).toBe(true);
      expect(logger.hasLogMatching('info', /User \d+ logged out/)).toBe(false);
    });
  });
});
