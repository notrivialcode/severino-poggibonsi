import { GitHubService } from '../services/github';
import { SlackService } from '../services/slack';
import { MockLogger } from '../utils/logger';
import { loadConfig, loadUserMapping } from '../utils/config';
import { handleManualMerges } from '../handlers/manualMerges';
import { GitHubContext } from '../types';

async function main(): Promise<void> {
  const logger = new MockLogger();
  const config = loadConfig();
  const userMapping = loadUserMapping();

  logger.info(`${config.bot.name} - Manual Merge Check Starting`);

  const token = process.env.GITHUB_TOKEN;
  const slackToken = process.env.SLACK_BOT_TOKEN;

  if (!token) {
    logger.error('GITHUB_TOKEN environment variable is required');
    process.exit(1);
  }

  if (!slackToken) {
    logger.warn('SLACK_BOT_TOKEN not set - Slack notifications will be disabled');
  }

  const github = new GitHubService(token, logger);
  const slack = new SlackService(slackToken || '', logger, userMapping);

  // Get all repos in the organization
  const repos = await github.listOrgRepos(config.bot.organization);
  logger.info(`Found ${repos.length} repositories in ${config.bot.organization}`);

  const contexts: GitHubContext[] = repos.map((repo) => ({
    owner: repo.owner,
    repo: repo.name,
  }));

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
