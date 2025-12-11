import { StalePrsHandler, handleStalePrs } from '@/src/handlers/stalePrs';
import { GitHubService } from '@/src/services/github';
import { MockLogger } from '@/src/utils/logger';
import { loadConfig } from '@/src/utils/config';
import { PullRequest, GitHubContext } from '@/src/types';

// Mock GitHubService
jest.mock('@/src/services/github');

describe('StalePrsHandler', () => {
  let handler: StalePrsHandler;
  let mockGithub: jest.Mocked<GitHubService>;
  let logger: MockLogger;
  const context: GitHubContext = { owner: 'NOTRIVIAL', repo: 'test-repo' };
  const config = loadConfig();

  beforeEach(() => {
    logger = new MockLogger();
    mockGithub = new GitHubService('token', logger) as jest.Mocked<GitHubService>;
    handler = new StalePrsHandler(mockGithub, logger, config);
  });

  describe('processRepository', () => {
    it('should process open PRs and warn stale ones', async () => {
      const stalePr: PullRequest = {
        number: 1,
        title: 'Stale Feature',
        author: 'contributor1',
        createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        lastActivityAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        labels: [],
        headRef: 'feature/stale',
        headSha: 'abc123',
        baseBranch: 'main',
        url: 'https://github.com/NOTRIVIAL/test-repo/pull/1',
      };

      mockGithub.listOpenPullRequests.mockResolvedValue([stalePr]);
      mockGithub.getPullRequestActivity.mockResolvedValue(
        new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      );
      mockGithub.listComments.mockResolvedValue([]);
      mockGithub.createComment.mockResolvedValue(undefined);

      const results = await handler.processRepository(context);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].action).toBe('stale_warning');
      expect(results[0].details.prNumber).toBe(1);
      expect(mockGithub.createComment).toHaveBeenCalled();
    });

    it('should skip PRs with excluded labels', async () => {
      const pinnedPr: PullRequest = {
        number: 2,
        title: 'Pinned Feature',
        author: 'contributor2',
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        lastActivityAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        labels: ['pinned'],
        headRef: 'feature/pinned',
        headSha: 'def456',
        baseBranch: 'main',
        url: 'https://github.com/NOTRIVIAL/test-repo/pull/2',
      };

      mockGithub.listOpenPullRequests.mockResolvedValue([pinnedPr]);

      const results = await handler.processRepository(context);

      expect(results).toHaveLength(0);
      expect(mockGithub.createComment).not.toHaveBeenCalled();
    });

    it('should not warn active PRs', async () => {
      const activePr: PullRequest = {
        number: 4,
        title: 'Active Feature',
        author: 'contributor4',
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        lastActivityAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        labels: [],
        headRef: 'feature/active',
        headSha: 'jkl012',
        baseBranch: 'main',
        url: 'https://github.com/NOTRIVIAL/test-repo/pull/4',
      };

      mockGithub.listOpenPullRequests.mockResolvedValue([activePr]);
      mockGithub.getPullRequestActivity.mockResolvedValue(
        new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      );
      mockGithub.listComments.mockResolvedValue([]);

      const results = await handler.processRepository(context);

      expect(results).toHaveLength(0);
      expect(mockGithub.createComment).not.toHaveBeenCalled();
    });

    it('should close PRs that are stale and already warned', async () => {
      const veryOldPr: PullRequest = {
        number: 3,
        title: 'Very Old Feature',
        author: 'contributor3',
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        lastActivityAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        labels: [],
        headRef: 'feature/old',
        headSha: 'ghi789',
        baseBranch: 'main',
        url: 'https://github.com/NOTRIVIAL/test-repo/pull/3',
      };

      mockGithub.listOpenPullRequests.mockResolvedValue([veryOldPr]);
      mockGithub.getPullRequestActivity.mockResolvedValue(
        new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
      );
      mockGithub.listComments.mockResolvedValue([
        { id: 100, body: '<!-- severino-stale-warning -->\nCiao!', user: 'bot' },
      ]);
      mockGithub.createComment.mockResolvedValue(undefined);
      mockGithub.closePullRequest.mockResolvedValue(undefined);

      const results = await handler.processRepository(context);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].action).toBe('stale_close');
      expect(mockGithub.closePullRequest).toHaveBeenCalledWith(context, 3);
    });

    it('should handle errors in processRepository gracefully', async () => {
      mockGithub.listOpenPullRequests.mockRejectedValue(new Error('API error'));

      const results = await handler.processRepository(context);

      expect(results).toHaveLength(0);
      expect(logger.hasLogMatching('error', 'Error processing repository')).toBe(true);
    });

    it('should not warn PR that already has warning comment', async () => {
      const stalePr: PullRequest = {
        number: 5,
        title: 'Already Warned',
        author: 'contributor5',
        createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        lastActivityAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        labels: [],
        headRef: 'feature/warned',
        headSha: 'mno345',
        baseBranch: 'main',
        url: 'https://github.com/NOTRIVIAL/test-repo/pull/5',
      };

      mockGithub.listOpenPullRequests.mockResolvedValue([stalePr]);
      mockGithub.getPullRequestActivity.mockResolvedValue(
        new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      );
      // Has warning but not past close threshold
      mockGithub.listComments.mockResolvedValue([
        { id: 100, body: '<!-- severino-stale-warning -->\nCiao!', user: 'bot' },
      ]);

      const results = await handler.processRepository(context);

      expect(results).toHaveLength(0);
      expect(mockGithub.createComment).not.toHaveBeenCalled();
    });

    it('should not close PR that already has closing comment', async () => {
      const stalePr: PullRequest = {
        number: 6,
        title: 'Already Closed',
        author: 'contributor6',
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        lastActivityAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        labels: [],
        headRef: 'feature/closed',
        headSha: 'pqr678',
        baseBranch: 'main',
        url: 'https://github.com/NOTRIVIAL/test-repo/pull/6',
      };

      mockGithub.listOpenPullRequests.mockResolvedValue([stalePr]);
      mockGithub.getPullRequestActivity.mockResolvedValue(
        new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
      );
      mockGithub.listComments.mockResolvedValue([
        { id: 100, body: '<!-- severino-stale-warning -->\nCiao!', user: 'bot' },
        { id: 101, body: '<!-- severino-stale-close -->\nArrivederci!', user: 'bot' },
      ]);

      const results = await handler.processRepository(context);

      expect(results).toHaveLength(0);
      expect(mockGithub.closePullRequest).not.toHaveBeenCalled();
    });
  });

  describe('closeStalePr error handling', () => {
    it('should return failure when createComment throws error', async () => {
      const veryOldPr: PullRequest = {
        number: 7,
        title: 'Error PR',
        author: 'contributor7',
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        lastActivityAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        labels: [],
        headRef: 'feature/error',
        headSha: 'stu901',
        baseBranch: 'main',
        url: 'https://github.com/NOTRIVIAL/test-repo/pull/7',
      };

      mockGithub.listOpenPullRequests.mockResolvedValue([veryOldPr]);
      mockGithub.getPullRequestActivity.mockResolvedValue(
        new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
      );
      mockGithub.listComments.mockResolvedValue([
        { id: 100, body: '<!-- severino-stale-warning -->\nCiao!', user: 'bot' },
      ]);
      mockGithub.createComment.mockRejectedValue(new Error('Comment API error'));

      const results = await handler.processRepository(context);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].action).toBe('stale_close');
      expect(results[0].error).toBe('Error: Comment API error');
    });

    it('should return failure when closePullRequest throws error', async () => {
      const veryOldPr: PullRequest = {
        number: 8,
        title: 'Close Error PR',
        author: 'contributor8',
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        lastActivityAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        labels: [],
        headRef: 'feature/close-error',
        headSha: 'vwx234',
        baseBranch: 'main',
        url: 'https://github.com/NOTRIVIAL/test-repo/pull/8',
      };

      mockGithub.listOpenPullRequests.mockResolvedValue([veryOldPr]);
      mockGithub.getPullRequestActivity.mockResolvedValue(
        new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
      );
      mockGithub.listComments.mockResolvedValue([
        { id: 100, body: '<!-- severino-stale-warning -->\nCiao!', user: 'bot' },
      ]);
      mockGithub.createComment.mockResolvedValue(undefined);
      mockGithub.closePullRequest.mockRejectedValue(new Error('Close API error'));

      const results = await handler.processRepository(context);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].action).toBe('stale_close');
      expect(results[0].error).toBe('Error: Close API error');
    });
  });

  describe('warnStalePr error handling', () => {
    it('should return failure when createComment throws error for warning', async () => {
      const stalePr: PullRequest = {
        number: 9,
        title: 'Warning Error PR',
        author: 'contributor9',
        createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        lastActivityAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        labels: [],
        headRef: 'feature/warn-error',
        headSha: 'yza567',
        baseBranch: 'main',
        url: 'https://github.com/NOTRIVIAL/test-repo/pull/9',
      };

      mockGithub.listOpenPullRequests.mockResolvedValue([stalePr]);
      mockGithub.getPullRequestActivity.mockResolvedValue(
        new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      );
      mockGithub.listComments.mockResolvedValue([]);
      mockGithub.createComment.mockRejectedValue(new Error('Warning API error'));

      const results = await handler.processRepository(context);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].action).toBe('stale_warning');
      expect(results[0].error).toBe('Error: Warning API error');
    });
  });
});

describe('handleStalePrs', () => {
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

    mockGithub.listOpenPullRequests.mockResolvedValue([]);

    const results = await handleStalePrs(mockGithub, logger, config, contexts);

    expect(results).toHaveLength(0);
    expect(mockGithub.listOpenPullRequests).toHaveBeenCalledTimes(2);
    expect(logger.hasLogMatching('info', 'Stale PR processing complete')).toBe(true);
  });
});
