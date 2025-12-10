import { BranchAnalyzer } from '../../src/services/branchAnalyzer';
import { GitHubService } from '../../src/services/github';
import { MockLogger } from '../../src/utils/logger';
import { loadConfig } from '../../src/utils/config';
import { GitHubContext } from '../../src/types';

// Mock GitHubService
jest.mock('../../src/services/github');

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
  });
});
