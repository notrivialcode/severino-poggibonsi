import { GitHubService } from '../services/github';
import { MockLogger } from '../utils/logger';
import { loadConfig, loadRemoteConfig } from '../utils/config';
import { handleStalePrs } from '../handlers/stalePrs';
import { GitHubContext } from '../types';

async function main(): Promise<void> {
  const logger = new MockLogger();
  const localConfig = loadConfig();

  logger.info(`${localConfig.bot.name} - Stale PR Check Starting`);

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    logger.error('GITHUB_TOKEN environment variable is required');
    process.exit(1);
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

  // Load remote config from first target repo
  const config = await loadRemoteConfig(
    (path) => github.getFileContent(contexts[0], path),
    localConfig
  );

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
