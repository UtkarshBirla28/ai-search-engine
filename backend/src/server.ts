import app from './app.js';
import env, { isQueueEnabled } from './config/env.js';
import logger from './config/logger.js';
import validateEnv from './config/validate.js';
import { closePool } from './db/pool.js';
import { closeRedis } from './config/redis.js';
import { startCrawlWorker, stopCrawlWorker } from './queue/crawl.worker.js';
import { closeCrawlQueue } from './queue/crawl.queue.js';

// Fail fast on misconfiguration before binding the port.
validateEnv();

// Optionally run the crawl worker inside the API process (single-container/dev).
// For horizontal scale, disable this and run `npm run worker` separately.
if (isQueueEnabled() && env.queue.runInProcess) {
  startCrawlWorker();
}

const server = app.listen(env.port, () => {
  logger.info(`🚀 Server running in ${env.nodeEnv} mode on port ${env.port}`);
  logger.info(`   API base: http://localhost:${env.port}${env.apiPrefix}`);
  logger.info(`   Queue: ${isQueueEnabled() ? 'on (async crawl)' : 'off (sync crawl)'}`);
});

// Graceful shutdown
const shutdown = (signal: string): void => {
  logger.info(`${signal} received. Shutting down gracefully...`);
  server.close(() => {
    logger.info('HTTP server closed.');
    // Drain the worker, queue, DB pool, and Redis, then exit.
    void (async () => {
      await stopCrawlWorker().catch(() => undefined);
      await closeCrawlQueue().catch(() => undefined);
      await closePool().catch(() => undefined);
      await closeRedis().catch(() => undefined);
      process.exit(0);
    })();
  });

  // Force-exit if connections don't drain in time.
  setTimeout(() => {
    logger.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000).unref();
};

(['SIGTERM', 'SIGINT'] as const).forEach((signal) =>
  process.on(signal, () => shutdown(signal))
);

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

export default server;
