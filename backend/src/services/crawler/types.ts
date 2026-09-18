/**
 * Shared types for the crawler module.
 */

export interface CrawlOptions {
  /** Seed URLs to start from. */
  startUrls: string[];
  /** How many link-hops to follow from each seed. 0 = only the seed pages. */
  maxDepth: number;
  /** Hard cap on the total number of pages fetched. */
  maxPages: number;
  /** Restrict crawling to the same registrable host as each seed. */
  sameDomainOnly: boolean;
  /** Max pages fetched in parallel. */
  concurrency: number;
  /** Politeness delay (ms) enforced between requests to the same host. */
  delayMs: number;
  /** Honor robots.txt (disallow rules + crawl-delay). */
  respectRobots: boolean;
  /** User-Agent header sent with every request. */
  userAgent: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Retry attempts for transient failures (network / 5xx / 429). */
  maxRetries: number;
  /** Extra hostnames allowed beyond the seed hosts (only used when sameDomainOnly). */
  allowedDomains?: string[];
}

/** Structured data parsed out of a single HTML page. */
export interface ParsedPage {
  title: string | null;
  description: string | null;
  canonical: string | null;
  lang: string | null;
  headings: { h1: string[]; h2: string[] };
  /** Cleaned, whitespace-collapsed visible text (truncated). */
  text: string;
  wordCount: number;
  /** Absolute, de-duplicated outbound links. */
  links: string[];
  /** Absolute image source URLs. */
  images: string[];
  /** Selected OpenGraph tags (og:*). */
  openGraph: Record<string, string>;
}

/** The outcome of visiting one URL. */
export interface CrawlResult {
  url: string;
  /** Final URL after redirects (may differ from `url`). */
  finalUrl: string;
  depth: number;
  ok: boolean;
  status: number | null;
  contentType: string | null;
  fetchedAt: string;
  /** Milliseconds spent fetching. */
  elapsedMs: number;
  data: ParsedPage | null;
  error: string | null;
}

/** Aggregate report returned by a crawl run. */
export interface CrawlReport {
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  options: CrawlOptions;
  pagesCrawled: number;
  pagesFailed: number;
  results: CrawlResult[];
}
