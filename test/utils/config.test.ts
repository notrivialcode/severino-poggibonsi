import {
  loadConfig,
  loadRemoteConfig,
  loadUserMapping,
  isProtectedBranch,
  isExcludedBranch,
  hasExcludedLabel,
} from '@/src/utils/config';
import { BotConfig } from '@/src/types';
import * as fs from 'fs';

jest.mock('fs');

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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadConfig', () => {
    it('should return default config when no file exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const config = loadConfig('/nonexistent/path.json');

      expect(config.bot.name).toBe('Severino Poggibonsi');
      expect(config.bot.organization).toBe('NOTRIVIAL');
      expect(config.stalePrs.warningDays).toBe(7);
      expect(config.stalePrs.closeDays).toBe(14);
    });

    it('should load config from custom path when it exists', () => {
      const customConfig = {
        bot: { name: 'Custom Bot', organization: 'Custom Org' },
        stalePrs: { warningDays: 10, closeDays: 20, excludeLabels: ['custom'] },
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(customConfig));

      const config = loadConfig('/custom/config.json');

      expect(config.bot.name).toBe('Custom Bot');
      expect(config.bot.organization).toBe('Custom Org');
      expect(config.stalePrs.warningDays).toBe(10);
      expect(config.stalePrs.closeDays).toBe(20);
    });

    it('should handle JSON parse error in custom config', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid json {]');

      const config = loadConfig('/custom/config.json');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to load config from /custom/config.json, using defaults'
      );
      expect(config.bot.name).toBe('Severino Poggibonsi');

      consoleWarnSpy.mockRestore();
    });

    it('should load config from default path when custom path does not exist', () => {
      const defaultConfig = {
        bot: { name: 'Default Bot', organization: 'Default Org' },
      };

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('config/default.json');
      });
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(defaultConfig));

      const config = loadConfig();

      expect(config.bot.name).toBe('Default Bot');
      expect(config.bot.organization).toBe('Default Org');
    });

    it('should handle JSON parse error in default config', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('config/default.json');
      });
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid json');

      const config = loadConfig();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to load default config, using built-in defaults'
      );
      expect(config.bot.name).toBe('Severino Poggibonsi');

      consoleWarnSpy.mockRestore();
    });
  });

  describe('loadRemoteConfig', () => {
    it('should load config from severino.config.json when found', async () => {
      const remoteConfig = {
        bot: { name: 'Remote Bot' },
        stalePrs: { warningDays: 15 },
      };

      const getFileContent = jest.fn().mockResolvedValueOnce(JSON.stringify(remoteConfig));

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const config = await loadRemoteConfig(getFileContent);

      expect(getFileContent).toHaveBeenCalledWith('severino.config.json');
      expect(consoleLogSpy).toHaveBeenCalledWith('Loaded remote config from target repository');
      expect(config.bot.name).toBe('Remote Bot');
      expect(config.stalePrs.warningDays).toBe(15);

      consoleLogSpy.mockRestore();
    });

    it('should fallback to .severino.json when severino.config.json not found', async () => {
      const remoteConfig = {
        bot: { name: 'Fallback Bot' },
      };

      const getFileContent = jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(JSON.stringify(remoteConfig));

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const config = await loadRemoteConfig(getFileContent);

      expect(getFileContent).toHaveBeenCalledWith('severino.config.json');
      expect(getFileContent).toHaveBeenCalledWith('.severino.json');
      expect(consoleLogSpy).toHaveBeenCalledWith('Loaded remote config from target repository');
      expect(config.bot.name).toBe('Fallback Bot');

      consoleLogSpy.mockRestore();
    });

    it('should use local config when no remote config found', async () => {
      const localConfig: BotConfig = {
        bot: { name: 'Local Bot', organization: 'Local Org' },
        stalePrs: { warningDays: 5, closeDays: 10, excludeLabels: [] },
        branches: { protectedPatterns: ['main'], excludePatterns: [] },
        slack: { webhookUrl: '', botToken: '' },
        userMapping: {},
      };

      const getFileContent = jest.fn().mockResolvedValue(null);
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const config = await loadRemoteConfig(getFileContent, localConfig);

      expect(getFileContent).toHaveBeenCalledWith('severino.config.json');
      expect(getFileContent).toHaveBeenCalledWith('.severino.json');
      expect(consoleLogSpy).toHaveBeenCalledWith('No remote config found, using local config');
      expect(config.bot.name).toBe('Local Bot');

      consoleLogSpy.mockRestore();
    });

    it('should use default config when no remote config and no local config provided', async () => {
      const getFileContent = jest.fn().mockResolvedValue(null);
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const config = await loadRemoteConfig(getFileContent);

      expect(consoleLogSpy).toHaveBeenCalledWith('No remote config found, using local config');
      expect(config.bot.name).toBe('Severino Poggibonsi');

      consoleLogSpy.mockRestore();
    });

    it('should handle JSON parse error in remote config', async () => {
      const getFileContent = jest.fn().mockResolvedValueOnce('invalid json {]');

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const config = await loadRemoteConfig(getFileContent);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to parse remote config, using local config'
      );
      expect(config.bot.name).toBe('Severino Poggibonsi');

      consoleWarnSpy.mockRestore();
    });
  });

  describe('loadUserMapping', () => {
    it('should load user mapping from file when it exists', () => {
      const userMapping = {
        'github-user1': 'U123456',
        'github-user2': 'U789012',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(userMapping));

      const result = loadUserMapping('/custom/user-mapping.json');

      expect(result).toEqual(userMapping);
      expect(fs.readFileSync).toHaveBeenCalledWith('/custom/user-mapping.json', 'utf-8');
    });

    it('should return empty object when file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = loadUserMapping('/nonexistent/user-mapping.json');

      expect(result).toEqual({});
    });

    it('should handle JSON parse error and return empty object', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid json');

      const result = loadUserMapping('/custom/user-mapping.json');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to load user mapping from /custom/user-mapping.json'
      );
      expect(result).toEqual({});

      consoleWarnSpy.mockRestore();
    });

    it('should use default path when no path provided', () => {
      const userMapping = {
        'default-user': 'U111111',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(userMapping));

      const result = loadUserMapping();

      expect(result).toEqual(userMapping);
      expect(fs.existsSync).toHaveBeenCalledWith(
        expect.stringContaining('config/user-mapping.json')
      );
    });
  });

  describe('mergeConfig - protectedBranches backward compatibility', () => {
    it('should use protectedPatterns when provided', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          branches: {
            protectedPatterns: ['main', 'staging'],
          },
        })
      );

      const config = loadConfig('/test/config.json');

      expect(config.branches.protectedPatterns).toEqual(['main', 'staging']);
    });

    it('should use protectedBranches for backward compatibility', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          branches: {
            protectedBranches: ['main', 'production'],
          },
        })
      );

      const config = loadConfig('/test/config.json');

      expect(config.branches.protectedPatterns).toEqual(['main', 'production']);
    });

    it('should prefer protectedPatterns over protectedBranches', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          branches: {
            protectedPatterns: ['main', 'staging'],
            protectedBranches: ['main', 'production'],
          },
        })
      );

      const config = loadConfig('/test/config.json');

      expect(config.branches.protectedPatterns).toEqual(['main', 'staging']);
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
    it('should identify exact match excluded branches', () => {
      const configWithExactMatch: BotConfig = {
        ...mockConfig,
        branches: {
          ...mockConfig.branches,
          excludePatterns: ['dependabot/*', 'renovate-bot'],
        },
      };

      expect(isExcludedBranch('renovate-bot', configWithExactMatch)).toBe(true);
    });

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
