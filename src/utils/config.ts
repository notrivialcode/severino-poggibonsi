import * as fs from 'fs';
import * as path from 'path';
import { BotConfig, UserMapping } from '../types';

const DEFAULT_CONFIG: BotConfig = {
  bot: {
    name: 'Severino Poggibonsi',
    organization: 'NOTRIVIAL',
  },
  stalePrs: {
    warningDays: 7,
    closeDays: 14,
    excludeLabels: ['pinned', 'security', 'do-not-close'],
  },
  branches: {
    protectedPatterns: ['main', 'master', 'develop', 'release/*'],
    excludePatterns: ['dependabot/*'],
  },
  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
    botToken: process.env.SLACK_BOT_TOKEN || '',
  },
};

export function loadConfig(configPath?: string): BotConfig {
  if (configPath && fs.existsSync(configPath)) {
    try {
      const fileContent = fs.readFileSync(configPath, 'utf-8');
      const fileConfig = JSON.parse(fileContent);
      return mergeConfig(DEFAULT_CONFIG, fileConfig);
    } catch (error) {
      console.warn(`Failed to load config from ${configPath}, using defaults`);
    }
  }

  // Try default config path
  const defaultPath = path.join(process.cwd(), 'config', 'default.json');
  if (fs.existsSync(defaultPath)) {
    try {
      const fileContent = fs.readFileSync(defaultPath, 'utf-8');
      const fileConfig = JSON.parse(fileContent);
      return mergeConfig(DEFAULT_CONFIG, fileConfig);
    } catch (error) {
      console.warn('Failed to load default config, using built-in defaults');
    }
  }

  return DEFAULT_CONFIG;
}

export function loadUserMapping(mappingPath?: string): UserMapping {
  const pathToUse = mappingPath || path.join(process.cwd(), 'config', 'user-mapping.json');

  if (fs.existsSync(pathToUse)) {
    try {
      const fileContent = fs.readFileSync(pathToUse, 'utf-8');
      return JSON.parse(fileContent);
    } catch (error) {
      console.warn(`Failed to load user mapping from ${pathToUse}`);
    }
  }

  return {};
}

function mergeConfig(defaults: BotConfig, overrides: Partial<BotConfig>): BotConfig {
  return {
    bot: { ...defaults.bot, ...overrides.bot },
    stalePrs: { ...defaults.stalePrs, ...overrides.stalePrs },
    branches: { ...defaults.branches, ...overrides.branches },
    slack: {
      ...defaults.slack,
      ...overrides.slack,
      webhookUrl: overrides.slack?.webhookUrl || process.env.SLACK_WEBHOOK_URL || defaults.slack.webhookUrl,
      botToken: overrides.slack?.botToken || process.env.SLACK_BOT_TOKEN || defaults.slack.botToken,
    },
  };
}

export function isProtectedBranch(branchName: string, config: BotConfig): boolean {
  return config.branches.protectedPatterns.some((pattern) => {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(branchName);
    }
    return branchName === pattern;
  });
}

export function isExcludedBranch(branchName: string, config: BotConfig): boolean {
  return config.branches.excludePatterns.some((pattern) => {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(branchName);
    }
    return branchName === pattern;
  });
}

export function hasExcludedLabel(labels: string[], config: BotConfig): boolean {
  return labels.some((label) => config.stalePrs.excludeLabels.includes(label));
}
