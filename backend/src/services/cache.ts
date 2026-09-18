import { getRedis, isRedisConfigured } from '../config/redis.js';
import logger from '../config/logger.js';

/**
 * Thin JSON cache over Redis. Every operation is a no-op (or returns null) when
 * Redis isn't configured, so callers can wrap hot paths unconditionally and the
 * app still works without Redis. A single failing Redis call never breaks a
 * request — we log and fall through to the source of truth.
 */

const VERSION_KEY = 'idx:version';

export const cacheEnabled = (): boolean => isRedisConfigured();

/** Build a namespaced cache key from parts. */
export const cacheKey = (...parts: (string | number)[]): string => parts.join(':');

export const cacheGet = async <T>(key: string): Promise<T | null> => {
  if (!cacheEnabled()) return null;
  try {
    const raw = await getRedis().get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    logger.warn(`cache get failed for ${key}: ${(err as Error).message}`);
    return null;
  }
};

export const cacheSet = async (key: string, value: unknown, ttlSeconds: number): Promise<void> => {
  if (!cacheEnabled()) return;
  try {
    await getRedis().set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    logger.warn(`cache set failed for ${key}: ${(err as Error).message}`);
  }
};

/**
 * The current index version. Included in search/answer cache keys so a new crawl
 * transparently invalidates all stale results (no key scanning needed).
 */
export const getIndexVersion = async (): Promise<string> => {
  if (!cacheEnabled()) return '0';
  try {
    return (await getRedis().get(VERSION_KEY)) ?? '0';
  } catch {
    return '0';
  }
};

/** Bump the index version — call after a crawl changes the corpus. */
export const bumpIndexVersion = async (): Promise<void> => {
  if (!cacheEnabled()) return;
  try {
    await getRedis().incr(VERSION_KEY);
  } catch (err) {
    logger.warn(`cache version bump failed: ${(err as Error).message}`);
  }
};

/**
 * Cache-aside helper: return the cached value or compute, store, and return it.
 * On any cache error it still returns the computed value.
 */
export const cached = async <T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> => {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await compute();
  await cacheSet(key, value, ttlSeconds);
  return value;
};
