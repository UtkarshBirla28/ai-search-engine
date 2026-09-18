import { Worker, type Job } from 'bullmq';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { createRedisConnection } from '../config/redis.js';
import { crawlAndStore, type IngestReport } from '../services/ingest.service.js';
import { CRAWL_QUEUE, type CrawlJobData } from './crawl.queue.js';

let worker: Worker<CrawlJobData, IngestReport> | null = null;

/**
 * Start the crawl worker. Processes jobs from the queue with BullMQ's built-in
 * retry/backoff (see queue defaults), reporting coarse progress so the UI can
 * show a live status. Idempotent — calling twice returns the existing worker.
 */
export const startCrawlWorker = (): Worker<CrawlJobData, IngestReport> => {
  if (worker) return worker;

  worker = new Worker<CrawlJobData, IngestReport>(
    CRAWL_QUEUE,
    async (job: Job<CrawlJobData, IngestReport>) => {
      logger.info(`[worker] crawl job ${job.id} started: ${job.data.urls.join(', ')}`);
      return crawlAndStore(job.data.urls, job.data.options, (p) => job.updateProgress(p));
    },
    { connection: createRedisConnection(), concurrency: env.queue.concurrency }
  );

  worker.on('completed', (job, result) =>
    logger.info(`[worker] crawl job ${job.id} done: crawled ${result.pagesCrawled}, embedded ${result.storage.embedded}`)
  );
  worker.on('failed', (job, err) => logger.error(`[worker] crawl job ${job?.id} failed: ${err.message}`));

  logger.info(`Crawl worker started (concurrency=${env.queue.concurrency}).`);
  return worker;
};

export const stopCrawlWorker = async (): Promise<void> => {
  if (worker) {
    await worker.close();
    worker = null;
  }
};
