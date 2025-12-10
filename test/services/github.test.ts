import { GitHubService } from '../../src/services/github';
import { MockLogger } from '../../src/utils/logger';

// Create mock functions for Octokit
const mockPullsList = jest.fn();
const mockPullsListReviews = jest.fn();
const mockPullsListCommits = jest.fn();
const mockPullsUpdate = jest.fn();
const mockIssuesListComments = jest.fn();
const mockIssuesCreateComment = jest.fn();
const mockReposListBranches = jest.fn();
const mockReposGet = jest.fn();
const mockReposGetBranch = jest.fn();
const mockReposCompareCommits = jest.fn();
const mockReposListCommits = jest.fn();
const mockReposListForOrg = jest.fn();
const mockGitDeleteRef = jest.fn();

// Mock the Octokit rest client
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    pulls: {
      list: mockPullsList,
      listReviews: mockPullsListReviews,
      listCommits: mockPullsListCommits,
      update: mockPullsUpdate,
    },
    issues: {
      listComments: mockIssuesListComments,
      createComment: mockIssuesCreateComment,
    },
    repos: {
      listBranches: mockReposListBranches,
      get: mockReposGet,
      getBranch: mockReposGetBranch,
      compareCommits: mockReposCompareCommits,
      listCommits: mockReposListCommits,
      listForOrg: mockReposListForOrg,
    },
    git: {
      deleteRef: mockGitDeleteRef,
    },
  })),
}));

describe('GitHubService', () => {
  let github: GitHubService;
  let logger: MockLogger;
  const context = { owner: 'NOTRIVIAL', repo: 'test-repo' };

  beforeEach(() => {
    jest.clearAllMocks();
    logger = new MockLogger();
    github = new GitHubService('test-token', logger);
  });

  describe('listOpenPullRequests', () => {
    it('should fetch and transform open PRs', async () => {
      const mockPrs = [
        {
          number: 1,
          title: 'Feature: Add login',
          user: { login: 'contributor1' },
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          labels: [],
          head: { ref: 'feature/login', sha: 'abc123' },
          base: { ref: 'main' },
          html_url: 'https://github.com/NOTRIVIAL/test-repo/pull/1',
        },
      ];

      mockPullsList.mockResolvedValue({ data: mockPrs });

      const prs = await github.listOpenPullRequests(context);

      expect(prs).toHaveLength(1);
      expect(prs[0].number).toBe(1);
      expect(prs[0].title).toBe('Feature: Add login');
      expect(prs[0].author).toBe('contributor1');
      expect(prs[0].headRef).toBe('feature/login');
    });
  });

  describe('createComment', () => {
    it('should create a comment on an issue/PR', async () => {
      mockIssuesCreateComment.mockResolvedValue({ data: { id: 123 } });

      await github.createComment(context, 1, 'Test comment');

      expect(mockIssuesCreateComment).toHaveBeenCalledWith({
        owner: 'NOTRIVIAL',
        repo: 'test-repo',
        issue_number: 1,
        body: 'Test comment',
      });
      expect(logger.hasLogMatching('info', 'Creating comment')).toBe(true);
    });
  });

  describe('closePullRequest', () => {
    it('should close a pull request', async () => {
      mockPullsUpdate.mockResolvedValue({ data: { number: 1, state: 'closed' } });

      await github.closePullRequest(context, 1);

      expect(mockPullsUpdate).toHaveBeenCalledWith({
        owner: 'NOTRIVIAL',
        repo: 'test-repo',
        pull_number: 1,
        state: 'closed',
      });
      expect(logger.hasLogMatching('info', 'Closing pull request')).toBe(true);
    });
  });

  describe('listBranches', () => {
    it('should fetch and transform branches', async () => {
      const mockBranches = [
        { name: 'main', commit: { sha: 'main123' }, protected: true },
        { name: 'feature/test', commit: { sha: 'feat123' }, protected: false },
      ];

      mockReposListBranches.mockResolvedValue({ data: mockBranches });

      const result = await github.listBranches(context);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('main');
      expect(result[0].protected).toBe(true);
    });
  });

  describe('getDefaultBranch', () => {
    it('should return the default branch', async () => {
      mockReposGet.mockResolvedValue({ data: { default_branch: 'main' } });

      const defaultBranch = await github.getDefaultBranch(context);
      expect(defaultBranch).toBe('main');
    });
  });

  describe('isBranchMerged', () => {
    it('should return true when branch is fully merged', async () => {
      mockReposCompareCommits.mockResolvedValue({
        data: { ahead_by: 0, behind_by: 5 },
      });

      const isMerged = await github.isBranchMerged(context, 'feature-branch', 'main');
      expect(isMerged).toBe(true);
    });

    it('should return false when branch has unmerged commits', async () => {
      mockReposCompareCommits.mockResolvedValue({
        data: { ahead_by: 3, behind_by: 2 },
      });

      const isMerged = await github.isBranchMerged(context, 'feature-branch', 'main');
      expect(isMerged).toBe(false);
    });
  });

  describe('deleteBranch', () => {
    it('should delete a branch', async () => {
      mockGitDeleteRef.mockResolvedValue({});

      await github.deleteBranch(context, 'feature-branch');

      expect(mockGitDeleteRef).toHaveBeenCalledWith({
        owner: 'NOTRIVIAL',
        repo: 'test-repo',
        ref: 'heads/feature-branch',
      });
      expect(logger.hasLogMatching('info', 'Deleting branch')).toBe(true);
    });
  });

  describe('branchExists', () => {
    it('should return true when branch exists', async () => {
      mockReposGetBranch.mockResolvedValue({
        data: { name: 'feature-branch' },
      });

      const exists = await github.branchExists(context, 'feature-branch');
      expect(exists).toBe(true);
    });

    it('should return false when branch does not exist', async () => {
      mockReposGetBranch.mockRejectedValue(new Error('Not found'));

      const exists = await github.branchExists(context, 'nonexistent');
      expect(exists).toBe(false);
    });
  });

  describe('findPullRequestForBranch', () => {
    it('should find PR associated with branch', async () => {
      mockPullsList.mockResolvedValue({
        data: [{ number: 42 }],
      });

      const prNumber = await github.findPullRequestForBranch(context, 'feature-branch');
      expect(prNumber).toBe(42);
    });

    it('should return null when no PR found', async () => {
      mockPullsList.mockResolvedValue({ data: [] });

      const prNumber = await github.findPullRequestForBranch(context, 'orphan-branch');
      expect(prNumber).toBeNull();
    });
  });

  describe('getBranchSha', () => {
    it('should return SHA when branch exists', async () => {
      mockReposGetBranch.mockResolvedValue({
        data: { commit: { sha: 'abc123' } },
      });

      const sha = await github.getBranchSha(context, 'feature-branch');
      expect(sha).toBe('abc123');
    });

    it('should return null when branch does not exist', async () => {
      mockReposGetBranch.mockRejectedValue(new Error('Not found'));

      const sha = await github.getBranchSha(context, 'nonexistent');
      expect(sha).toBeNull();
    });
  });

  describe('listComments', () => {
    it('should list comments on an issue', async () => {
      mockIssuesListComments.mockResolvedValue({
        data: [
          { id: 1, body: 'First comment', user: { login: 'user1' } },
          { id: 2, body: 'Second comment', user: { login: 'user2' } },
        ],
      });

      const comments = await github.listComments(context, 1);
      expect(comments).toHaveLength(2);
      expect(comments[0].body).toBe('First comment');
    });
  });
});
