import { Queue, type JobsOptions } from 'bullmq';
import env from '../config/env.js';
import { createRedisConnection } from '../config/redis.js';
import type { IngestOptions, IngestReport } from '../services/ingest.service.js';

export const CRAWL_QUEUE = 'crawl';

/** Payload for a crawl job. */
export interface CrawlJobData {
  urls: string[];
  options: IngestOptions;
}

/** Coarse progress reported by the worker as a job moves through phases. */
export interface CrawlProgress {
  phase: 'queued' | 'crawling' | 'storing' | 'embedding' | 'done';
  pagesCrawled?: number;
  stored?: number;
  embedded?: number;
}

let queue: Queue<CrawlJobData, IngestReport> | null = null;

/** Lazily create the crawl queue (shared connection). */
export const getCrawlQueue = (): Queue<CrawlJobData, IngestReport> => {
  if (queue) return queue;
  queue = new Queue<CrawlJobData, IngestReport>(CRAWL_QUEUE, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: env.queue.attempts,
      backoff: { type: 'exponential', delay: 2000 },
      // Keep recent jobs around for status polling, then auto-clean.
      removeOnComplete: { age: 3600, count: 200 },
      removeOnFail: { age: 86_400 },
    },
  });
  return queue;
};

/** Enqueue a crawl and return its job id. */
export const enqueueCrawl = async (data: CrawlJobData, opts?: JobsOptions): Promise<string> => {
  const job = await getCrawlQueue().add('crawl', data, opts);
  return job.id!;
};

export interface CrawlJobStatus {
  id: string;
  state: string; // waiting | active | completed | failed | delayed | ...
  /** BullMQ job progress — we report a CrawlProgress object; typed loosely here. */
  progress: unknown;
  result: IngestReport | null;
  failedReason: string | null;
}

/** Look up a job's status/progress/result for the polling endpoint. */
export const getCrawlJobStatus = async (id: string): Promise<CrawlJobStatus | null> => {
  const job = await getCrawlQueue().getJob(id);
  if (!job) return null;
  const state = await job.getState();
  return {
    id,
    state,
    progress: job.progress ?? { phase: 'queued' },
    result: (job.returnvalue as IngestReport | undefined) ?? null,
    failedReason: job.failedReason ?? null,
  };
};

export const closeCrawlQueue = async (): Promise<void> => {
  if (queue) {
    await queue.close();
    queue = null;
  }
};
