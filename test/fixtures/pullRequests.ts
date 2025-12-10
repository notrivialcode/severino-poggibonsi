export const openPullRequests = [
  {
    number: 1,
    title: 'Feature: Add login',
    user: { login: 'contributor1' },
    created_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(), // 20 days ago
    updated_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), // 15 days ago
    labels: [],
    head: { ref: 'feature/login', sha: 'abc123' },
    base: { ref: 'main' },
    html_url: 'https://github.com/NOTRIVIAL/test-repo/pull/1',
  },
  {
    number: 2,
    title: 'Fix: Bug in checkout',
    user: { login: 'contributor2' },
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
    updated_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
    labels: [],
    head: { ref: 'fix/checkout', sha: 'def456' },
    base: { ref: 'main' },
    html_url: 'https://github.com/NOTRIVIAL/test-repo/pull/2',
  },
  {
    number: 3,
    title: 'Security: Update dependencies',
    user: { login: 'dependabot' },
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
    updated_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
    labels: [{ name: 'security' }],
    head: { ref: 'dependabot/npm', sha: 'ghi789' },
    base: { ref: 'main' },
    html_url: 'https://github.com/NOTRIVIAL/test-repo/pull/3',
  },
];

export const stalePrWithWarning = {
  number: 4,
  title: 'Old Feature',
  user: { login: 'contributor3' },
  created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  updated_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
  labels: [],
  head: { ref: 'feature/old', sha: 'jkl012' },
  base: { ref: 'main' },
  html_url: 'https://github.com/NOTRIVIAL/test-repo/pull/4',
};

export const commentsWithWarning = [
  {
    id: 1,
    body: '<!-- severino-stale-warning -->\nCiao @contributor3! I\'m Severino...',
    user: { login: 'severino-bot' },
    updated_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export const emptyComments: never[] = [];
