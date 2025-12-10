import { Octokit } from '@octokit/rest';
import { ILogger, PullRequest, Branch, GitHubContext } from '../types';

export class GitHubService {
  private octokit: Octokit;
  private logger: ILogger;

  constructor(token: string, logger: ILogger) {
    this.octokit = new Octokit({ auth: token });
    this.logger = logger;
  }

  async listOpenPullRequests(context: GitHubContext): Promise<PullRequest[]> {
    this.logger.debug('Fetching open pull requests', { owner: context.owner, repo: context.repo });

    const { data } = await this.octokit.pulls.list({
      owner: context.owner,
      repo: context.repo,
      state: 'open',
      per_page: 100,
    });

    return data.map((pr) => ({
      number: pr.number,
      title: pr.title,
      author: pr.user?.login || 'unknown',
      createdAt: new Date(pr.created_at),
      updatedAt: new Date(pr.updated_at),
      lastActivityAt: new Date(pr.updated_at),
      labels: pr.labels.map((l) => (typeof l === 'string' ? l : l.name || '')),
      headRef: pr.head.ref,
      headSha: pr.head.sha,
      baseBranch: pr.base.ref,
      url: pr.html_url,
    }));
  }

  async getPullRequestActivity(context: GitHubContext, prNumber: number): Promise<Date> {
    this.logger.debug('Fetching PR activity', { ...context, prNumber });

    const [commentsResponse, reviewsResponse, commitsResponse] = await Promise.all([
      this.octokit.issues.listComments({
        owner: context.owner,
        repo: context.repo,
        issue_number: prNumber,
        per_page: 1,
        sort: 'updated',
        direction: 'desc',
      }),
      this.octokit.pulls.listReviews({
        owner: context.owner,
        repo: context.repo,
        pull_number: prNumber,
        per_page: 100,
      }),
      this.octokit.pulls.listCommits({
        owner: context.owner,
        repo: context.repo,
        pull_number: prNumber,
        per_page: 1,
      }),
    ]);

    const dates: Date[] = [];

    if (commentsResponse.data.length > 0 && commentsResponse.data[0].updated_at) {
      dates.push(new Date(commentsResponse.data[0].updated_at));
    }

    if (reviewsResponse.data.length > 0) {
      const latestReview = reviewsResponse.data.reduce((latest, review) => {
        const reviewDate = new Date(review.submitted_at || 0);
        return reviewDate > latest ? reviewDate : latest;
      }, new Date(0));
      if (latestReview.getTime() > 0) {
        dates.push(latestReview);
      }
    }

    if (commitsResponse.data.length > 0) {
      const commitDate = commitsResponse.data[0].commit.committer?.date;
      if (commitDate) {
        dates.push(new Date(commitDate));
      }
    }

    if (dates.length === 0) {
      return new Date(0);
    }

    return dates.reduce((latest, date) => (date > latest ? date : latest), new Date(0));
  }

  async createComment(context: GitHubContext, issueNumber: number, body: string): Promise<void> {
    this.logger.info('Creating comment', { ...context, issueNumber });

    await this.octokit.issues.createComment({
      owner: context.owner,
      repo: context.repo,
      issue_number: issueNumber,
      body,
    });
  }

  async closePullRequest(context: GitHubContext, prNumber: number): Promise<void> {
    this.logger.info('Closing pull request', { ...context, prNumber });

    await this.octokit.pulls.update({
      owner: context.owner,
      repo: context.repo,
      pull_number: prNumber,
      state: 'closed',
    });
  }

  async listBranches(context: GitHubContext): Promise<Branch[]> {
    this.logger.debug('Fetching branches', context);

    const { data } = await this.octokit.repos.listBranches({
      owner: context.owner,
      repo: context.repo,
      per_page: 100,
    });

    return data.map((branch) => ({
      name: branch.name,
      sha: branch.commit.sha,
      protected: branch.protected,
    }));
  }

  async getDefaultBranch(context: GitHubContext): Promise<string> {
    const { data } = await this.octokit.repos.get({
      owner: context.owner,
      repo: context.repo,
    });

    return data.default_branch;
  }

  async isBranchMerged(
    context: GitHubContext,
    branchName: string,
    baseBranch: string
  ): Promise<boolean> {
    this.logger.debug('Checking if branch is merged', { ...context, branchName, baseBranch });

    try {
      const { data } = await this.octokit.repos.compareCommits({
        owner: context.owner,
        repo: context.repo,
        base: baseBranch,
        head: branchName,
      });

      // If ahead_by is 0, all commits from the branch are in the base
      return data.ahead_by === 0;
    } catch (error) {
      this.logger.error('Error checking branch merge status', { error, ...context, branchName });
      return false;
    }
  }

  async getBranchCommits(
    context: GitHubContext,
    branchName: string,
    limit: number = 10
  ): Promise<Array<{ sha: string; author: string; date: Date }>> {
    this.logger.debug('Fetching branch commits', { ...context, branchName, limit });

    try {
      const { data } = await this.octokit.repos.listCommits({
        owner: context.owner,
        repo: context.repo,
        sha: branchName,
        per_page: limit,
      });

      return data.map((commit) => ({
        sha: commit.sha,
        author: commit.author?.login || commit.commit.author?.name || 'unknown',
        date: new Date(commit.commit.committer?.date || commit.commit.author?.date || 0),
      }));
    } catch (error) {
      this.logger.error('Error fetching branch commits', { error, ...context, branchName });
      return [];
    }
  }

  async deleteBranch(context: GitHubContext, branchName: string): Promise<void> {
    this.logger.info('Deleting branch', { ...context, branchName });

    await this.octokit.git.deleteRef({
      owner: context.owner,
      repo: context.repo,
      ref: `heads/${branchName}`,
    });
  }

  async branchExists(context: GitHubContext, branchName: string): Promise<boolean> {
    try {
      await this.octokit.repos.getBranch({
        owner: context.owner,
        repo: context.repo,
        branch: branchName,
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  async getBranchSha(context: GitHubContext, branchName: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.repos.getBranch({
        owner: context.owner,
        repo: context.repo,
        branch: branchName,
      });
      return data.commit.sha;
    } catch (error) {
      return null;
    }
  }

  async findPullRequestForBranch(
    context: GitHubContext,
    branchName: string
  ): Promise<number | null> {
    this.logger.debug('Finding PR for branch', { ...context, branchName });

    const { data } = await this.octokit.pulls.list({
      owner: context.owner,
      repo: context.repo,
      state: 'all',
      head: `${context.owner}:${branchName}`,
      per_page: 1,
    });

    if (data.length > 0) {
      return data[0].number;
    }

    return null;
  }

  async listComments(
    context: GitHubContext,
    issueNumber: number
  ): Promise<Array<{ id: number; body: string; user: string }>> {
    const { data } = await this.octokit.issues.listComments({
      owner: context.owner,
      repo: context.repo,
      issue_number: issueNumber,
      per_page: 100,
    });

    return data.map((comment) => ({
      id: comment.id,
      body: comment.body || '',
      user: comment.user?.login || 'unknown',
    }));
  }

  async listOrgRepos(org: string): Promise<Array<{ owner: string; name: string }>> {
    this.logger.debug('Fetching organization repositories', { org });

    const { data } = await this.octokit.repos.listForOrg({
      org,
      per_page: 100,
      type: 'all',
    });

    return data.map((repo) => ({
      owner: repo.owner.login,
      name: repo.name,
    }));
  }

  async getFileContent(context: GitHubContext, path: string): Promise<string | null> {
    this.logger.debug('Fetching file content', { ...context, path });

    try {
      const { data } = await this.octokit.repos.getContent({
        owner: context.owner,
        repo: context.repo,
        path,
      });

      if ('content' in data && data.content) {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }
      return null;
    } catch (error) {
      this.logger.debug('File not found', { ...context, path });
      return null;
    }
  }
}
