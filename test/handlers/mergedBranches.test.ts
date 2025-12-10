import { MergedBranchesHandler } from '../../src/handlers/mergedBranches';
import { GitHubService } from '../../src/services/github';
import { MockLogger } from '../../src/utils/logger';
import { loadConfig } from '../../src/utils/config';
import { GitHubContext } from '../../src/types';

// Mock GitHubService
jest.mock('../../src/services/github');

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

    it('should not delete branch when SHA has changed', async () => {
      mockGithub.branchExists.mockResolvedValue(true);
      mockGithub.getDefaultBranch.mockResolvedValue('main');
      mockGithub.isBranchMerged.mockResolvedValue(true);
      mockGithub.getBranchSha.mockResolvedValue('new-sha');

      const result = await handler.cleanupMergedPrBranch(context, 'feature-branch', 'old-sha');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Branch has new commits since last check');
      expect(mockGithub.deleteBranch).not.toHaveBeenCalled();
    });

    it('should not delete protected branches', async () => {
      const result = await handler.cleanupMergedPrBranch(context, 'main', 'any-sha');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Branch is protected');
      expect(mockGithub.deleteBranch).not.toHaveBeenCalled();
    });

    it('should not delete unmerged branches', async () => {
      mockGithub.branchExists.mockResolvedValue(true);
      mockGithub.getDefaultBranch.mockResolvedValue('main');
      mockGithub.isBranchMerged.mockResolvedValue(false);

      const result = await handler.cleanupMergedPrBranch(context, 'feature-branch', 'sha123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Branch is not fully merged');
      expect(mockGithub.deleteBranch).not.toHaveBeenCalled();
    });

    it('should not delete branch that no longer exists', async () => {
      mockGithub.branchExists.mockResolvedValue(false);

      const result = await handler.cleanupMergedPrBranch(context, 'ghost-branch', 'sha123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Branch no longer exists');
      expect(mockGithub.deleteBranch).not.toHaveBeenCalled();
    });
  });
});
