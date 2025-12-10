import { ManualMergesHandler } from '../../src/handlers/manualMerges';
import { GitHubService } from '../../src/services/github';
import { SlackService } from '../../src/services/slack';
import { MockLogger } from '../../src/utils/logger';
import { loadConfig } from '../../src/utils/config';
import { GitHubContext } from '../../src/types';

// Mock uuid
jest.mock('uuid', () => ({
  v4: () => 'test-uuid-123',
}));

// Mock GitHubService
jest.mock('../../src/services/github');

// Mock Slack WebClient
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

describe('ManualMergesHandler', () => {
  let handler: ManualMergesHandler;
  let mockGithub: jest.Mocked<GitHubService>;
  let slack: SlackService;
  let logger: MockLogger;
  const context: GitHubContext = { owner: 'NOTRIVIAL', repo: 'test-repo' };
  const config = loadConfig();
  const userMapping = {
    contributor1: 'U123456',
    contributor2: 'U789012',
  };

  beforeEach(() => {
    logger = new MockLogger();
    mockGithub = new GitHubService('token', logger) as jest.Mocked<GitHubService>;
    slack = new SlackService('xoxb-test-token', logger, userMapping);
    handler = new ManualMergesHandler(mockGithub, slack, logger, config);
  });

  describe('requestDeletionPermission', () => {
    it('should send Slack messages to contributors', async () => {
      const result = await handler.requestDeletionPermission(
        context,
        'feature/manually-merged',
        ['contributor1', 'contributor2']
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('deletion_request_sent');
      expect(result.details.messagesSent).toBe(2);
      expect(result.details.requestId).toBe('test-uuid-123');
    });

    it('should fail when no contributors have Slack mapping', async () => {
      const result = await handler.requestDeletionPermission(
        context,
        'feature/manually-merged',
        ['unknown-user1', 'unknown-user2']
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('No Slack messages could be sent - check user mappings');
    });
  });

  describe('handleDeletionResponse', () => {
    it('should delete branch when approved', async () => {
      // First, create a pending deletion
      await handler.requestDeletionPermission(
        context,
        'feature/manually-merged',
        ['contributor1']
      );

      // Setup mocks for safety check
      mockGithub.branchExists.mockResolvedValue(true);
      mockGithub.getDefaultBranch.mockResolvedValue('main');
      mockGithub.isBranchMerged.mockResolvedValue(true);
      mockGithub.deleteBranch.mockResolvedValue(undefined);

      const result = await handler.handleDeletionResponse('test-uuid-123', true);

      expect(result.success).toBe(true);
      expect(result.action).toBe('branch_deletion');
      expect(mockGithub.deleteBranch).toHaveBeenCalled();
    });

    it('should reject deletion when user declines', async () => {
      // Create a new handler to get fresh state
      const newHandler = new ManualMergesHandler(mockGithub, slack, logger, config);

      await newHandler.requestDeletionPermission(
        context,
        'feature/other-branch',
        ['contributor1']
      );

      const result = await newHandler.handleDeletionResponse('test-uuid-123', false);

      expect(result.success).toBe(true);
      expect(result.action).toBe('deletion_rejected');
      expect(mockGithub.deleteBranch).not.toHaveBeenCalled();
    });

    it('should fail for unknown request ID', async () => {
      const result = await handler.handleDeletionResponse('unknown-id', true);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request not found or expired');
    });
  });

  describe('getPendingDeletions', () => {
    it('should return only pending deletions', async () => {
      // Create a pending deletion
      await handler.requestDeletionPermission(context, 'branch1', ['contributor1']);

      const pending = handler.getPendingDeletions();
      expect(pending).toHaveLength(1);
      expect(pending[0].branchName).toBe('branch1');
      expect(pending[0].status).toBe('pending');
    });
  });
});
