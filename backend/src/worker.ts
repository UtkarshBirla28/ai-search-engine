/**
 * Standalone crawl worker process.
 *
 *   npm run worker        (dev, tsx watch)
 *   node dist/worker.js   (production)
 *
 * Run one or more of these separately from the API for horizontal scale. The API
 * enqueues jobs; workers consume them. Requires REDIS_URL. (For a single-process
 * setup, QUEUE_RUN_IN_PROCESS=true also runs a worker inside the API.)
 */
import env from './config/env.js';
import logger from './config/logger.js';
import { isQueueEnabled } from './config/env.js';
import { closeRedis } from './config/redis.js';
import { closePool } from './db/pool.js';
import { startCrawlWorker, stopCrawlWorker } from './queue/crawl.worker.js';

if (!isQueueEnabled()) {
  logger.error('Worker requires REDIS_URL and QUEUE_ENABLED. Exiting.');
  process.exit(1);
}

startCrawlWorker();
logger.info(`Crawl worker running (env=${env.nodeEnv}).`);

const shutdown = (signal: string): void => {
  logger.info(`${signal} received. Stopping worker…`);
  void (async () => {
    await stopCrawlWorker();
    await closePool();
    await closeRedis();
    process.exit(0);
  })();
};

(['SIGTERM', 'SIGINT'] as const).forEach((s) => process.on(s, () => shutdown(s)));
