import { GitHubService } from '../services/github';
import { MockLogger } from '../utils/logger';
import { loadConfig } from '../utils/config';
import { handleStalePrs } from '../handlers/stalePrs';
import { GitHubContext } from '../types';

async function main(): Promise<void> {
  const logger = new MockLogger();
  const config = loadConfig();

  logger.info(`${config.bot.name} - Stale PR Check Starting`);

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    logger.error('GITHUB_TOKEN environment variable is required');
    process.exit(1);
  }

  const github = new GitHubService(token, logger);

  // Get all repos in the organization
  const repos = await github.listOrgRepos(config.bot.organization);
  logger.info(`Found ${repos.length} repositories in ${config.bot.organization}`);

  const contexts: GitHubContext[] = repos.map((repo) => ({
    owner: repo.owner,
    repo: repo.name,
  }));

  const results = await handleStalePrs(github, logger, config, contexts);

  // Summary
  const warnings = results.filter((r) => r.action === 'stale_warning' && r.success);
  const closes = results.filter((r) => r.action === 'stale_close' && r.success);
  const failures = results.filter((r) => !r.success);

  logger.info('Stale PR check complete', {
    warnings: warnings.length,
    closes: closes.length,
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
