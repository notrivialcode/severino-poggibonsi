import { GitHubService } from './github';
import { ILogger, BranchAnalysis, GitHubContext, BotConfig } from '../types';
import { isProtectedBranch, isExcludedBranch } from '../utils/config';

export class BranchAnalyzer {
  private github: GitHubService;
  private logger: ILogger;
  private config: BotConfig;

  constructor(github: GitHubService, logger: ILogger, config: BotConfig) {
    this.github = github;
    this.logger = logger;
    this.config = config;
  }

  async analyzeBranch(context: GitHubContext, branchName: string): Promise<BranchAnalysis | null> {
    this.logger.debug('Analyzing branch', { ...context, branchName });

    // Skip protected and excluded branches
    if (isProtectedBranch(branchName, this.config) || isExcludedBranch(branchName, this.config)) {
      this.logger.debug('Skipping protected/excluded branch', { branchName });
      return null;
    }

    try {
      const defaultBranch = await this.github.getDefaultBranch(context);

      // Skip if this is the default branch
      if (branchName === defaultBranch) {
        return null;
      }

      const [isMerged, prNumber, commits, branchSha] = await Promise.all([
        this.github.isBranchMerged(context, branchName, defaultBranch),
        this.github.findPullRequestForBranch(context, branchName),
        this.github.getBranchCommits(context, branchName, 10),
        this.github.getBranchSha(context, branchName),
      ]);

      if (!branchSha) {
        this.logger.warn('Could not get branch SHA', { branchName });
        return null;
      }

      // Get unique contributors from commits
      const contributors = [...new Set(commits.map((c) => c.author))];

      // Get last commit date
      const lastCommitDate = commits.length > 0
        ? commits.reduce((latest, c) => c.date > latest ? c.date : latest, new Date(0))
        : new Date(0);

      return {
        branch: {
          name: branchName,
          sha: branchSha,
          protected: false,
        },
        isMerged,
        hasAssociatedPr: prNumber !== null,
        associatedPrNumber: prNumber || undefined,
        contributors,
        lastCommitDate,
      };
    } catch (error) {
      this.logger.error('Error analyzing branch', { error, branchName });
      return null;
    }
  }

  async findManuallyMergedBranches(context: GitHubContext): Promise<BranchAnalysis[]> {
    this.logger.info('Finding manually merged branches', context);

    const branches = await this.github.listBranches(context);
    const results: BranchAnalysis[] = [];

    for (const branch of branches) {
      const analysis = await this.analyzeBranch(context, branch.name);

      if (analysis && analysis.isMerged && !analysis.hasAssociatedPr) {
        this.logger.info('Found manually merged branch', {
          branch: analysis.branch.name,
          contributors: analysis.contributors,
        });
        results.push(analysis);
      }
    }

    return results;
  }

  async findPrMergedBranches(context: GitHubContext): Promise<BranchAnalysis[]> {
    this.logger.info('Finding PR-merged branches still present', context);

    const branches = await this.github.listBranches(context);
    const results: BranchAnalysis[] = [];

    for (const branch of branches) {
      const analysis = await this.analyzeBranch(context, branch.name);

      if (analysis && analysis.isMerged && analysis.hasAssociatedPr) {
        this.logger.info('Found PR-merged branch still present', {
          branch: analysis.branch.name,
          prNumber: analysis.associatedPrNumber,
        });
        results.push(analysis);
      }
    }

    return results;
  }

  async isSafeToDelete(context: GitHubContext, branchName: string, expectedSha?: string): Promise<{ safe: boolean; reason?: string }> {
    this.logger.debug('Checking if safe to delete', { ...context, branchName, expectedSha });

    // Check if protected first (local check, no API call needed)
    if (isProtectedBranch(branchName, this.config)) {
      return { safe: false, reason: 'Branch is protected' };
    }

    // Check if branch still exists
    const exists = await this.github.branchExists(context, branchName);
    if (!exists) {
      return { safe: false, reason: 'Branch no longer exists' };
    }

    // Check if default branch
    const defaultBranch = await this.github.getDefaultBranch(context);
    if (branchName === defaultBranch) {
      return { safe: false, reason: 'Cannot delete default branch' };
    }

    // Check if merged
    const isMerged = await this.github.isBranchMerged(context, branchName, defaultBranch);
    if (!isMerged) {
      return { safe: false, reason: 'Branch is not fully merged' };
    }

    // If expectedSha provided, verify no new commits
    if (expectedSha) {
      const currentSha = await this.github.getBranchSha(context, branchName);
      if (currentSha !== expectedSha) {
        return { safe: false, reason: 'Branch has new commits since last check' };
      }
    }

    return { safe: true };
  }
}
