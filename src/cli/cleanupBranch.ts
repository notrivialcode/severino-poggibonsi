import { GitHubService } from '../services/github';
import { MockLogger } from '../utils/logger';
import { loadConfig } from '../utils/config';
import { handleMergedBranchCleanup } from '../handlers/mergedBranches';

async function main(): Promise<void> {
  const logger = new MockLogger();
  const config = loadConfig();

  logger.info(`${config.bot.name} - Branch Cleanup Starting`);

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    logger.error('GITHUB_TOKEN environment variable is required');
    process.exit(1);
  }

  // Get branch info from environment (set by GitHub Actions)
  const headRef = process.env.HEAD_REF;
  const repoFullName = process.env.GITHUB_REPOSITORY;

  if (!headRef || !repoFullName) {
    logger.error('HEAD_REF and GITHUB_REPOSITORY environment variables are required');
    process.exit(1);
  }

  const [owner, repo] = repoFullName.split('/');
  if (!owner || !repo) {
    logger.error('Invalid GITHUB_REPOSITORY format');
    process.exit(1);
  }

  const github = new GitHubService(token, logger);

  // Get the current SHA of the branch
  const branchSha = await github.getBranchSha({ owner, repo }, headRef);
  if (!branchSha) {
    logger.info('Branch already deleted or not found', { branch: headRef });
    process.exit(0);
  }

  const result = await handleMergedBranchCleanup(
    github,
    logger,
    config,
    { owner, repo },
    headRef,
    branchSha
  );

  if (result.success) {
    logger.info('Successfully cleaned up branch', result.details);
    process.exit(0);
  } else {
    logger.warn('Could not clean up branch', { error: result.error, ...result.details });
    // Don't exit with error - this might be expected (e.g., protected branch)
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
