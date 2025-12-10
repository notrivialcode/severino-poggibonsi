import { GitHubService } from '../services/github';
import { MockLogger } from '../utils/logger';
import { loadConfig, loadRemoteConfig } from '../utils/config';
import { handleMergedBranchCleanup } from '../handlers/mergedBranches';

async function main(): Promise<void> {
  const logger = new MockLogger();
  const localConfig = loadConfig();

  logger.info(`${localConfig.bot.name} - Branch Cleanup Starting`);

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    logger.error('GITHUB_TOKEN environment variable is required');
    process.exit(1);
  }

  // Get branch info from environment (set by GitHub Actions)
  // Support both formats: BRANCH_NAME/TARGET_OWNER/TARGET_REPO or HEAD_REF/GITHUB_REPOSITORY
  const branchName = process.env.BRANCH_NAME || process.env.HEAD_REF;
  const owner = process.env.TARGET_OWNER;
  const repo = process.env.TARGET_REPO;
  const repoFullName = process.env.GITHUB_REPOSITORY;

  let finalOwner = owner;
  let finalRepo = repo;

  if (!finalOwner || !finalRepo) {
    if (repoFullName) {
      const [repoOwner, repoName] = repoFullName.split('/');
      finalOwner = repoOwner;
      finalRepo = repoName;
    }
  }

  if (!branchName || !finalOwner || !finalRepo) {
    logger.error(
      'Required environment variables missing. Need BRANCH_NAME (or HEAD_REF) and TARGET_OWNER/TARGET_REPO (or GITHUB_REPOSITORY)'
    );
    process.exit(1);
  }

  const github = new GitHubService(token, logger);
  const context = { owner: finalOwner, repo: finalRepo };

  // Load config from target repository
  const config = await loadRemoteConfig(
    (path) => github.getFileContent(context, path),
    localConfig
  );

  logger.info('Loaded config', {
    protectedBranches: config.branches.protectedPatterns,
  });

  // Check dry run mode
  const dryRun = process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1';
  if (dryRun) {
    logger.info('DRY RUN MODE - No actions will be performed');
  }

  // Use provided SHA or fetch current SHA
  let branchSha: string | undefined = process.env.BRANCH_SHA;
  if (!branchSha) {
    branchSha = (await github.getBranchSha(context, branchName)) || undefined;
  }

  if (!branchSha) {
    logger.info('Branch already deleted or not found', { branch: branchName });
    process.exit(0);
  }

  const result = await handleMergedBranchCleanup(
    github,
    logger,
    config,
    context,
    branchName,
    branchSha,
    dryRun
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
