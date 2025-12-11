import probotApp from '@/src/index';
import { handleMergedBranchCleanup } from '@/src/handlers/mergedBranches';

// Mock the merged branches handler
jest.mock('@/src/handlers/mergedBranches');

// Mock the config module
jest.mock('@/src/utils/config', () => ({
  loadConfig: jest.fn().mockReturnValue({
    bot: { name: 'Severino Poggibonsi', organization: 'NOTRIVIAL' },
    stalePrs: { warningDays: 7, closeDays: 14, excludeLabels: [] },
    branches: { protectedPatterns: ['main', 'master'], excludePatterns: [] },
    slack: { webhookUrl: '', botToken: '' },
    userMapping: {},
  }),
}));

describe('probotApp', () => {
  it('should be a function', () => {
    expect(typeof probotApp).toBe('function');
  });

  it('should register event handler when loaded', () => {
    const mockApp = {
      log: { info: jest.fn() },
      on: jest.fn(),
    };

    probotApp(mockApp as any);

    // Should log startup message
    expect(mockApp.log.info).toHaveBeenCalledWith('Severino Poggibonsi is starting up...');

    // Should register pull_request.closed handler
    expect(mockApp.on).toHaveBeenCalledWith('pull_request.closed', expect.any(Function));

    // Should log ready message
    expect(mockApp.log.info).toHaveBeenCalledWith('Severino Poggibonsi is ready!');
  });

  describe('pull_request.closed handler', () => {
    let handler: (context: any) => Promise<void>;
    let mockApp: any;

    beforeEach(() => {
      mockApp = {
        log: { info: jest.fn() },
        on: jest.fn((event: string, callback: (context: any) => Promise<void>) => {
          if (event === 'pull_request.closed') {
            handler = callback;
          }
        }),
      };

      probotApp(mockApp);

      // Reset mocks
      (handleMergedBranchCleanup as jest.Mock).mockReset();
      (handleMergedBranchCleanup as jest.Mock).mockResolvedValue({
        success: true,
        action: 'branch_cleanup',
        details: { branchName: 'feature-branch' },
      });
    });

    it('should skip when PR is closed but not merged', async () => {
      const context = {
        payload: {
          pull_request: {
            number: 1,
            merged: false,
            head: {
              ref: 'feature-branch',
              sha: 'abc123',
              repo: { fork: false },
            },
          },
          repository: {
            owner: { login: 'NOTRIVIAL' },
            name: 'test-repo',
          },
        },
        octokit: {
          auth: jest.fn().mockResolvedValue({ token: 'test-token' }),
        },
      };

      await handler(context);

      expect(handleMergedBranchCleanup).not.toHaveBeenCalled();
    });

    it('should skip fork branches', async () => {
      const context = {
        payload: {
          pull_request: {
            number: 2,
            merged: true,
            head: {
              ref: 'feature-branch',
              sha: 'def456',
              repo: { fork: true },
            },
          },
          repository: {
            owner: { login: 'NOTRIVIAL' },
            name: 'test-repo',
          },
        },
        octokit: {
          auth: jest.fn().mockResolvedValue({ token: 'test-token' }),
        },
      };

      await handler(context);

      expect(handleMergedBranchCleanup).not.toHaveBeenCalled();
    });

    it('should cleanup branch when PR is merged', async () => {
      const context = {
        payload: {
          pull_request: {
            number: 3,
            merged: true,
            head: {
              ref: 'feature-branch',
              sha: 'ghi789',
              repo: { fork: false },
            },
          },
          repository: {
            owner: { login: 'NOTRIVIAL' },
            name: 'test-repo',
          },
        },
        octokit: {
          auth: jest.fn().mockResolvedValue({ token: 'test-token' }),
        },
      };

      await handler(context);

      expect(handleMergedBranchCleanup).toHaveBeenCalledWith(
        expect.any(Object), // GitHubService
        expect.any(Object), // logger
        expect.any(Object), // config
        { owner: 'NOTRIVIAL', repo: 'test-repo' },
        'feature-branch',
        'ghi789'
      );
    });

    it('should handle cleanup failure gracefully', async () => {
      (handleMergedBranchCleanup as jest.Mock).mockResolvedValue({
        success: false,
        action: 'branch_cleanup',
        details: { branchName: 'feature-branch' },
        error: 'Branch is protected',
      });

      const context = {
        payload: {
          pull_request: {
            number: 4,
            merged: true,
            head: {
              ref: 'feature-branch',
              sha: 'jkl012',
              repo: { fork: false },
            },
          },
          repository: {
            owner: { login: 'NOTRIVIAL' },
            name: 'test-repo',
          },
        },
        octokit: {
          auth: jest.fn().mockResolvedValue({ token: 'test-token' }),
        },
      };

      // Should not throw
      await expect(handler(context)).resolves.not.toThrow();

      expect(handleMergedBranchCleanup).toHaveBeenCalled();
    });
  });
});
