import { Probot } from 'probot';
import { GitHubService } from './services/github';
import { MockLogger } from './utils/logger';
import { loadConfig } from './utils/config';
import { handleMergedBranchCleanup } from './handlers/mergedBranches';

const probotApp = (app: Probot) => {
  const logger = new MockLogger();
  const config = loadConfig();

  app.log.info(`${config.bot.name} is starting up...`);

  // Handle PR merged events for automatic branch cleanup
  app.on('pull_request.closed', async (context) => {
    const pr = context.payload.pull_request;

    // Only process merged PRs
    if (!pr.merged) {
      logger.debug('PR closed but not merged, skipping', { prNumber: pr.number });
      return;
    }

    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;
    const branchName = pr.head.ref;
    const headSha = pr.head.sha;

    logger.info('PR merged, attempting branch cleanup', {
      owner,
      repo,
      prNumber: pr.number,
      branchName,
    });

    // Skip if the branch is from a fork
    if (pr.head.repo?.fork) {
      logger.debug('Skipping fork branch', { branchName });
      return;
    }

    const token = await context.octokit.auth({ type: 'installation' }) as { token: string };
    const github = new GitHubService(token.token, logger);

    const result = await handleMergedBranchCleanup(
      github,
      logger,
      config,
      { owner, repo },
      branchName,
      headSha
    );

    if (result.success) {
      logger.info('Successfully cleaned up merged branch', result.details);
    } else {
      logger.warn('Could not clean up merged branch', { error: result.error, ...result.details });
    }
  });

  app.log.info(`${config.bot.name} is ready!`);
};

export default probotApp;
