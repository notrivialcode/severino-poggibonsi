import { GitHubService } from '../services/github';
import { ILogger, BotConfig, GitHubContext, PullRequest, ActionResult } from '../types';
import { hasExcludedLabel } from '../utils/config';

const BOT_NAME = 'Severino Poggibonsi';
const BOT_AVATAR_URL = 'https://severino-poggibonsi.vercel.app/severino-avatar.png';
const WARNING_COMMENT_MARKER = '<!-- severino-stale-warning -->';
const CLOSING_COMMENT_MARKER = '<!-- severino-stale-close -->';

function createBotSignature(): string {
  return `<img src="${BOT_AVATAR_URL}" width="32" height="32" align="left" style="margin-right: 10px;" />\n\n**${BOT_NAME}** | NOTRIVIAL Bot`;
}

export class StalePrsHandler {
  private github: GitHubService;
  private logger: ILogger;
  private config: BotConfig;

  constructor(github: GitHubService, logger: ILogger, config: BotConfig) {
    this.github = github;
    this.logger = logger;
    this.config = config;
  }

  async processRepository(context: GitHubContext): Promise<ActionResult[]> {
    this.logger.info('Processing repository for stale PRs', context);
    const results: ActionResult[] = [];

    try {
      const prs = await this.github.listOpenPullRequests(context);
      this.logger.info(`Found ${prs.length} open PRs`, context);

      for (const pr of prs) {
        const result = await this.processPullRequest(context, pr);
        if (result) {
          results.push(result);
        }
      }
    } catch (error) {
      this.logger.error('Error processing repository', { error, ...context });
    }

    return results;
  }

  async processPullRequest(context: GitHubContext, pr: PullRequest): Promise<ActionResult | null> {
    // Skip PRs with excluded labels
    if (hasExcludedLabel(pr.labels, this.config)) {
      this.logger.debug('Skipping PR with excluded label', { prNumber: pr.number });
      return null;
    }

    const lastActivity = await this.github.getPullRequestActivity(context, pr.number);
    const effectiveActivityDate = lastActivity.getTime() > 0 ? lastActivity : pr.updatedAt;
    const daysSinceActivity = this.getDaysSince(effectiveActivityDate);

    this.logger.debug('PR activity check', {
      prNumber: pr.number,
      daysSinceActivity,
      warningDays: this.config.stalePrs.warningDays,
      closeDays: this.config.stalePrs.closeDays,
    });

    // Check if we already commented
    const comments = await this.github.listComments(context, pr.number);
    const hasWarningComment = comments.some((c) => c.body.includes(WARNING_COMMENT_MARKER));
    const hasClosingComment = comments.some((c) => c.body.includes(CLOSING_COMMENT_MARKER));

    // If PR is past close threshold and has warning, close it
    if (
      daysSinceActivity >= this.config.stalePrs.closeDays &&
      hasWarningComment &&
      !hasClosingComment
    ) {
      return this.closeStalePr(context, pr);
    }

    // If PR is past warning threshold but not close threshold, warn
    if (daysSinceActivity >= this.config.stalePrs.warningDays && !hasWarningComment) {
      return this.warnStalePr(context, pr, daysSinceActivity);
    }

    return null;
  }

  private async warnStalePr(
    context: GitHubContext,
    pr: PullRequest,
    daysSinceActivity: number
  ): Promise<ActionResult> {
    this.logger.info('Posting stale warning', { prNumber: pr.number, daysSinceActivity });

    const daysUntilClose = this.config.stalePrs.closeDays - daysSinceActivity;
    const comment = this.createWarningComment(pr.author, daysUntilClose);

    try {
      await this.github.createComment(context, pr.number, comment);
      return {
        success: true,
        action: 'stale_warning',
        details: {
          prNumber: pr.number,
          prTitle: pr.title,
          author: pr.author,
          daysSinceActivity,
          daysUntilClose,
        },
      };
    } catch (error) {
      return {
        success: false,
        action: 'stale_warning',
        details: { prNumber: pr.number },
        error: String(error),
      };
    }
  }

  private async closeStalePr(context: GitHubContext, pr: PullRequest): Promise<ActionResult> {
    this.logger.info('Closing stale PR', { prNumber: pr.number });

    try {
      // Post closing comment first
      const comment = this.createClosingComment(pr.author);
      await this.github.createComment(context, pr.number, comment);

      // Then close the PR
      await this.github.closePullRequest(context, pr.number);

      return {
        success: true,
        action: 'stale_close',
        details: {
          prNumber: pr.number,
          prTitle: pr.title,
          author: pr.author,
        },
      };
    } catch (error) {
      return {
        success: false,
        action: 'stale_close',
        details: { prNumber: pr.number },
        error: String(error),
      };
    }
  }

  private createWarningComment(author: string, daysUntilClose: number): string {
    // Ensure daysUntilClose is never negative
    const safeDaysUntilClose = Math.max(1, daysUntilClose);
    return `${WARNING_COMMENT_MARKER}
${createBotSignature()}

---

Ciao @${author}! I'm your friendly neighborhood bot.

This PR has been inactive for ${this.config.stalePrs.warningDays} days. If there's no activity within the next ${safeDaysUntilClose} days, I'll close it automatically to keep our repository tidy.

If you're still working on this, just leave a comment or push a commit to reset the timer!

Grazie mille!`;
  }

  private createClosingComment(author: string): string {
    return `${CLOSING_COMMENT_MARKER}
${createBotSignature()}

---

Ciao @${author}! I'm back.

This PR has been inactive for ${this.config.stalePrs.closeDays} days, so I'm closing it now to keep things tidy.

Don't worry though - you can always reopen this PR if you want to continue working on it. Just leave a comment and we'll pick up where we left off!

Arrivederci!`;
  }

  private getDaysSince(date: Date): number {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
}

export async function handleStalePrs(
  github: GitHubService,
  logger: ILogger,
  config: BotConfig,
  contexts: GitHubContext[]
): Promise<ActionResult[]> {
  const handler = new StalePrsHandler(github, logger, config);
  const allResults: ActionResult[] = [];

  for (const context of contexts) {
    const results = await handler.processRepository(context);
    allResults.push(...results);
  }

  logger.info('Stale PR processing complete', {
    totalActions: allResults.length,
    successful: allResults.filter((r) => r.success).length,
    failed: allResults.filter((r) => !r.success).length,
  });

  return allResults;
}
