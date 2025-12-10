export const branches = [
  {
    name: 'main',
    commit: { sha: 'main123' },
    protected: true,
  },
  {
    name: 'feature/merged-with-pr',
    commit: { sha: 'merged1' },
    protected: false,
  },
  {
    name: 'feature/merged-manually',
    commit: { sha: 'manual1' },
    protected: false,
  },
  {
    name: 'feature/not-merged',
    commit: { sha: 'notmerged1' },
    protected: false,
  },
  {
    name: 'develop',
    commit: { sha: 'dev123' },
    protected: false,
  },
];

export const repoInfo = {
  default_branch: 'main',
  owner: { login: 'NOTRIVIAL' },
  name: 'test-repo',
};

export const compareCommitsMerged = {
  ahead_by: 0,
  behind_by: 5,
  status: 'behind',
};

export const compareCommitsNotMerged = {
  ahead_by: 3,
  behind_by: 2,
  status: 'diverged',
};

export const branchCommits = [
  {
    sha: 'commit1',
    author: { login: 'contributor1' },
    commit: {
      author: { name: 'Contributor One', date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() },
      committer: { date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() },
    },
  },
  {
    sha: 'commit2',
    author: { login: 'contributor2' },
    commit: {
      author: { name: 'Contributor Two', date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() },
      committer: { date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() },
    },
  },
];

export const pullRequestsForBranch = [
  {
    number: 10,
    state: 'closed',
    merged: true,
    head: { ref: 'feature/merged-with-pr' },
  },
];

export const noPullRequestsForBranch: never[] = [];
