import { v4 as uuidv4 } from 'uuid';
import { GitHubService } from '../services/github';
import { SlackService } from '../services/slack';
import { BranchAnalyzer } from '../services/branchAnalyzer';
import { ILogger, BotConfig, GitHubContext, PendingDeletion, ActionResult } from '../types';

export class ManualMergesHandler {
  private github: GitHubService;
  private slack: SlackService;
  private analyzer: BranchAnalyzer;
  private logger: ILogger;
  private config: BotConfig;
  private pendingDeletions: Map<string, PendingDeletion> = new Map();

  constructor(
    github: GitHubService,
    slack: SlackService,
    logger: ILogger,
    config: BotConfig
  ) {
    this.github = github;
    this.slack = slack;
    this.logger = logger;
    this.config = config;
    this.analyzer = new BranchAnalyzer(github, logger, config);
  }

  async processRepository(context: GitHubContext): Promise<ActionResult[]> {
    this.logger.info('Processing repository for manual merges', context);
    const results: ActionResult[] = [];

    try {
      const manuallyMergedBranches = await this.analyzer.findManuallyMergedBranches(context);

      this.logger.info(`Found ${manuallyMergedBranches.length} manually merged branches`, context);

      for (const analysis of manuallyMergedBranches) {
        const result = await this.requestDeletionPermission(
          context,
          analysis.branch.name,
          analysis.contributors
        );
        results.push(result);
      }
    } catch (error) {
      this.logger.error('Error processing repository for manual merges', { error, ...context });
    }

    return results;
  }

  async requestDeletionPermission(
    context: GitHubContext,
    branchName: string,
    contributors: string[]
  ): Promise<ActionResult> {
    this.logger.info('Requesting deletion permission via Slack', {
      ...context,
      branchName,
      contributors,
    });

    const requestId = uuidv4();
    const repoFullName = `${context.owner}/${context.repo}`;

    // Create pending deletion record
    const pendingDeletion: PendingDeletion = {
      id: requestId,
      repo: context.repo,
      owner: context.owner,
      branchName,
      contributors,
      requestedAt: new Date(),
      status: 'pending',
    };

    this.pendingDeletions.set(requestId, pendingDeletion);

    // Send Slack messages to all contributors
    let messagesSent = 0;
    for (const contributor of contributors) {
      const messageTs = await this.slack.sendBranchDeletionRequest(
        contributor,
        branchName,
        repoFullName,
        requestId
      );

      if (messageTs) {
        messagesSent++;
        this.logger.info('Sent deletion request to contributor', {
          contributor,
          branchName,
        });
      } else {
        this.logger.warn('Could not send deletion request to contributor', {
          contributor,
          branchName,
        });
      }
    }

    if (messagesSent > 0) {
      return {
        success: true,
        action: 'deletion_request_sent',
        details: {
          requestId,
          branchName,
          repo: repoFullName,
          contributors,
          messagesSent,
        },
      };
    } else {
      // No messages sent - likely no Slack mappings for contributors
      return {
        success: false,
        action: 'deletion_request_sent',
        details: {
          requestId,
          branchName,
          repo: repoFullName,
          contributors,
        },
        error: 'No Slack messages could be sent - check user mappings',
      };
    }
  }

  async handleDeletionResponse(requestId: string, approved: boolean): Promise<ActionResult> {
    const pending = this.pendingDeletions.get(requestId);

    if (!pending) {
      this.logger.warn('Deletion request not found', { requestId });
      return {
        success: false,
        action: 'deletion_response',
        details: { requestId },
        error: 'Request not found or expired',
      };
    }

    if (pending.status !== 'pending') {
      this.logger.warn('Deletion request already processed', { requestId, status: pending.status });
      return {
        success: false,
        action: 'deletion_response',
        details: { requestId, status: pending.status },
        error: 'Request already processed',
      };
    }

    const context: GitHubContext = {
      owner: pending.owner,
      repo: pending.repo,
    };

    if (approved) {
      // Verify it's still safe to delete
      const safetyCheck = await this.analyzer.isSafeToDelete(context, pending.branchName);

      if (!safetyCheck.safe) {
        pending.status = 'rejected';
        this.pendingDeletions.set(requestId, pending);

        this.logger.warn('Branch deletion blocked by safety check after approval', {
          branchName: pending.branchName,
          reason: safetyCheck.reason,
        });

        return {
          success: false,
          action: 'branch_deletion',
          details: {
            requestId,
            branchName: pending.branchName,
            reason: safetyCheck.reason,
          },
          error: safetyCheck.reason,
        };
      }

      try {
        await this.github.deleteBranch(context, pending.branchName);
        pending.status = 'approved';
        this.pendingDeletions.set(requestId, pending);

        this.logger.info('Successfully deleted manually merged branch after approval', {
          branchName: pending.branchName,
          requestId,
        });

        return {
          success: true,
          action: 'branch_deletion',
          details: {
            requestId,
            branchName: pending.branchName,
            repo: `${pending.owner}/${pending.repo}`,
          },
        };
      } catch (error) {
        this.logger.error('Failed to delete branch after approval', {
          error,
          branchName: pending.branchName,
        });
        return {
          success: false,
          action: 'branch_deletion',
          details: { requestId, branchName: pending.branchName },
          error: String(error),
        };
      }
    } else {
      // User rejected deletion
      pending.status = 'rejected';
      this.pendingDeletions.set(requestId, pending);

      this.logger.info('Branch deletion rejected by user', {
        branchName: pending.branchName,
        requestId,
      });

      return {
        success: true,
        action: 'deletion_rejected',
        details: {
          requestId,
          branchName: pending.branchName,
          repo: `${pending.owner}/${pending.repo}`,
        },
      };
    }
  }

  getPendingDeletions(): PendingDeletion[] {
    return Array.from(this.pendingDeletions.values()).filter(
      (p) => p.status === 'pending'
    );
  }

  getPendingDeletion(requestId: string): PendingDeletion | undefined {
    return this.pendingDeletions.get(requestId);
  }
}

export async function handleManualMerges(
  github: GitHubService,
  slack: SlackService,
  logger: ILogger,
  config: BotConfig,
  contexts: GitHubContext[]
): Promise<ActionResult[]> {
  const handler = new ManualMergesHandler(github, slack, logger, config);
  const allResults: ActionResult[] = [];

  for (const context of contexts) {
    const results = await handler.processRepository(context);
    allResults.push(...results);
  }

  logger.info('Manual merge processing complete', {
    totalActions: allResults.length,
    successful: allResults.filter((r) => r.success).length,
    failed: allResults.filter((r) => !r.success).length,
  });

  return allResults;
}
