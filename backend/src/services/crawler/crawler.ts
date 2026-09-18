import pLimit from 'p-limit';
import logger from '../../config/logger.js';
import { fetchPage } from './fetcher.js';
import { parseHtml } from './parser.js';
import { RobotsCache } from './robots.js';
import { getHost, normalizeUrl, sameSite } from './urlUtils.js';
import type { CrawlOptions, CrawlReport, CrawlResult } from './types.js';

export const DEFAULT_USER_AGENT =
  'AiSearchEngineBot/1.0 (+https://example.com/bot; simple crawler)';

/** Sensible defaults; callers override any subset. */
export const defaultOptions = (): Omit<CrawlOptions, 'startUrls'> => ({
  maxDepth: 1,
  maxPages: 20,
  sameDomainOnly: true,
  concurrency: 5,
  delayMs: 200,
  respectRobots: true,
  userAgent: DEFAULT_USER_AGENT,
  timeoutMs: 15_000,
  maxRetries: 2,
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface QueueItem {
  url: string;
  depth: number;
}

class Crawler {
  private readonly visited = new Set<string>();
  private readonly results: CrawlResult[] = [];
  private readonly seedHosts = new Set<string>();
  private readonly allowedHosts: Set<string>;
  private readonly robots: RobotsCache;
  /** Per-host "next allowed start time" for politeness spacing. */
  private readonly hostNextAllowed = new Map<string, number>();

  constructor(private readonly opts: CrawlOptions) {
    this.robots = new RobotsCache(opts.userAgent, opts.timeoutMs);
    this.allowedHosts = new Set((opts.allowedDomains ?? []).map((d) => d.toLowerCase()));
  }

  /** Is a candidate URL within the configured crawl scope? */
  private inScope(host: string): boolean {
    if (!this.opts.sameDomainOnly) return true;
    if (this.allowedHosts.has(host)) return true;
    for (const seed of this.seedHosts) {
      if (sameSite(seed, host)) return true;
    }
    return false;
  }

  /** Add a URL to the frontier if new, in-scope, and under the page budget. */
  private tryEnqueue(rawUrl: string, depth: number, frontier: QueueItem[]): void {
    if (this.visited.size >= this.opts.maxPages) return;
    const norm = normalizeUrl(rawUrl);
    if (!norm || this.visited.has(norm)) return;
    const host = getHost(norm);
    if (!host || !this.inScope(host)) return;
    this.visited.add(norm);
    frontier.push({ url: norm, depth });
  }

  /** Space out requests to the same host per politeness / crawl-delay. */
  private async throttleHost(host: string, delayMs: number): Promise<void> {
    if (delayMs <= 0) return;
    const now = Date.now();
    const nextAllowed = this.hostNextAllowed.get(host) ?? 0;
    const wait = Math.max(0, nextAllowed - now);
    // Reserve this slot so concurrent tasks for the host stay spaced out.
    this.hostNextAllowed.set(host, Math.max(now, nextAllowed) + delayMs);
    if (wait > 0) await sleep(wait);
  }

  private async visit(item: QueueItem): Promise<CrawlResult> {
    const { url, depth } = item;
    const base: CrawlResult = {
      url,
      finalUrl: url,
      depth,
      ok: false,
      status: null,
      contentType: null,
      fetchedAt: new Date().toISOString(),
      elapsedMs: 0,
      data: null,
      error: null,
    };

    if (this.opts.respectRobots && !(await this.robots.isAllowed(url))) {
      return { ...base, error: 'Blocked by robots.txt' };
    }

    const host = getHost(url) ?? '';
    const crawlDelay = this.opts.respectRobots ? await this.robots.getCrawlDelayMs(url) : 0;
    await this.throttleHost(host, Math.max(this.opts.delayMs, crawlDelay));

    const outcome = await fetchPage(url, {
      userAgent: this.opts.userAgent,
      timeoutMs: this.opts.timeoutMs,
      maxRetries: this.opts.maxRetries,
    });

    const result: CrawlResult = {
      ...base,
      finalUrl: outcome.finalUrl,
      ok: outcome.ok,
      status: outcome.status,
      contentType: outcome.contentType,
      elapsedMs: outcome.elapsedMs,
      error: outcome.error,
    };

    if (outcome.ok && outcome.body) {
      try {
        result.data = parseHtml(outcome.body, outcome.finalUrl);
      } catch (err) {
        result.ok = false;
        result.error = `Parse error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    return result;
  }

  async run(): Promise<CrawlReport> {
    const startedAt = new Date().toISOString();
    const startClock = Date.now();

    // Seed hosts define the same-domain scope.
    for (const seed of this.opts.startUrls) {
      const host = getHost(seed);
      if (host) this.seedHosts.add(host);
    }

    let frontier: QueueItem[] = [];
    for (const seed of this.opts.startUrls) {
      this.tryEnqueue(seed, 0, frontier);
    }

    const limit = pLimit(Math.max(1, this.opts.concurrency));

    while (frontier.length > 0) {
      const current = frontier;
      const nextFrontier: QueueItem[] = [];

      await Promise.all(
        current.map((item) =>
          limit(async () => {
            const result = await this.visit(item);
            this.results.push(result);
            logger.info(
              `[crawl d${item.depth}] ${result.ok ? result.status : 'ERR'} ${item.url}` +
                (result.error ? ` — ${result.error}` : '')
            );
            if (item.depth < this.opts.maxDepth && result.data) {
              for (const link of result.data.links) {
                this.tryEnqueue(link, item.depth + 1, nextFrontier);
              }
            }
          })
        )
      );

      frontier = nextFrontier;
    }

    const pagesFailed = this.results.filter((r) => !r.ok).length;
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startClock,
      options: this.opts,
      pagesCrawled: this.results.length,
      pagesFailed,
      results: this.results,
    };
  }
}

/**
 * Crawl one or more seed URLs and return an aggregated report.
 * Pass any subset of options; the rest fall back to {@link defaultOptions}.
 */
export const crawl = async (
  startUrls: string[],
  overrides: Partial<Omit<CrawlOptions, 'startUrls'>> = {}
): Promise<CrawlReport> => {
  const options: CrawlOptions = { ...defaultOptions(), ...overrides, startUrls };
  logger.info(
    `Starting crawl: ${startUrls.length} seed(s), depth=${options.maxDepth}, ` +
      `maxPages=${options.maxPages}, concurrency=${options.concurrency}`
  );
  return new Crawler(options).run();
};
