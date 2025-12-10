import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { GitHubService } from '../../../../src/services/github';
import { BranchAnalyzer } from '../../../../src/services/branchAnalyzer';
import { MockLogger } from '../../../../src/utils/logger';
import { loadConfig } from '../../../../src/utils/config';
import { clearBranchDmRecords } from '../../../../src/services/kvStore';

interface SlackInteractionPayload {
  type: string;
  user: {
    id: string;
    username: string;
  };
  actions: Array<{
    action_id: string;
    value: string;
  }>;
  response_url: string;
  message: {
    ts: string;
  };
  channel: {
    id: string;
  };
}

interface BranchDeletionPayload {
  owner: string;
  repo: string;
  branch: string;
}

function verifySlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string
): boolean {
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp) < fiveMinutesAgo) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature =
    'v0=' + crypto.createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');

  return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature));
}

function decodePayload(value: string): BranchDeletionPayload | null {
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

async function sendSlackResponse(responseUrl: string, message: string, replace = true) {
  await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      replace_original: replace,
      text: message,
    }),
  });
}

async function getInstallationToken(owner: string, repo: string): Promise<string> {
  const appId = process.env.APP_ID;
  const privateKey = process.env.PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!appId || !privateKey) {
    throw new Error(
      `GitHub App credentials not configured: APP_ID=${appId ? 'set' : 'missing'}, PRIVATE_KEY=${privateKey ? 'set' : 'missing'}`
    );
  }

  try {
    // Create app auth (appId must be a number)
    const auth = createAppAuth({
      appId: Number(appId),
      privateKey,
    });

    // Get app authentication to find installation
    const appAuth = await auth({ type: 'app' });
    const appOctokit = new Octokit({ auth: appAuth.token });

    // Get installation for this repository
    const { data: installation } = await appOctokit.apps.getRepoInstallation({
      owner,
      repo,
    });

    // Get installation token
    const installationAuth = await auth({
      type: 'installation',
      installationId: installation.id,
    });

    return installationAuth.token;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get installation token for ${owner}/${repo}: ${message}`);
  }
}

export async function POST(request: NextRequest) {
  const logger = new MockLogger();

  try {
    const body = await request.text();
    const signature = request.headers.get('x-slack-signature') || '';
    const timestamp = request.headers.get('x-slack-request-timestamp') || '';
    const signingSecret = process.env.SLACK_SIGNING_SECRET || '';

    // Verify Slack signature
    if (signingSecret && !verifySlackSignature(signingSecret, signature, timestamp, body)) {
      logger.error('Invalid Slack signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Parse the payload (Slack sends it as form-urlencoded)
    const params = new URLSearchParams(body);
    const payloadStr = params.get('payload');

    if (!payloadStr) {
      return NextResponse.json({ error: 'Missing payload' }, { status: 400 });
    }

    const payload: SlackInteractionPayload = JSON.parse(payloadStr);

    if (payload.type !== 'block_actions') {
      return NextResponse.json({ ok: true });
    }

    const action = payload.actions[0];
    if (!action) {
      return NextResponse.json({ ok: true });
    }

    const { action_id, value } = action;
    const branchPayload = decodePayload(value);

    if (!branchPayload) {
      logger.error('Invalid branch payload', { value });
      await sendSlackResponse(
        payload.response_url,
        '❌ Invalid request data. Please try again or contact support.'
      );
      return NextResponse.json({ ok: true });
    }

    const { owner, repo, branch } = branchPayload;

    // Get installation token using GitHub App credentials (no PAT needed)
    let githubToken: string;
    try {
      githubToken = await getInstallationToken(owner, repo);
    } catch (error) {
      // Log full error details for debugging
      console.error('GitHub App auth error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error('Failed to get GitHub installation token', {
        error: errorMessage,
        stack: errorStack,
        owner,
        repo,
      });
      await sendSlackResponse(payload.response_url, `❌ GitHub App error: ${errorMessage}`);
      return NextResponse.json({ ok: true });
    }

    const github = new GitHubService(githubToken, logger);
    const config = loadConfig();
    const analyzer = new BranchAnalyzer(github, logger, config);
    const context = { owner, repo };

    if (action_id === 'branch_delete_approve') {
      logger.info('Branch deletion approved', { owner, repo, branch, user: payload.user.username });

      // Safety check before deletion
      const safetyCheck = await analyzer.isSafeToDelete(context, branch);

      if (!safetyCheck.safe) {
        logger.warn('Branch deletion blocked by safety check', {
          branch,
          reason: safetyCheck.reason,
        });
        await sendSlackResponse(
          payload.response_url,
          `⚠️ Cannot delete branch \`${branch}\`:\n${safetyCheck.reason}`
        );
        return NextResponse.json({ ok: true });
      }

      // Delete the branch
      try {
        await github.deleteBranch(context, branch);
        // Clear KV records so we don't skip if a new branch with same name appears
        await clearBranchDmRecords(owner, repo, branch);
        logger.info('Branch deleted successfully', { owner, repo, branch });
        await sendSlackResponse(
          payload.response_url,
          `✅ Branch \`${branch}\` in \`${owner}/${repo}\` has been deleted.\n\nGrazie!`
        );
      } catch (error) {
        logger.error('Failed to delete branch', { error, owner, repo, branch });
        await sendSlackResponse(
          payload.response_url,
          `❌ Failed to delete branch \`${branch}\`: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    } else if (action_id === 'branch_delete_reject') {
      logger.info('Branch deletion rejected', { owner, repo, branch, user: payload.user.username });
      await sendSlackResponse(
        payload.response_url,
        `👍 Got it! Branch \`${branch}\` in \`${owner}/${repo}\` will be kept.\n\nNo problem!`
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error('Error processing Slack interaction', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
