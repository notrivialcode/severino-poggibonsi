import { ManualMergesHandler, handleManualMerges } from '@/src/handlers/manualMerges';
import { GitHubService } from '@/src/services/github';
import { SlackService } from '@/src/services/slack';
import { MockLogger } from '@/src/utils/logger';
import { loadConfig } from '@/src/utils/config';
import { GitHubContext } from '@/src/types';
import * as redis from '@/src/services/redis';

// Mock uuid
jest.mock('uuid', () => ({
  v4: () => 'test-uuid-123',
}));

// Mock GitHubService
jest.mock('@/src/services/github');

// Mock BranchAnalyzer
jest.mock('@/src/services/branchAnalyzer', () => ({
  BranchAnalyzer: jest.fn().mockImplementation(() => ({
    isSafeToDelete: jest.fn().mockResolvedValue({ safe: true }),
    findManuallyMergedBranches: jest.fn().mockResolvedValue([]),
    findPrMergedBranches: jest.fn().mockResolvedValue([]),
    analyzeBranch: jest.fn().mockResolvedValue(null),
  })),
}));

// Mock redis functions
jest.mock('@/src/services/redis', () => ({
  wasDmSent: jest.fn().mockResolvedValue(false),
  markDmSent: jest.fn().mockResolvedValue(undefined),
}));

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
      const result = await handler.requestDeletionPermission(context, 'feature/manually-merged', [
        'contributor1',
        'contributor2',
      ]);

      expect(result.success).toBe(true);
      expect(result.action).toBe('deletion_request_sent');
      expect(result.details.messagesSent).toBe(2);
      expect(result.details.requestId).toBe('test-uuid-123');
    });

    it('should fail when no contributors have Slack mapping', async () => {
      const result = await handler.requestDeletionPermission(context, 'feature/manually-merged', [
        'unknown-user1',
        'unknown-user2',
      ]);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Missing Slack mappings for: unknown-user1, unknown-user2');
    });
  });

  describe('handleDeletionResponse', () => {
    it('should delete branch when approved', async () => {
      // First, create a pending deletion
      await handler.requestDeletionPermission(context, 'feature/manually-merged', ['contributor1']);

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

      await newHandler.requestDeletionPermission(context, 'feature/other-branch', ['contributor1']);

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

  describe('getPendingDeletion', () => {
    it('should return pending deletion by request ID', async () => {
      await handler.requestDeletionPermission(context, 'branch1', ['contributor1']);

      const pending = handler.getPendingDeletion('test-uuid-123');
      expect(pending).toBeDefined();
      expect(pending!.branchName).toBe('branch1');
    });

    it('should return undefined for unknown request ID', () => {
      const pending = handler.getPendingDeletion('unknown-id');
      expect(pending).toBeUndefined();
    });
  });

  describe('handleDeletionResponse edge cases', () => {
    it('should fail when request is already processed', async () => {
      mockGithub.deleteBranch.mockResolvedValue(undefined);

      await handler.requestDeletionPermission(context, 'branch1', ['contributor1']);

      // First approval (uses mocked isSafeToDelete returning { safe: true })
      await handler.handleDeletionResponse('test-uuid-123', true);

      // Try to process again
      const result = await handler.handleDeletionResponse('test-uuid-123', true);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request already processed');
    });

    it('should handle deleteBranch error after approval', async () => {
      mockGithub.deleteBranch.mockRejectedValue(new Error('Delete API error'));

      await handler.requestDeletionPermission(context, 'branch1', ['contributor1']);

      const result = await handler.handleDeletionResponse('test-uuid-123', true);

      expect(result.success).toBe(false);
      expect(result.action).toBe('branch_deletion');
      expect(result.error).toBe('Error: Delete API error');
    });
  });

  describe('requestDeletionPermission edge cases', () => {
    it('should filter out bot contributors', async () => {
      const result = await handler.requestDeletionPermission(context, 'feature/bot-branch', [
        'contributor1',
        'dependabot[bot]',
        'github-actions[bot]',
      ]);

      expect(result.success).toBe(true);
      expect(result.details.contributors).toEqual(['contributor1']);
    });

    it('should skip duplicate DMs for same branch/contributor', async () => {
      (redis.wasDmSent as jest.Mock).mockResolvedValueOnce(true);

      const result = await handler.requestDeletionPermission(context, 'feature/duplicate', [
        'contributor1',
      ]);

      expect(result.success).toBe(true);
      expect(result.details.skippedDuplicates).toBe(1);
      expect(result.details.messagesSent).toBe(0);
    });
  });

  describe('processRepository', () => {
    it('should process manually merged branches', async () => {
      // The mock returns empty array by default for findManuallyMergedBranches
      const results = await handler.processRepository(context);

      // With empty branches list from mock, expect no results
      expect(results).toHaveLength(0);
    });
  });
});

describe('handleManualMerges', () => {
  let mockGithub: jest.Mocked<GitHubService>;
  let slack: SlackService;
  let logger: MockLogger;
  const config = loadConfig();
  const userMapping = {
    contributor1: 'U123456',
  };

  beforeEach(() => {
    logger = new MockLogger();
    mockGithub = new GitHubService('token', logger) as jest.Mocked<GitHubService>;
    slack = new SlackService('xoxb-test-token', logger, userMapping);
  });

  it('should process multiple repositories', async () => {
    const contexts: GitHubContext[] = [
      { owner: 'NOTRIVIAL', repo: 'repo1' },
      { owner: 'NOTRIVIAL', repo: 'repo2' },
    ];

    const results = await handleManualMerges(mockGithub, slack, logger, config, contexts);

    expect(results).toHaveLength(0);
    expect(logger.hasLogMatching('info', 'Manual merge processing complete')).toBe(true);
  });
});
