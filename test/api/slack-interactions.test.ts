import { POST } from '@/app/api/slack/interactions/route';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { GitHubService } from '@/src/services/github';
import { BranchAnalyzer } from '@/src/services/branchAnalyzer';
import * as redis from '@/src/services/redis';

// Mock dependencies
jest.mock('@octokit/rest');
jest.mock('@octokit/auth-app');
jest.mock('@/src/services/github');
jest.mock('@/src/services/branchAnalyzer');
jest.mock('@/src/services/redis');

// Mock crypto.timingSafeEqual - use a module-level object to avoid hoisting issues
const cryptoMockState = { timingSafeEqualResult: true };
jest.mock('node:crypto', () => {
  const actual = jest.requireActual('node:crypto');
  return {
    ...actual,
    timingSafeEqual: jest.fn(() => cryptoMockState.timingSafeEqualResult),
  };
});

// Mock fetch for Slack response
global.fetch = jest.fn();

// Mock loadConfig
jest.mock('@/src/utils/config', () => ({
  loadConfig: jest.fn().mockReturnValue({
    stalePrDays: 30,
    requiredApprovals: 1,
    branches: {
      protectedPatterns: ['main', 'master'],
      excludePatterns: [],
    },
  }),
}));

describe('Slack Interactions Route', () => {
  const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
  let mockGithubService: jest.Mocked<GitHubService>;
  let mockBranchAnalyzer: jest.Mocked<BranchAnalyzer>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset environment variables
    process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';
    process.env.APP_ID = '123456';
    process.env.PRIVATE_KEY = 'test-private-key';

    // Mock fetch to resolve successfully by default
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    // Setup default mocks for GitHubService
    mockGithubService = {
      deleteBranch: jest.fn().mockResolvedValue(undefined),
      branchExists: jest.fn().mockResolvedValue(true),
      getDefaultBranch: jest.fn().mockResolvedValue('main'),
      isBranchMerged: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<GitHubService>;

    // Setup default mocks for BranchAnalyzer
    mockBranchAnalyzer = {
      isSafeToDelete: jest.fn().mockResolvedValue({ safe: true }),
    } as unknown as jest.Mocked<BranchAnalyzer>;

    // Mock the constructors
    (GitHubService as jest.MockedClass<typeof GitHubService>).mockImplementation(
      () => mockGithubService
    );
    (BranchAnalyzer as jest.MockedClass<typeof BranchAnalyzer>).mockImplementation(
      () => mockBranchAnalyzer
    );

    // Mock redis functions
    (redis.clearBranchDmRecords as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Reset mock to true for subsequent tests
    cryptoMockState.timingSafeEqualResult = true;
  });

  describe('verifySlackSignature', () => {
    it('should reject invalid signature', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const body = 'payload=%7B%22type%22%3A%22block_actions%22%7D';

      cryptoMockState.timingSafeEqualResult = false;

      const request = new NextRequest('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'x-slack-signature': 'v0=invalid-signature',
          'x-slack-request-timestamp': timestamp,
        },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Invalid signature');
    });

    it('should reject expired timestamp', async () => {
      const expiredTimestamp = (Math.floor(Date.now() / 1000) - 600).toString(); // 10 minutes ago
      const body = 'payload=%7B%22type%22%3A%22block_actions%22%7D';
      const signingSecret = 'test-signing-secret';

      const sigBasestring = `v0:${expiredTimestamp}:${body}`;
      const signature =
        'v0=' + crypto.createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');

      const request = new NextRequest('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'x-slack-signature': signature,
          'x-slack-request-timestamp': expiredTimestamp,
        },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Invalid signature');
    });
  });

  describe('decodePayload', () => {
    it('should handle invalid base64 payload', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();

      const payload = {
        type: 'block_actions',
        user: { id: 'U123', username: 'testuser' },
        actions: [{ action_id: 'branch_delete_approve', value: 'invalid-base64!!!' }],
        response_url: 'https://hooks.slack.com/test',
        message: { ts: '1234567890.123456' },
        channel: { id: 'C123456' },
      };

      const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
      const request = new NextRequest('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'x-slack-signature': 'v0=test',
          'x-slack-request-timestamp': timestamp,
        },
        body,
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          body: expect.stringContaining('Invalid request data'),
        })
      );
    });
  });

  describe('POST handler', () => {
    it('should return 400 for missing payload', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();

      const body = 'other_param=value';
      const request = new NextRequest('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'x-slack-signature': 'v0=test',
          'x-slack-request-timestamp': timestamp,
        },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Missing payload');
    });

    it('should handle non-block_actions type', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();

      const payload = {
        type: 'view_submission',
        user: { id: 'U123', username: 'testuser' },
      };

      const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
      const request = new NextRequest('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'x-slack-signature': 'v0=test',
          'x-slack-request-timestamp': timestamp,
        },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle block_actions with no actions', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();

      const payload = {
        type: 'block_actions',
        user: { id: 'U123', username: 'testuser' },
        actions: [],
        response_url: 'https://hooks.slack.com/test',
        message: { ts: '1234567890.123456' },
        channel: { id: 'C123456' },
      };

      const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
      const request = new NextRequest('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'x-slack-signature': 'v0=test',
          'x-slack-request-timestamp': timestamp,
        },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
    });
  });

  describe('branch_delete_approve action', () => {
    it('should successfully delete branch when approved and safe', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();

      // Mock GitHub App auth
      const { createAppAuth } = require('@octokit/auth-app');
      const mockAuth = jest.fn();
      mockAuth.mockResolvedValueOnce({ token: 'app-token' }); // For app auth
      mockAuth.mockResolvedValueOnce({ token: 'installation-token' }); // For installation auth
      createAppAuth.mockReturnValue(mockAuth);

      const { Octokit } = require('@octokit/rest');
      Octokit.mockImplementation(() => ({
        apps: {
          getRepoInstallation: jest.fn().mockResolvedValue({
            data: { id: 12345 },
          }),
        },
      }));

      const branchPayload = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'feature/test',
      };
      const encodedPayload = Buffer.from(JSON.stringify(branchPayload)).toString('base64');

      const payload = {
        type: 'block_actions',
        user: { id: 'U123', username: 'testuser' },
        actions: [{ action_id: 'branch_delete_approve', value: encodedPayload }],
        response_url: 'https://hooks.slack.com/test',
        message: { ts: '1234567890.123456' },
        channel: { id: 'C123456' },
      };

      const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
      const request = new NextRequest('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'x-slack-signature': 'v0=test',
          'x-slack-request-timestamp': timestamp,
        },
        body,
      });

      mockBranchAnalyzer.isSafeToDelete.mockResolvedValue({ safe: true });
      mockGithubService.deleteBranch.mockResolvedValue(undefined);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(mockBranchAnalyzer.isSafeToDelete).toHaveBeenCalledWith(
        { owner: 'test-owner', repo: 'test-repo' },
        'feature/test'
      );
      expect(mockGithubService.deleteBranch).toHaveBeenCalledWith(
        { owner: 'test-owner', repo: 'test-repo' },
        'feature/test'
      );
      expect(redis.clearBranchDmRecords).toHaveBeenCalledWith(
        'test-owner',
        'test-repo',
        'feature/test'
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          body: expect.stringContaining('has been deleted'),
        })
      );
    });

    it('should block deletion when safety check fails', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();

      // Mock GitHub App auth
      const { createAppAuth } = require('@octokit/auth-app');
      const mockAuth = jest.fn();
      mockAuth.mockResolvedValueOnce({ token: 'app-token' });
      mockAuth.mockResolvedValueOnce({ token: 'installation-token' });
      createAppAuth.mockReturnValue(mockAuth);

      const { Octokit } = require('@octokit/rest');
      Octokit.mockImplementation(() => ({
        apps: {
          getRepoInstallation: jest.fn().mockResolvedValue({
            data: { id: 12345 },
          }),
        },
      }));

      const branchPayload = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'feature/unsafe',
      };
      const encodedPayload = Buffer.from(JSON.stringify(branchPayload)).toString('base64');

      const payload = {
        type: 'block_actions',
        user: { id: 'U123', username: 'testuser' },
        actions: [{ action_id: 'branch_delete_approve', value: encodedPayload }],
        response_url: 'https://hooks.slack.com/test',
        message: { ts: '1234567890.123456' },
        channel: { id: 'C123456' },
      };

      const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
      const request = new NextRequest('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'x-slack-signature': 'v0=test',
          'x-slack-request-timestamp': timestamp,
        },
        body,
      });

      mockBranchAnalyzer.isSafeToDelete.mockResolvedValue({
        safe: false,
        reason: 'Branch has unmerged commits',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(mockGithubService.deleteBranch).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          body: expect.stringContaining('Cannot delete branch'),
        })
      );
    });

    it('should handle deletion error gracefully', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();

      // Mock GitHub App auth
      const { createAppAuth } = require('@octokit/auth-app');
      const mockAuth = jest.fn();
      mockAuth.mockResolvedValueOnce({ token: 'app-token' });
      mockAuth.mockResolvedValueOnce({ token: 'installation-token' });
      createAppAuth.mockReturnValue(mockAuth);

      const { Octokit } = require('@octokit/rest');
      Octokit.mockImplementation(() => ({
        apps: {
          getRepoInstallation: jest.fn().mockResolvedValue({
            data: { id: 12345 },
          }),
        },
      }));

      const branchPayload = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'feature/error',
      };
      const encodedPayload = Buffer.from(JSON.stringify(branchPayload)).toString('base64');

      const payload = {
        type: 'block_actions',
        user: { id: 'U123', username: 'testuser' },
        actions: [{ action_id: 'branch_delete_approve', value: encodedPayload }],
        response_url: 'https://hooks.slack.com/test',
        message: { ts: '1234567890.123456' },
        channel: { id: 'C123456' },
      };

      const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
      const request = new NextRequest('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'x-slack-signature': 'v0=test',
          'x-slack-request-timestamp': timestamp,
        },
        body,
      });

      mockBranchAnalyzer.isSafeToDelete.mockResolvedValue({ safe: true });
      mockGithubService.deleteBranch.mockRejectedValue(new Error('GitHub API error'));

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          body: expect.stringContaining('Failed to delete branch'),
        })
      );
    });
  });

  describe('branch_delete_reject action', () => {
    it('should handle branch deletion rejection', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();

      // Mock GitHub App auth
      const { createAppAuth } = require('@octokit/auth-app');
      const mockAuth = jest.fn();
      mockAuth.mockResolvedValueOnce({ token: 'app-token' });
      mockAuth.mockResolvedValueOnce({ token: 'installation-token' });
      createAppAuth.mockReturnValue(mockAuth);

      const { Octokit } = require('@octokit/rest');
      Octokit.mockImplementation(() => ({
        apps: {
          getRepoInstallation: jest.fn().mockResolvedValue({
            data: { id: 12345 },
          }),
        },
      }));

      const branchPayload = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'feature/keep',
      };
      const encodedPayload = Buffer.from(JSON.stringify(branchPayload)).toString('base64');

      const payload = {
        type: 'block_actions',
        user: { id: 'U123', username: 'testuser' },
        actions: [{ action_id: 'branch_delete_reject', value: encodedPayload }],
        response_url: 'https://hooks.slack.com/test',
        message: { ts: '1234567890.123456' },
        channel: { id: 'C123456' },
      };

      const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
      const request = new NextRequest('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'x-slack-signature': 'v0=test',
          'x-slack-request-timestamp': timestamp,
        },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(mockGithubService.deleteBranch).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          body: expect.stringContaining('will be kept'),
        })
      );
    });
  });

  describe('GitHub App auth error handling', () => {
    it('should handle missing APP_ID', async () => {
      delete process.env.APP_ID;
      const timestamp = Math.floor(Date.now() / 1000).toString();

      const branchPayload = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'feature/test',
      };
      const encodedPayload = Buffer.from(JSON.stringify(branchPayload)).toString('base64');

      const payload = {
        type: 'block_actions',
        user: { id: 'U123', username: 'testuser' },
        actions: [{ action_id: 'branch_delete_approve', value: encodedPayload }],
        response_url: 'https://hooks.slack.com/test',
        message: { ts: '1234567890.123456' },
        channel: { id: 'C123456' },
      };

      const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
      const request = new NextRequest('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'x-slack-signature': 'v0=test',
          'x-slack-request-timestamp': timestamp,
        },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          body: expect.stringContaining('GitHub App error'),
        })
      );
    });

    it('should handle missing PRIVATE_KEY', async () => {
      delete process.env.PRIVATE_KEY;
      const timestamp = Math.floor(Date.now() / 1000).toString();

      const branchPayload = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'feature/test',
      };
      const encodedPayload = Buffer.from(JSON.stringify(branchPayload)).toString('base64');

      const payload = {
        type: 'block_actions',
        user: { id: 'U123', username: 'testuser' },
        actions: [{ action_id: 'branch_delete_approve', value: encodedPayload }],
        response_url: 'https://hooks.slack.com/test',
        message: { ts: '1234567890.123456' },
        channel: { id: 'C123456' },
      };

      const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
      const request = new NextRequest('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'x-slack-signature': 'v0=test',
          'x-slack-request-timestamp': timestamp,
        },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          body: expect.stringContaining('GitHub App error'),
        })
      );
    });

    it('should handle GitHub App installation error', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();

      // Mock GitHub App auth to fail
      const { createAppAuth } = require('@octokit/auth-app');
      const mockAuth = jest.fn().mockResolvedValue({ token: 'app-token' });
      createAppAuth.mockReturnValue(mockAuth);

      const { Octokit } = require('@octokit/rest');
      Octokit.mockImplementation(() => ({
        apps: {
          getRepoInstallation: jest.fn().mockRejectedValue(new Error('Installation not found')),
        },
      }));

      const branchPayload = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'feature/test',
      };
      const encodedPayload = Buffer.from(JSON.stringify(branchPayload)).toString('base64');

      const payload = {
        type: 'block_actions',
        user: { id: 'U123', username: 'testuser' },
        actions: [{ action_id: 'branch_delete_approve', value: encodedPayload }],
        response_url: 'https://hooks.slack.com/test',
        message: { ts: '1234567890.123456' },
        channel: { id: 'C123456' },
      };

      const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
      const request = new NextRequest('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'x-slack-signature': 'v0=test',
          'x-slack-request-timestamp': timestamp,
        },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          body: expect.stringContaining('GitHub App error'),
        })
      );
    });
  });

  describe('signature verification disabled', () => {
    it('should skip signature verification when SLACK_SIGNING_SECRET is not set', async () => {
      delete process.env.SLACK_SIGNING_SECRET;
      const timestamp = Math.floor(Date.now() / 1000).toString();

      const payload = {
        type: 'block_actions',
        user: { id: 'U123', username: 'testuser' },
        actions: [],
        response_url: 'https://hooks.slack.com/test',
        message: { ts: '1234567890.123456' },
        channel: { id: 'C123456' },
      };

      const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
      const request = new NextRequest('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'x-slack-signature': 'any-signature',
          'x-slack-request-timestamp': timestamp,
        },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
    });
  });
});
