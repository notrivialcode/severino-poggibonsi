import {
  loadConfig,
  isProtectedBranch,
  isExcludedBranch,
  hasExcludedLabel,
} from '../../src/utils/config';
import { BotConfig } from '../../src/types';

describe('Config', () => {
  const mockConfig: BotConfig = {
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
      webhookUrl: '',
      botToken: '',
    },
    userMapping: {},
  };

  describe('loadConfig', () => {
    it('should return default config when no file exists', () => {
      const config = loadConfig('/nonexistent/path.json');

      expect(config.bot.name).toBe('Severino Poggibonsi');
      expect(config.bot.organization).toBe('NOTRIVIAL');
      expect(config.stalePrs.warningDays).toBe(7);
      expect(config.stalePrs.closeDays).toBe(14);
    });
  });

  describe('isProtectedBranch', () => {
    it('should identify exact match protected branches', () => {
      expect(isProtectedBranch('main', mockConfig)).toBe(true);
      expect(isProtectedBranch('master', mockConfig)).toBe(true);
      expect(isProtectedBranch('develop', mockConfig)).toBe(true);
    });

    it('should identify wildcard protected branches', () => {
      expect(isProtectedBranch('release/1.0.0', mockConfig)).toBe(true);
      expect(isProtectedBranch('release/2.0.0-beta', mockConfig)).toBe(true);
    });

    it('should not match non-protected branches', () => {
      expect(isProtectedBranch('feature/new-feature', mockConfig)).toBe(false);
      expect(isProtectedBranch('fix/bug-fix', mockConfig)).toBe(false);
      expect(isProtectedBranch('releases/old', mockConfig)).toBe(false);
    });
  });

  describe('isExcludedBranch', () => {
    it('should identify excluded branches with wildcards', () => {
      expect(isExcludedBranch('dependabot/npm_and_yarn/lodash-4.17.21', mockConfig)).toBe(true);
      expect(isExcludedBranch('dependabot/bundler/rails-6.0', mockConfig)).toBe(true);
    });

    it('should not match non-excluded branches', () => {
      expect(isExcludedBranch('feature/new-feature', mockConfig)).toBe(false);
      expect(isExcludedBranch('dependabotish/branch', mockConfig)).toBe(false);
    });
  });

  describe('hasExcludedLabel', () => {
    it('should return true if PR has excluded label', () => {
      expect(hasExcludedLabel(['bug', 'pinned'], mockConfig)).toBe(true);
      expect(hasExcludedLabel(['security'], mockConfig)).toBe(true);
      expect(hasExcludedLabel(['enhancement', 'do-not-close'], mockConfig)).toBe(true);
    });

    it('should return false if PR has no excluded labels', () => {
      expect(hasExcludedLabel(['bug', 'enhancement'], mockConfig)).toBe(false);
      expect(hasExcludedLabel([], mockConfig)).toBe(false);
    });
  });
});
