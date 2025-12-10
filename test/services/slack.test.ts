import { SlackService } from '../../src/services/slack';
import { MockLogger } from '../../src/utils/logger';
import { UserMapping } from '../../src/types';

// Mock the Slack WebClient
jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => ({
    conversations: {
      open: jest.fn().mockResolvedValue({ channel: { id: 'C123456' } }),
    },
    chat: {
      postMessage: jest.fn().mockResolvedValue({ ts: '1234567890.123456' }),
      update: jest.fn().mockResolvedValue({ ok: true }),
    },
  })),
}));

describe('SlackService', () => {
  let slack: SlackService;
  let logger: MockLogger;
  const userMapping: UserMapping = {
    'github-user-1': 'U123456',
    'github-user-2': 'U789012',
  };

  beforeEach(() => {
    logger = new MockLogger();
    slack = new SlackService('xoxb-test-token', logger, userMapping);
  });

  describe('getSlackUserId', () => {
    it('should return Slack user ID for known GitHub user', () => {
      expect(slack.getSlackUserId('github-user-1')).toBe('U123456');
      expect(slack.getSlackUserId('github-user-2')).toBe('U789012');
    });

    it('should return null for unknown GitHub user', () => {
      expect(slack.getSlackUserId('unknown-user')).toBeNull();
    });
  });

  describe('sendDirectMessage', () => {
    it('should send a direct message and return timestamp', async () => {
      const result = await slack.sendDirectMessage('U123456', {
        channel: '',
        text: 'Test message',
      });

      expect(result).toBe('1234567890.123456');
      expect(logger.hasLogMatching('info', 'Sending Slack DM')).toBe(true);
    });
  });

  describe('sendBranchDeletionRequest', () => {
    it('should send deletion request to mapped user', async () => {
      const result = await slack.sendBranchDeletionRequest(
        'github-user-1',
        'feature/old-branch',
        'NOTRIVIAL/test-repo',
        'request-123'
      );

      expect(result).toBe('1234567890.123456');
    });

    it('should return null for unmapped user', async () => {
      const result = await slack.sendBranchDeletionRequest(
        'unknown-user',
        'feature/old-branch',
        'NOTRIVIAL/test-repo',
        'request-123'
      );

      expect(result).toBeNull();
      expect(logger.hasLogMatching('warn', 'No Slack user mapping found')).toBe(true);
    });
  });

  describe('sendNotification', () => {
    it('should send a simple notification', async () => {
      const result = await slack.sendNotification('U123456', 'Hello!');
      expect(result).toBe(true);
    });
  });
});
