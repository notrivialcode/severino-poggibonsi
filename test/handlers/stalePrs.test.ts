import { StalePrsHandler } from '../../src/handlers/stalePrs';
import { GitHubService } from '../../src/services/github';
import { MockLogger } from '../../src/utils/logger';
import { loadConfig } from '../../src/utils/config';
import { PullRequest, GitHubContext } from '../../src/types';

// Mock GitHubService
jest.mock('../../src/services/github');

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
      mockGithub.getPullRequestActivity.mockResolvedValue(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000));
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
      mockGithub.getPullRequestActivity.mockResolvedValue(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
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
      mockGithub.getPullRequestActivity.mockResolvedValue(new Date(Date.now() - 20 * 24 * 60 * 60 * 1000));
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
  });
});
