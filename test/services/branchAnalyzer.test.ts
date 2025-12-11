import { BranchAnalyzer } from '@/src/services/branchAnalyzer';
import { GitHubService } from '@/src/services/github';
import { MockLogger } from '@/src/utils/logger';
import { loadConfig } from '@/src/utils/config';
import { GitHubContext } from '@/src/types';

// Mock GitHubService
jest.mock('@/src/services/github');

describe('BranchAnalyzer', () => {
  let analyzer: BranchAnalyzer;
  let mockGithub: jest.Mocked<GitHubService>;
  let logger: MockLogger;
  const context: GitHubContext = { owner: 'NOTRIVIAL', repo: 'test-repo' };
  const config = loadConfig();

  beforeEach(() => {
    logger = new MockLogger();
    mockGithub = new GitHubService('token', logger) as jest.Mocked<GitHubService>;
    analyzer = new BranchAnalyzer(mockGithub, logger, config);
  });

  describe('analyzeBranch', () => {
    it('should skip protected branches', async () => {
      const result = await analyzer.analyzeBranch(context, 'main');
      expect(result).toBeNull();
    });

    it('should skip excluded branches', async () => {
      const result = await analyzer.analyzeBranch(context, 'dependabot/npm/lodash');
      expect(result).toBeNull();
    });

    it('should return null when branch has no SHA', async () => {
      mockGithub.getDefaultBranch.mockResolvedValue('main');
      mockGithub.isBranchMerged.mockResolvedValue(true);
      mockGithub.findPullRequestForBranch.mockResolvedValue(42);
      mockGithub.getBranchCommits.mockResolvedValue([
        { sha: 'sha1', author: 'contributor1', date: new Date() },
      ]);
      mockGithub.getBranchSha.mockResolvedValue(null);

      const result = await analyzer.analyzeBranch(context, 'feature-branch');

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      mockGithub.getDefaultBranch.mockRejectedValue(new Error('API error'));

      const result = await analyzer.analyzeBranch(context, 'feature-branch');

      expect(result).toBeNull();
    });

    it('should analyze a regular branch', async () => {
      mockGithub.getDefaultBranch.mockResolvedValue('main');
      mockGithub.isBranchMerged.mockResolvedValue(true);
      mockGithub.findPullRequestForBranch.mockResolvedValue(42);
      mockGithub.getBranchCommits.mockResolvedValue([
        { sha: 'sha1', author: 'contributor1', date: new Date() },
        { sha: 'sha2', author: 'contributor2', date: new Date() },
      ]);
      mockGithub.getBranchSha.mockResolvedValue('abc123');

      const result = await analyzer.analyzeBranch(context, 'feature-branch');

      expect(result).not.toBeNull();
      expect(result!.branch.name).toBe('feature-branch');
      expect(result!.isMerged).toBe(true);
      expect(result!.hasAssociatedPr).toBe(true);
      expect(result!.associatedPrNumber).toBe(42);
      expect(result!.contributors).toContain('contributor1');
      expect(result!.contributors).toContain('contributor2');
    });
  });

  describe('isSafeToDelete', () => {
    it('should return safe when all checks pass', async () => {
      mockGithub.branchExists.mockResolvedValue(true);
      mockGithub.getDefaultBranch.mockResolvedValue('main');
      mockGithub.isBranchMerged.mockResolvedValue(true);
      mockGithub.getBranchSha.mockResolvedValue('expected-sha');

      const result = await analyzer.isSafeToDelete(context, 'feature-branch', 'expected-sha');

      expect(result.safe).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should return unsafe for protected branches', async () => {
      // Protected branches should be rejected before even checking existence
      mockGithub.branchExists.mockResolvedValue(true);

      const result = await analyzer.isSafeToDelete(context, 'main');

      expect(result.safe).toBe(false);
      expect(result.reason).toBe('Branch is protected');
    });

    it('should return unsafe when branch has new commits', async () => {
      mockGithub.branchExists.mockResolvedValue(true);
      mockGithub.getDefaultBranch.mockResolvedValue('main');
      mockGithub.isBranchMerged.mockResolvedValue(true);
      mockGithub.getBranchSha.mockResolvedValue('new-sha');

      const result = await analyzer.isSafeToDelete(context, 'feature-branch', 'old-sha');

      expect(result.safe).toBe(false);
      expect(result.reason).toBe('Branch has new commits since last check');
    });

    it('should return unsafe when branch is not merged', async () => {
      mockGithub.branchExists.mockResolvedValue(true);
      mockGithub.getDefaultBranch.mockResolvedValue('main');
      mockGithub.isBranchMerged.mockResolvedValue(false);

      const result = await analyzer.isSafeToDelete(context, 'feature-branch');

      expect(result.safe).toBe(false);
      expect(result.reason).toBe('Branch is not fully merged');
    });

    it('should return unsafe when branch does not exist', async () => {
      mockGithub.branchExists.mockResolvedValue(false);

      const result = await analyzer.isSafeToDelete(context, 'ghost-branch');

      expect(result.safe).toBe(false);
      expect(result.reason).toBe('Branch no longer exists');
    });

    it('should return safe without expectedSha', async () => {
      mockGithub.branchExists.mockResolvedValue(true);
      mockGithub.getDefaultBranch.mockResolvedValue('main');
      mockGithub.isBranchMerged.mockResolvedValue(true);

      const result = await analyzer.isSafeToDelete(context, 'feature-branch');

      expect(result.safe).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should return unsafe when branch is default branch', async () => {
      mockGithub.branchExists.mockResolvedValue(true);
      mockGithub.getDefaultBranch.mockResolvedValue('custom-default');

      const result = await analyzer.isSafeToDelete(context, 'custom-default');

      expect(result.safe).toBe(false);
      expect(result.reason).toBe('Cannot delete default branch');
    });
  });

  describe('findManuallyMergedBranches', () => {
    it('should return empty array when no branches', async () => {
      mockGithub.listBranches.mockResolvedValue([]);

      const result = await analyzer.findManuallyMergedBranches(context);

      expect(result).toEqual([]);
    });

    it('should find only manually merged branches', async () => {
      mockGithub.listBranches.mockResolvedValue([
        { name: 'branch1', sha: 'sha1', protected: false },
        { name: 'branch2', sha: 'sha2', protected: false },
      ]);

      mockGithub.getDefaultBranch.mockResolvedValue('main');

      // branch1: manually merged (no PR)
      mockGithub.isBranchMerged.mockResolvedValueOnce(true);
      mockGithub.findPullRequestForBranch.mockResolvedValueOnce(null);
      mockGithub.getBranchCommits.mockResolvedValueOnce([
        { sha: 'sha1', author: 'contributor1', date: new Date() },
      ]);
      mockGithub.getBranchSha.mockResolvedValueOnce('sha1');

      // branch2: merged with PR
      mockGithub.isBranchMerged.mockResolvedValueOnce(true);
      mockGithub.findPullRequestForBranch.mockResolvedValueOnce(42);
      mockGithub.getBranchCommits.mockResolvedValueOnce([
        { sha: 'sha2', author: 'contributor2', date: new Date() },
      ]);
      mockGithub.getBranchSha.mockResolvedValueOnce('sha2');

      const result = await analyzer.findManuallyMergedBranches(context);

      expect(result).toHaveLength(1);
      expect(result[0].branch.name).toBe('branch1');
      expect(result[0].isMerged).toBe(true);
      expect(result[0].hasAssociatedPr).toBe(false);
    });
  });

  describe('findPrMergedBranches', () => {
    it('should return empty array when no branches', async () => {
      mockGithub.listBranches.mockResolvedValue([]);

      const result = await analyzer.findPrMergedBranches(context);

      expect(result).toEqual([]);
    });

    it('should find only PR-merged branches', async () => {
      mockGithub.listBranches.mockResolvedValue([
        { name: 'branch1', sha: 'sha1', protected: false },
        { name: 'branch2', sha: 'sha2', protected: false },
      ]);

      mockGithub.getDefaultBranch.mockResolvedValue('main');

      // branch1: merged with PR
      mockGithub.isBranchMerged.mockResolvedValueOnce(true);
      mockGithub.findPullRequestForBranch.mockResolvedValueOnce(42);
      mockGithub.getBranchCommits.mockResolvedValueOnce([
        { sha: 'sha1', author: 'contributor1', date: new Date() },
      ]);
      mockGithub.getBranchSha.mockResolvedValueOnce('sha1');

      // branch2: manually merged (no PR)
      mockGithub.isBranchMerged.mockResolvedValueOnce(true);
      mockGithub.findPullRequestForBranch.mockResolvedValueOnce(null);
      mockGithub.getBranchCommits.mockResolvedValueOnce([
        { sha: 'sha2', author: 'contributor2', date: new Date() },
      ]);
      mockGithub.getBranchSha.mockResolvedValueOnce('sha2');

      const result = await analyzer.findPrMergedBranches(context);

      expect(result).toHaveLength(1);
      expect(result[0].branch.name).toBe('branch1');
      expect(result[0].isMerged).toBe(true);
      expect(result[0].hasAssociatedPr).toBe(true);
      expect(result[0].associatedPrNumber).toBe(42);
    });
  });
});
