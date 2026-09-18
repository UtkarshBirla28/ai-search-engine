import { Redis, type RedisOptions } from 'ioredis';
import env, { isRedisConfigured } from './env.js';
import logger from './logger.js';

export { isRedisConfigured };

let client: Redis | null = null;

/**
 * BullMQ requires `maxRetriesPerRequest: null`. We reuse the same options for the
 * app client so behaviour is consistent, and keep a lazy singleton so nothing
 * connects until a Redis-backed feature is actually used.
 */
const options: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  // Don't crash on startup if Redis is briefly unreachable — retry with backoff.
  retryStrategy: (times) => Math.min(times * 200, 2000),
};

/** Lazily create the shared Redis client. Throws if REDIS_URL isn't configured. */
export const getRedis = (): Redis => {
  if (client) return client;
  if (!env.redis.url) {
    throw new Error('REDIS_URL is not set. Configure Redis to use the queue/cache.');
  }
  client = new Redis(env.redis.url, options);
  client.on('error', (err) => logger.error('Redis client error', err));
  client.on('connect', () => logger.info('Redis connected.'));
  return client;
};

/** A fresh connection with the BullMQ-required options (workers need their own). */
export const createRedisConnection = (): Redis => {
  if (!env.redis.url) throw new Error('REDIS_URL is not set.');
  const conn = new Redis(env.redis.url, options);
  conn.on('error', (err) => logger.error('Redis (bull) connection error', err));
  return conn;
};

/** Liveness probe for the health endpoint. */
export const pingRedis = async (): Promise<boolean> => {
  if (!isRedisConfigured()) return false;
  try {
    return (await getRedis().ping()) === 'PONG';
  } catch {
    return false;
  }
};

/** Close the client during graceful shutdown. Safe if never opened. */
export const closeRedis = async (): Promise<void> => {
  if (!client) return;
  await client.quit().catch(() => undefined);
  client = null;
  logger.info('Redis client closed.');
};
