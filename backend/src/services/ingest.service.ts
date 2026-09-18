import { createHash } from 'node:crypto';
import logger from '../config/logger.js';
import ApiError from '../utils/ApiError.js';
import { isDatabaseConfigured, withTransaction } from '../db/pool.js';
import { PageRepository, LinkRepository } from '../repositories/index.js';
import type { NewPage } from '../repositories/types.js';
import { crawl, discoverSitemapUrls, getHost } from './crawler/index.js';
import type { CrawlOptions, CrawlResult } from './crawler/types.js';
import { embedPagesByIds } from './embed.service.js';
import { isEmbeddingEnabled } from './embeddings/index.js';
import { bumpIndexVersion } from './cache.js';

export interface IngestOptions extends Partial<Omit<CrawlOptions, 'startUrls'>> {
  /** Seed the crawl with URLs discovered from the sites' sitemaps. */
  useSitemap?: boolean;
}

/** Coarse progress phases reported during an ingest (used by the job queue). */
export interface IngestProgress {
  phase: 'crawling' | 'storing' | 'embedding' | 'done';
  pagesCrawled?: number;
  stored?: number;
  embedded?: number;
}

export type ProgressFn = (p: IngestProgress) => void | Promise<void>;

type StoreOutcome = 'inserted' | 'updated' | 'skipped' | 'error';

export interface IngestedPage {
  url: string;
  finalUrl: string;
  depth: number;
  status: number | null;
  ok: boolean;
  title: string | null;
  stored: StoreOutcome;
  error: string | null;
}

export interface IngestReport {
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  seeds: number;
  pagesCrawled: number;
  pagesFailed: number;
  storage: { inserted: number; updated: number; skipped: number; failed: number; embedded: number };
  pages: IngestedPage[];
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Map a successful crawl result to a persistable page record. */
const toNewPage = (result: CrawlResult): NewPage => {
  const data = result.data!;
  return {
    url: result.url,
    finalUrl: result.finalUrl,
    host: getHost(result.finalUrl) ?? getHost(result.url) ?? '',
    status: result.status,
    title: data.title,
    description: data.description,
    contentText: data.text,
    contentHash: sha256(data.text),
    lang: data.lang,
    depth: result.depth,
    wordCount: data.wordCount,
    // The variable, page-specific extras live in JSONB — not their own columns.
    metadata: {
      canonical: data.canonical,
      headings: data.headings,
      images: data.images,
      openGraph: data.openGraph,
    },
  };
};

/** Persist one page and its outbound links atomically; returns its id + outcome. */
const storePage = async (
  result: CrawlResult
): Promise<{ outcome: StoreOutcome; id: string | null }> => {
  try {
    return await withTransaction(async (client) => {
      const pages = new PageRepository(client);
      const links = new LinkRepository(client);
      const { id, inserted } = await pages.upsert(toNewPage(result));
      await links.replaceLinks(id, result.data!.links);
      return { outcome: inserted ? 'inserted' : 'updated', id };
    });
  } catch (err) {
    logger.error(`Failed to store ${result.url}`, err);
    return { outcome: 'error', id: null };
  }
};

/**
 * Crawl the given seeds (optionally expanded via sitemaps), then persist every
 * successfully-fetched page + its link graph into Postgres. Returns a summary;
 * page bodies are stored, not echoed back.
 */
export const crawlAndStore = async (
  urls: string[],
  options: IngestOptions = {},
  onProgress?: ProgressFn
): Promise<IngestReport> => {
  if (!isDatabaseConfigured()) {
    throw new ApiError(503, 'Database not configured — set DATABASE_URL to enable crawling.');
  }

  const { useSitemap, ...crawlOverrides } = options;

  let seeds = urls;
  if (useSitemap) {
    const discovered = await discoverSitemapUrls(urls, {
      userAgent: crawlOverrides.userAgent,
      timeoutMs: crawlOverrides.timeoutMs,
    });
    seeds = [...new Set([...urls, ...discovered])];
  }

  await onProgress?.({ phase: 'crawling', pagesCrawled: 0 });
  const report = await crawl(seeds, crawlOverrides);
  await onProgress?.({ phase: 'storing', pagesCrawled: report.pagesCrawled });

  const storage = { inserted: 0, updated: 0, skipped: 0, failed: 0 };
  const pages: IngestedPage[] = [];
  const storedIds: string[] = [];

  for (const result of report.results) {
    let stored: StoreOutcome = 'skipped';
    if (result.ok && result.data) {
      const { outcome, id } = await storePage(result);
      stored = outcome;
      if (id) storedIds.push(id);
    }
    storage[
      stored === 'inserted'
        ? 'inserted'
        : stored === 'updated'
          ? 'updated'
          : stored === 'error'
            ? 'failed'
            : 'skipped'
    ] += 1;

    pages.push({
      url: result.url,
      finalUrl: result.finalUrl,
      depth: result.depth,
      status: result.status,
      ok: result.ok,
      title: result.data?.title ?? null,
      stored,
      error: result.error,
    });
  }

  // Index the freshly-stored pages for semantic search. Failures here never fail
  // the crawl — pages stay searchable lexically and can be backfilled later.
  let embedded = 0;
  if (isEmbeddingEnabled() && storedIds.length > 0) {
    await onProgress?.({ phase: 'embedding', stored: storedIds.length });
    embedded = await embedPagesByIds(storedIds);
  }
  await onProgress?.({ phase: 'done', pagesCrawled: report.pagesCrawled, embedded });

  // Corpus changed → invalidate cached search/answer results (no-op without Redis).
  if (storage.inserted > 0 || storage.updated > 0) {
    await bumpIndexVersion();
  }

  logger.info(
    `Ingest complete: crawled ${report.pagesCrawled}, ` +
      `stored ${storage.inserted} new / ${storage.updated} updated, failed ${storage.failed}, ` +
      `embedded ${embedded}`
  );

  return {
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    elapsedMs: report.elapsedMs,
    seeds: seeds.length,
    pagesCrawled: report.pagesCrawled,
    pagesFailed: report.pagesFailed,
    storage: { ...storage, embedded },
    pages,
  };
};
