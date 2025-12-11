import {
  MergedBranchesHandler,
  handleMergedBranchCleanup,
  scanAndCleanupAllPrMergedBranches,
} from '@/src/handlers/mergedBranches';
import { GitHubService } from '@/src/services/github';
import { MockLogger } from '@/src/utils/logger';
import { loadConfig } from '@/src/utils/config';
import { GitHubContext } from '@/src/types';

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

describe('MergedBranchesHandler', () => {
  let handler: MergedBranchesHandler;
  let mockGithub: jest.Mocked<GitHubService>;
  let logger: MockLogger;
  const context: GitHubContext = { owner: 'NOTRIVIAL', repo: 'test-repo' };
  const config = loadConfig();

  beforeEach(() => {
    logger = new MockLogger();
    mockGithub = new GitHubService('token', logger) as jest.Mocked<GitHubService>;
    handler = new MergedBranchesHandler(mockGithub, logger, config);
  });

  describe('cleanupMergedPrBranch', () => {
    it('should delete branch when safe', async () => {
      mockGithub.branchExists.mockResolvedValue(true);
      mockGithub.getDefaultBranch.mockResolvedValue('main');
      mockGithub.isBranchMerged.mockResolvedValue(true);
      mockGithub.getBranchSha.mockResolvedValue('expected-sha');
      mockGithub.deleteBranch.mockResolvedValue(undefined);

      const result = await handler.cleanupMergedPrBranch(context, 'feature-branch', 'expected-sha');

      expect(result.success).toBe(true);
      expect(result.action).toBe('branch_cleanup');
      expect(result.details.branchName).toBe('feature-branch');
      expect(mockGithub.deleteBranch).toHaveBeenCalledWith(context, 'feature-branch');
    });

    // Note: Safety check validation tests are in branchAnalyzer.test.ts
    // The handler uses BranchAnalyzer.isSafeToDelete which is mocked to return { safe: true }
    // This tests that the handler correctly calls deleteBranch when safety check passes

    it('should handle deleteBranch error', async () => {
      mockGithub.branchExists.mockResolvedValue(true);
      mockGithub.getDefaultBranch.mockResolvedValue('main');
      mockGithub.isBranchMerged.mockResolvedValue(true);
      mockGithub.getBranchSha.mockResolvedValue('expected-sha');
      mockGithub.deleteBranch.mockRejectedValue(new Error('Delete API error'));

      const result = await handler.cleanupMergedPrBranch(context, 'feature-branch', 'expected-sha');

      expect(result.success).toBe(false);
      expect(result.action).toBe('branch_cleanup');
      expect(result.error).toBe('Error: Delete API error');
    });
  });

  describe('dry run mode', () => {
    it('should not delete branch in dry run mode', async () => {
      const dryRunHandler = new MergedBranchesHandler(mockGithub, logger, config, true);

      mockGithub.branchExists.mockResolvedValue(true);
      mockGithub.getDefaultBranch.mockResolvedValue('main');
      mockGithub.isBranchMerged.mockResolvedValue(true);
      mockGithub.getBranchSha.mockResolvedValue('expected-sha');

      const result = await dryRunHandler.cleanupMergedPrBranch(
        context,
        'feature-branch',
        'expected-sha'
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('branch_cleanup_dry_run');
      expect(result.details.dryRun).toBe(true);
      expect(mockGithub.deleteBranch).not.toHaveBeenCalled();
    });
  });

  describe('scanAndCleanupPrMergedBranches', () => {
    it('should cleanup PR-merged branches', async () => {
      // The mock will use default empty array for findPrMergedBranches
      mockGithub.deleteBranch.mockResolvedValue(undefined);

      const results = await handler.scanAndCleanupPrMergedBranches(context);

      // With empty branches list from mock, expect no results
      expect(results).toHaveLength(0);
    });
  });
});

describe('handleMergedBranchCleanup', () => {
  let mockGithub: jest.Mocked<GitHubService>;
  let logger: MockLogger;
  const context: GitHubContext = { owner: 'NOTRIVIAL', repo: 'test-repo' };
  const config = loadConfig();

  beforeEach(() => {
    logger = new MockLogger();
    mockGithub = new GitHubService('token', logger) as jest.Mocked<GitHubService>;
  });

  it('should cleanup merged branch', async () => {
    mockGithub.deleteBranch.mockResolvedValue(undefined);

    const result = await handleMergedBranchCleanup(
      mockGithub,
      logger,
      config,
      context,
      'feature-branch',
      'sha123'
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe('branch_cleanup');
  });

  it('should support dry run mode', async () => {
    const result = await handleMergedBranchCleanup(
      mockGithub,
      logger,
      config,
      context,
      'feature-branch',
      'sha123',
      true // dryRun
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe('branch_cleanup_dry_run');
    expect(mockGithub.deleteBranch).not.toHaveBeenCalled();
  });
});

describe('scanAndCleanupAllPrMergedBranches', () => {
  let mockGithub: jest.Mocked<GitHubService>;
  let logger: MockLogger;
  const config = loadConfig();

  beforeEach(() => {
    logger = new MockLogger();
    mockGithub = new GitHubService('token', logger) as jest.Mocked<GitHubService>;
  });

  it('should process multiple repositories', async () => {
    const contexts: GitHubContext[] = [
      { owner: 'NOTRIVIAL', repo: 'repo1' },
      { owner: 'NOTRIVIAL', repo: 'repo2' },
    ];

    const results = await scanAndCleanupAllPrMergedBranches(mockGithub, logger, config, contexts);

    expect(results).toHaveLength(0);
    expect(logger.hasLogMatching('info', 'PR-merged branch cleanup complete')).toBe(true);
  });
});
