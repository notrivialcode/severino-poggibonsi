export interface BotConfig {
  bot: {
    name: string;
    organization: string;
  };
  stalePrs: {
    warningDays: number;
    closeDays: number;
    excludeLabels: string[];
  };
  branches: {
    protectedPatterns: string[];
    excludePatterns: string[];
  };
  slack: {
    webhookUrl: string;
    botToken: string;
  };
}

export interface UserMapping {
  [githubUsername: string]: string; // Slack user ID
}

export interface PullRequest {
  number: number;
  title: string;
  author: string;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
  labels: string[];
  headRef: string;
  headSha: string;
  baseBranch: string;
  url: string;
}

export interface Branch {
  name: string;
  sha: string;
  protected: boolean;
}

export interface BranchAnalysis {
  branch: Branch;
  isMerged: boolean;
  hasAssociatedPr: boolean;
  associatedPrNumber?: number;
  contributors: string[];
  lastCommitDate: Date;
}

export interface PendingDeletion {
  id: string;
  repo: string;
  owner: string;
  branchName: string;
  contributors: string[];
  slackMessageTs?: string;
  requestedAt: Date;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
}

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: Date;
  meta?: Record<string, unknown>;
}

export interface ILogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface GitHubContext {
  owner: string;
  repo: string;
  [key: string]: unknown;
}

export interface SlackMessage {
  channel: string;
  text: string;
  blocks?: SlackBlock[];
}

export interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
  };
  accessory?: {
    type: string;
    text?: {
      type: string;
      text: string;
    };
    action_id?: string;
    value?: string;
  };
  elements?: SlackBlockElement[];
}

export interface SlackBlockElement {
  type: string;
  text?: {
    type: string;
    text: string;
  };
  action_id?: string;
  value?: string;
  style?: string;
}

export type ActionResult = {
  success: boolean;
  action: string;
  details: Record<string, unknown>;
  error?: string;
};
