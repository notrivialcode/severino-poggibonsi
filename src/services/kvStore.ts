import { createClient, RedisClientType } from 'redis';

const DM_SENT_PREFIX = 'dm-sent:';
const DM_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

let redisClient: RedisClientType | null = null;

async function getRedis(): Promise<RedisClientType> {
  if (!redisClient) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error('REDIS_URL not configured');
    }
    redisClient = createClient({ url });
    await redisClient.connect();
  }
  return redisClient;
}

export interface DmRecord {
  sentAt: string;
  contributor: string;
  branch: string;
  repo: string;
}

function getDmKey(owner: string, repo: string, branch: string, contributor: string): string {
  return `${DM_SENT_PREFIX}${owner}/${repo}/${branch}/${contributor}`;
}

/**
 * Check if a DM was already sent for this branch/contributor
 */
export async function wasDmSent(
  owner: string,
  repo: string,
  branch: string,
  contributor: string
): Promise<boolean> {
  try {
    const redis = await getRedis();
    const key = getDmKey(owner, repo, branch, contributor);
    const record = await redis.get(key);
    return record !== null;
  } catch (error) {
    // If Redis is not configured, allow sending (no deduplication)
    console.warn('Redis not available, skipping deduplication check:', error);
    return false;
  }
}

/**
 * Mark that a DM was sent for this branch/contributor
 */
export async function markDmSent(
  owner: string,
  repo: string,
  branch: string,
  contributor: string
): Promise<void> {
  try {
    const redis = await getRedis();
    const key = getDmKey(owner, repo, branch, contributor);
    const record: DmRecord = {
      sentAt: new Date().toISOString(),
      contributor,
      branch,
      repo: `${owner}/${repo}`,
    };
    await redis.setEx(key, DM_TTL_SECONDS, JSON.stringify(record));
  } catch (error) {
    console.warn('Redis not available, skipping deduplication mark:', error);
  }
}

/**
 * Clear DM record (e.g., after branch is deleted or user responds)
 */
export async function clearDmRecord(
  owner: string,
  repo: string,
  branch: string,
  contributor: string
): Promise<void> {
  try {
    const redis = await getRedis();
    const key = getDmKey(owner, repo, branch, contributor);
    await redis.del(key);
  } catch (error) {
    console.warn('Redis not available, skipping deduplication clear:', error);
  }
}

/**
 * Clear all DM records for a branch (e.g., after branch is deleted)
 */
export async function clearBranchDmRecords(
  owner: string,
  repo: string,
  branch: string
): Promise<void> {
  try {
    const redis = await getRedis();
    const pattern = `${DM_SENT_PREFIX}${owner}/${repo}/${branch}/*`;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(keys);
    }
  } catch (error) {
    console.warn('Redis not available, skipping branch DM records clear:', error);
  }
}
