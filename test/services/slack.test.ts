import { SlackService, createSlackService } from '@/src/services/slack';
import { MockLogger } from '@/src/utils/logger';
import { UserMapping } from '@/src/types';
import { WebClient } from '@slack/web-api';

// Create mock functions that can be accessed in tests
const mockOpen = jest.fn().mockResolvedValue({ channel: { id: 'C123456' } });
const mockPostMessage = jest.fn().mockResolvedValue({ ts: '1234567890.123456' });
const mockUpdate = jest.fn().mockResolvedValue({ ok: true });

// Mock the Slack WebClient
jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => ({
    conversations: {
      open: mockOpen,
    },
    chat: {
      postMessage: mockPostMessage,
      update: mockUpdate,
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
    // Reset mocks before each test
    mockOpen.mockClear();
    mockPostMessage.mockClear();
    mockUpdate.mockClear();
    mockOpen.mockResolvedValue({ channel: { id: 'C123456' } });
    mockPostMessage.mockResolvedValue({ ts: '1234567890.123456' });
    mockUpdate.mockResolvedValue({ ok: true });
  });

  describe('getSlackUserId', () => {
    it('should return Slack user ID for known GitHub user', () => {
      expect(slack.getSlackUserId('github-user-1')).toBe('U123456');
      expect(slack.getSlackUserId('github-user-2')).toBe('U789012');
    });

    it('should return null for unknown GitHub user', () => {
      expect(slack.getSlackUserId('unknown-user')).toBeNull();
    });

    it('should perform case-insensitive lookup', () => {
      expect(slack.getSlackUserId('GitHub-User-1')).toBe('U123456');
      expect(slack.getSlackUserId('GITHUB-USER-1')).toBe('U123456');
      expect(slack.getSlackUserId('GiThUb-UsEr-2')).toBe('U789012');
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

    it('should return null when conversation opening fails (no channel id)', async () => {
      mockOpen.mockResolvedValueOnce({ channel: null });

      const result = await slack.sendDirectMessage('U123456', {
        channel: '',
        text: 'Test message',
      });

      expect(result).toBeNull();
      expect(logger.hasLogMatching('error', 'Failed to open conversation')).toBe(true);
      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should return null when conversation opening fails (undefined channel)', async () => {
      mockOpen.mockResolvedValueOnce({ channel: undefined });

      const result = await slack.sendDirectMessage('U123456', {
        channel: '',
        text: 'Test message',
      });

      expect(result).toBeNull();
      expect(logger.hasLogMatching('error', 'Failed to open conversation')).toBe(true);
      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should return null when postMessage throws an error', async () => {
      const error = new Error('API error');
      mockPostMessage.mockRejectedValueOnce(error);

      const result = await slack.sendDirectMessage('U123456', {
        channel: '',
        text: 'Test message',
      });

      expect(result).toBeNull();
      expect(logger.hasLogMatching('error', 'Failed to send Slack DM')).toBe(true);
    });

    it('should return null when conversations.open throws an error', async () => {
      const error = new Error('API error');
      mockOpen.mockRejectedValueOnce(error);

      const result = await slack.sendDirectMessage('U123456', {
        channel: '',
        text: 'Test message',
      });

      expect(result).toBeNull();
      expect(logger.hasLogMatching('error', 'Failed to send Slack DM')).toBe(true);
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

    it('should return false when conversation opening fails (no channel id)', async () => {
      mockOpen.mockResolvedValueOnce({ channel: null });

      const result = await slack.sendNotification('U123456', 'Hello!');

      expect(result).toBe(false);
      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should return false when conversation opening fails (undefined channel)', async () => {
      mockOpen.mockResolvedValueOnce({ channel: undefined });

      const result = await slack.sendNotification('U123456', 'Hello!');

      expect(result).toBe(false);
      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should return false when conversations.open throws an error', async () => {
      const error = new Error('API error');
      mockOpen.mockRejectedValueOnce(error);

      const result = await slack.sendNotification('U123456', 'Hello!');

      expect(result).toBe(false);
      expect(logger.hasLogMatching('error', 'Failed to send notification')).toBe(true);
    });

    it('should return false when postMessage throws an error', async () => {
      const error = new Error('API error');
      mockPostMessage.mockRejectedValueOnce(error);

      const result = await slack.sendNotification('U123456', 'Hello!');

      expect(result).toBe(false);
      expect(logger.hasLogMatching('error', 'Failed to send notification')).toBe(true);
    });
  });

  describe('updateMessage', () => {
    it('should update message successfully and return true', async () => {
      const result = await slack.updateMessage('C123456', '1234567890.123456', 'Updated text');

      expect(result).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({
        channel: 'C123456',
        ts: '1234567890.123456',
        text: 'Updated text',
        blocks: undefined,
      });
    });

    it('should update message with blocks successfully and return true', async () => {
      const blocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Test block',
          },
        },
      ];

      const result = await slack.updateMessage(
        'C123456',
        '1234567890.123456',
        'Updated text',
        blocks
      );

      expect(result).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({
        channel: 'C123456',
        ts: '1234567890.123456',
        text: 'Updated text',
        blocks,
      });
    });

    it('should return false when chat.update throws an error', async () => {
      const error = new Error('API error');
      mockUpdate.mockRejectedValueOnce(error);

      const result = await slack.updateMessage('C123456', '1234567890.123456', 'Updated text');

      expect(result).toBe(false);
      expect(logger.hasLogMatching('error', 'Failed to update message')).toBe(true);
    });
  });

  describe('createSlackService', () => {
    const originalEnv = process.env.SLACK_BOT_TOKEN;

    afterEach(() => {
      // Restore original env var
      if (originalEnv !== undefined) {
        process.env.SLACK_BOT_TOKEN = originalEnv;
      } else {
        delete process.env.SLACK_BOT_TOKEN;
      }
    });

    it('should create SlackService with env var token', () => {
      process.env.SLACK_BOT_TOKEN = 'xoxb-env-token';
      const testLogger = new MockLogger();
      const testMapping: UserMapping = { 'test-user': 'U999999' };

      const service = createSlackService(testLogger, testMapping);

      expect(service).toBeInstanceOf(SlackService);
      expect(WebClient).toHaveBeenCalledWith('xoxb-env-token');
    });

    it('should create SlackService with empty token if env var is not set', () => {
      delete process.env.SLACK_BOT_TOKEN;
      const testLogger = new MockLogger();

      const service = createSlackService(testLogger);

      expect(service).toBeInstanceOf(SlackService);
      expect(WebClient).toHaveBeenCalledWith('');
    });

    it('should create SlackService with empty user mapping if not provided', () => {
      process.env.SLACK_BOT_TOKEN = 'xoxb-env-token';
      const testLogger = new MockLogger();

      const service = createSlackService(testLogger);

      expect(service).toBeInstanceOf(SlackService);
      // Service should still be created successfully without user mapping
      expect(service.getSlackUserId('any-user')).toBeNull();
    });
  });
});
