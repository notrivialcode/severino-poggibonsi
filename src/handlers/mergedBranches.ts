import { GitHubService } from '../services/github';
import { BranchAnalyzer } from '../services/branchAnalyzer';
import { ILogger, BotConfig, GitHubContext, ActionResult } from '../types';

export class MergedBranchesHandler {
  private github: GitHubService;
  private analyzer: BranchAnalyzer;
  private logger: ILogger;
  private config: BotConfig;
  private dryRun: boolean;

  constructor(github: GitHubService, logger: ILogger, config: BotConfig, dryRun: boolean = false) {
    this.github = github;
    this.logger = logger;
    this.config = config;
    this.analyzer = new BranchAnalyzer(github, logger, config);
    this.dryRun = dryRun;
  }

  async cleanupMergedPrBranch(
    context: GitHubContext,
    branchName: string,
    expectedSha: string
  ): Promise<ActionResult> {
    this.logger.info('Attempting to cleanup merged PR branch', {
      ...context,
      branchName,
      expectedSha,
    });

    // Safety check
    const safetyCheck = await this.analyzer.isSafeToDelete(context, branchName, expectedSha);

    if (!safetyCheck.safe) {
      this.logger.warn('Branch deletion blocked by safety check', {
        branchName,
        reason: safetyCheck.reason,
      });
      return {
        success: false,
        action: 'branch_cleanup',
        details: { branchName, reason: safetyCheck.reason },
        error: safetyCheck.reason,
      };
    }

    // Dry run mode - log but don't execute
    if (this.dryRun) {
      this.logger.info('[DRY RUN] Would delete merged branch', {
        ...context,
        branchName,
        sha: expectedSha,
      });
      return {
        success: true,
        action: 'branch_cleanup_dry_run',
        details: {
          branchName,
          sha: expectedSha,
          repo: `${context.owner}/${context.repo}`,
          dryRun: true,
        },
      };
    }

    try {
      await this.github.deleteBranch(context, branchName);

      this.logger.info('Successfully deleted merged branch', {
        ...context,
        branchName,
      });

      return {
        success: true,
        action: 'branch_cleanup',
        details: {
          branchName,
          sha: expectedSha,
          repo: `${context.owner}/${context.repo}`,
        },
      };
    } catch (error) {
      this.logger.error('Failed to delete branch', { error, branchName });
      return {
        success: false,
        action: 'branch_cleanup',
        details: { branchName },
        error: String(error),
      };
    }
  }

  async scanAndCleanupPrMergedBranches(context: GitHubContext): Promise<ActionResult[]> {
    this.logger.info('Scanning for PR-merged branches to cleanup', context);
    const results: ActionResult[] = [];

    try {
      const prMergedBranches = await this.analyzer.findPrMergedBranches(context);

      this.logger.info(
        `Found ${prMergedBranches.length} PR-merged branches still present`,
        context
      );

      for (const analysis of prMergedBranches) {
        const result = await this.cleanupMergedPrBranch(
          context,
          analysis.branch.name,
          analysis.branch.sha
        );
        results.push(result);
      }
    } catch (error) {
      this.logger.error('Error scanning for PR-merged branches', { error, ...context });
    }

    return results;
  }
}

export async function handleMergedBranchCleanup(
  github: GitHubService,
  logger: ILogger,
  config: BotConfig,
  context: GitHubContext,
  branchName: string,
  expectedSha: string,
  dryRun: boolean = false
): Promise<ActionResult> {
  const handler = new MergedBranchesHandler(github, logger, config, dryRun);
  return handler.cleanupMergedPrBranch(context, branchName, expectedSha);
}

export async function scanAndCleanupAllPrMergedBranches(
  github: GitHubService,
  logger: ILogger,
  config: BotConfig,
  contexts: GitHubContext[]
): Promise<ActionResult[]> {
  const handler = new MergedBranchesHandler(github, logger, config);
  const allResults: ActionResult[] = [];

  for (const context of contexts) {
    const results = await handler.scanAndCleanupPrMergedBranches(context);
    allResults.push(...results);
  }

  logger.info('PR-merged branch cleanup complete', {
    totalActions: allResults.length,
    successful: allResults.filter((r) => r.success).length,
    failed: allResults.filter((r) => !r.success).length,
  });

  return allResults;
}
