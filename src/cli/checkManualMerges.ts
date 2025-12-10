import { GitHubService } from '../services/github';
import { SlackService } from '../services/slack';
import { MockLogger } from '../utils/logger';
import { loadConfig, loadRemoteConfig } from '../utils/config';
import { handleManualMerges } from '../handlers/manualMerges';
import { GitHubContext } from '../types';

async function main(): Promise<void> {
  const logger = new MockLogger();
  const localConfig = loadConfig();

  logger.info(`${localConfig.bot.name} - Manual Merge Check Starting`);

  const token = process.env.GITHUB_TOKEN;
  const slackToken = process.env.SLACK_BOT_TOKEN;

  if (!token) {
    logger.error('GITHUB_TOKEN environment variable is required');
    process.exit(1);
  }

  if (!slackToken) {
    logger.warn('SLACK_BOT_TOKEN not set - Slack notifications will be disabled');
  }

  // Get target repo from env vars (single repo mode) or fall back to org scan
  const targetOwner = process.env.TARGET_OWNER;
  const targetRepo = process.env.TARGET_REPO;

  const github = new GitHubService(token, logger);

  let contexts: GitHubContext[];

  if (targetOwner && targetRepo) {
    // Single repo mode - use TARGET_OWNER and TARGET_REPO
    contexts = [{ owner: targetOwner, repo: targetRepo }];
    logger.info(`Targeting single repository: ${targetOwner}/${targetRepo}`);
  } else {
    // Org mode - scan all repos in organization
    const org = localConfig.bot.organization;
    const repos = await github.listOrgRepos(org);
    logger.info(`Found ${repos.length} repositories in ${org}`);
    contexts = repos.map((repo) => ({
      owner: repo.owner,
      repo: repo.name,
    }));
  }

  // Load remote config from first target repo (includes userMapping)
  const config = await loadRemoteConfig(
    (path) => github.getFileContent(contexts[0], path),
    localConfig
  );

  // Create Slack service with userMapping from remote config
  const slack = new SlackService(slackToken || '', logger, config.userMapping);

  const results = await handleManualMerges(github, slack, logger, config, contexts);

  // Summary
  const sent = results.filter((r) => r.action === 'deletion_request_sent' && r.success);
  const failures = results.filter((r) => !r.success);

  logger.info('Manual merge check complete', {
    requestsSent: sent.length,
    failures: failures.length,
  });

  if (failures.length > 0) {
    logger.warn('Some actions failed', { failures });
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
