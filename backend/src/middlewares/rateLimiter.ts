import rateLimit, { type Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { getRedis, isRedisConfigured } from '../config/redis.js';

/**
 * Global API rate limiter. Uses a Redis store when Redis is configured so limits
 * are shared across multiple API instances (horizontally scalable); otherwise
 * falls back to the default in-memory store (fine for a single instance).
 */
let store: Store | undefined;
if (isRedisConfigured()) {
  try {
    store = new RedisStore({
      // rate-limit-redis calls the client's raw command interface.
      sendCommand: (command: string, ...args: string[]) =>
        getRedis().call(command, ...args) as Promise<never>,
      prefix: 'rl:',
    });
    logger.info('Rate limiter using Redis store (distributed).');
  } catch (err) {
    logger.warn(`Failed to init Redis rate-limit store, using in-memory: ${(err as Error).message}`);
  }
}

const rateLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  store,
  message: {
    success: false,
    error: { message: 'Too many requests, please try again later.' },
  },
});

export default rateLimiter;
