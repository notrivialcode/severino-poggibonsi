import {
  wasDmSent,
  markDmSent,
  clearDmRecord,
  clearBranchDmRecords,
  DmRecord,
} from '@/src/services/redis';

// Mock the redis module
const mockGet = jest.fn();
const mockSetEx = jest.fn();
const mockDel = jest.fn();
const mockKeys = jest.fn();
const mockConnect = jest.fn();
const mockCreateClient = jest.fn();

jest.mock('redis', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

describe('Redis Service', () => {
  const mockRedisClient = {
    get: mockGet,
    setEx: mockSetEx,
    del: mockDel,
    keys: mockKeys,
    connect: mockConnect,
  };

  const testOwner = 'NOTRIVIAL';
  const testRepo = 'test-repo';
  const testBranch = 'feature/test-branch';
  const testContributor = 'github-user-1';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Default: Redis is configured and available
    process.env.REDIS_URL = 'redis://localhost:6379';
    mockCreateClient.mockReturnValue(mockRedisClient);
    mockConnect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  describe('wasDmSent', () => {
    it('should return true when a DM record exists', async () => {
      const mockRecord: DmRecord = {
        sentAt: '2025-01-01T00:00:00.000Z',
        contributor: testContributor,
        branch: testBranch,
        repo: `${testOwner}/${testRepo}`,
      };
      mockGet.mockResolvedValue(JSON.stringify(mockRecord));

      const result = await wasDmSent(testOwner, testRepo, testBranch, testContributor);

      expect(result).toBe(true);
      expect(mockGet).toHaveBeenCalledWith(
        `dm-sent:${testOwner}/${testRepo}/${testBranch}/${testContributor}`
      );
    });

    it('should return false when no DM record exists', async () => {
      mockGet.mockResolvedValue(null);

      const result = await wasDmSent(testOwner, testRepo, testBranch, testContributor);

      expect(result).toBe(false);
      expect(mockGet).toHaveBeenCalledWith(
        `dm-sent:${testOwner}/${testRepo}/${testBranch}/${testContributor}`
      );
    });

    it('should return false when Redis is not configured', async () => {
      delete process.env.REDIS_URL;

      const result = await wasDmSent(testOwner, testRepo, testBranch, testContributor);

      expect(result).toBe(false);
    });

    it('should return false and log warning when Redis throws an error', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      mockGet.mockRejectedValue(new Error('Redis connection failed'));

      const result = await wasDmSent(testOwner, testRepo, testBranch, testContributor);

      expect(result).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Redis not available, skipping deduplication check:',
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });

    it('should return false when Redis client connection fails', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      mockConnect.mockRejectedValue(new Error('Connection timeout'));

      const result = await wasDmSent(testOwner, testRepo, testBranch, testContributor);

      expect(result).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Redis not available, skipping deduplication check:',
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('markDmSent', () => {
    it('should successfully mark a DM as sent with correct TTL', async () => {
      mockSetEx.mockResolvedValue('OK');

      await markDmSent(testOwner, testRepo, testBranch, testContributor);

      expect(mockSetEx).toHaveBeenCalledTimes(1);
      const [key, ttl, value] = mockSetEx.mock.calls[0];

      expect(key).toBe(`dm-sent:${testOwner}/${testRepo}/${testBranch}/${testContributor}`);
      expect(ttl).toBe(7 * 24 * 60 * 60); // 7 days in seconds

      const record: DmRecord = JSON.parse(value);
      expect(record.contributor).toBe(testContributor);
      expect(record.branch).toBe(testBranch);
      expect(record.repo).toBe(`${testOwner}/${testRepo}`);
      expect(record.sentAt).toBeDefined();
      expect(new Date(record.sentAt)).toBeInstanceOf(Date);
    });

    it('should generate ISO timestamp when marking DM as sent', async () => {
      mockSetEx.mockResolvedValue('OK');
      const beforeTime = new Date().toISOString();

      await markDmSent(testOwner, testRepo, testBranch, testContributor);

      const afterTime = new Date().toISOString();
      const [, , value] = mockSetEx.mock.calls[0];
      const record: DmRecord = JSON.parse(value);

      expect(record.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(record.sentAt >= beforeTime).toBe(true);
      expect(record.sentAt <= afterTime).toBe(true);
    });

    it('should gracefully handle Redis errors without throwing', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      mockSetEx.mockRejectedValue(new Error('Redis write failed'));

      await expect(
        markDmSent(testOwner, testRepo, testBranch, testContributor)
      ).resolves.toBeUndefined();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Redis not available, skipping deduplication mark:',
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });

    it('should handle Redis not configured gracefully', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      delete process.env.REDIS_URL;

      await expect(
        markDmSent(testOwner, testRepo, testBranch, testContributor)
      ).resolves.toBeUndefined();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Redis not available, skipping deduplication mark:',
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('clearDmRecord', () => {
    it('should successfully delete a DM record', async () => {
      mockDel.mockResolvedValue(1); // 1 key deleted

      await clearDmRecord(testOwner, testRepo, testBranch, testContributor);

      expect(mockDel).toHaveBeenCalledWith(
        `dm-sent:${testOwner}/${testRepo}/${testBranch}/${testContributor}`
      );
    });

    it('should handle deletion when record does not exist', async () => {
      mockDel.mockResolvedValue(0); // 0 keys deleted

      await expect(
        clearDmRecord(testOwner, testRepo, testBranch, testContributor)
      ).resolves.toBeUndefined();

      expect(mockDel).toHaveBeenCalledWith(
        `dm-sent:${testOwner}/${testRepo}/${testBranch}/${testContributor}`
      );
    });

    it('should gracefully handle Redis errors without throwing', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      mockDel.mockRejectedValue(new Error('Redis delete failed'));

      await expect(
        clearDmRecord(testOwner, testRepo, testBranch, testContributor)
      ).resolves.toBeUndefined();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Redis not available, skipping deduplication clear:',
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });

    it('should handle Redis not configured gracefully', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      delete process.env.REDIS_URL;

      await expect(
        clearDmRecord(testOwner, testRepo, testBranch, testContributor)
      ).resolves.toBeUndefined();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Redis not available, skipping deduplication clear:',
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('clearBranchDmRecords', () => {
    it('should successfully delete all DM records for a branch when keys exist', async () => {
      const keysArray = [
        `dm-sent:${testOwner}/${testRepo}/${testBranch}/user1`,
        `dm-sent:${testOwner}/${testRepo}/${testBranch}/user2`,
        `dm-sent:${testOwner}/${testRepo}/${testBranch}/user3`,
      ];
      mockKeys.mockResolvedValue(keysArray);
      mockDel.mockResolvedValue(3); // 3 keys deleted

      await clearBranchDmRecords(testOwner, testRepo, testBranch);

      expect(mockKeys).toHaveBeenCalledWith(`dm-sent:${testOwner}/${testRepo}/${testBranch}/*`);
      expect(mockDel).toHaveBeenCalledWith(keysArray);
    });

    it('should handle case when no keys exist for the branch', async () => {
      mockKeys.mockResolvedValue([]);

      await clearBranchDmRecords(testOwner, testRepo, testBranch);

      expect(mockKeys).toHaveBeenCalledWith(`dm-sent:${testOwner}/${testRepo}/${testBranch}/*`);
      expect(mockDel).not.toHaveBeenCalled();
    });

    it('should delete single key when only one record exists', async () => {
      const singleKey = [`dm-sent:${testOwner}/${testRepo}/${testBranch}/user1`];
      mockKeys.mockResolvedValue(singleKey);
      mockDel.mockResolvedValue(1);

      await clearBranchDmRecords(testOwner, testRepo, testBranch);

      expect(mockKeys).toHaveBeenCalledWith(`dm-sent:${testOwner}/${testRepo}/${testBranch}/*`);
      expect(mockDel).toHaveBeenCalledWith(singleKey);
    });

    it('should gracefully handle Redis errors without throwing', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      mockKeys.mockRejectedValue(new Error('Redis keys command failed'));

      await expect(clearBranchDmRecords(testOwner, testRepo, testBranch)).resolves.toBeUndefined();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Redis not available, skipping branch DM records clear:',
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });

    it('should handle error during deletion after successful keys lookup', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const keysArray = [
        `dm-sent:${testOwner}/${testRepo}/${testBranch}/user1`,
        `dm-sent:${testOwner}/${testRepo}/${testBranch}/user2`,
      ];
      mockKeys.mockResolvedValue(keysArray);
      mockDel.mockRejectedValue(new Error('Redis delete failed'));

      await expect(clearBranchDmRecords(testOwner, testRepo, testBranch)).resolves.toBeUndefined();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Redis not available, skipping branch DM records clear:',
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });

    it('should handle Redis not configured gracefully', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      delete process.env.REDIS_URL;

      await expect(clearBranchDmRecords(testOwner, testRepo, testBranch)).resolves.toBeUndefined();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Redis not available, skipping branch DM records clear:',
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('DM key generation', () => {
    it('should generate correct key format with all parameters', async () => {
      mockGet.mockResolvedValue(null);

      await wasDmSent('org', 'repo-name', 'feature/my-branch', 'contributor-name');

      expect(mockGet).toHaveBeenCalledWith(
        'dm-sent:org/repo-name/feature/my-branch/contributor-name'
      );
    });

    it('should handle special characters in branch names', async () => {
      mockGet.mockResolvedValue(null);
      const branchWithSpecialChars = 'feature/fix-bug-#123';

      await wasDmSent(testOwner, testRepo, branchWithSpecialChars, testContributor);

      expect(mockGet).toHaveBeenCalledWith(
        `dm-sent:${testOwner}/${testRepo}/${branchWithSpecialChars}/${testContributor}`
      );
    });
  });
});
