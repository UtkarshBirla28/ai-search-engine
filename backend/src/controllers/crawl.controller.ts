import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import { isQueueEnabled } from '../config/env.js';
import { crawlAndStore } from '../services/ingest.service.js';
import { enqueueCrawl, getCrawlJobStatus } from '../queue/crawl.queue.js';
import type { CrawlBody } from '../validators/crawl.validator.js';

/**
 * POST /crawl
 * Body is validated & coerced by the `validate` middleware.
 *
 * When the job queue is enabled (Redis configured), the crawl is enqueued and we
 * return `202 Accepted` with a `jobId` immediately — poll `GET /crawl/:jobId` for
 * progress. Otherwise the crawl runs synchronously and returns the full report.
 */
export const crawlUrls = asyncHandler(async (req, res) => {
  const { urls, ...options } = req.body as CrawlBody;

  if (isQueueEnabled()) {
    const jobId = await enqueueCrawl({ urls, options });
    res.status(202).json({
      success: true,
      data: { jobId, status: 'queued', statusUrl: `${req.baseUrl}/${jobId}` },
    });
    return;
  }

  // Synchronous fallback (no Redis): run inline and return the report.
  const report = await crawlAndStore(urls, options);
  res.status(200).json({ success: true, data: report });
});

/**
 * GET /crawl/:jobId — poll an async crawl job's status/progress/result.
 */
export const crawlStatus = asyncHandler(async (req, res) => {
  if (!isQueueEnabled()) {
    throw new ApiError(404, 'Job queue is disabled; crawls run synchronously.');
  }
  const status = await getCrawlJobStatus(req.params.jobId);
  if (!status) throw ApiError.notFound(`No crawl job with id "${req.params.jobId}"`);

  res.status(200).json({ success: true, data: status });
});

export default { crawlUrls, crawlStatus };
