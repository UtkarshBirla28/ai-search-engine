import { gunzipSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import logger from '../../config/logger.js';
import { getHost, getOrigin, normalizeUrl, sameSite } from './urlUtils.js';
import { DEFAULT_USER_AGENT } from './crawler.js';

export interface SitemapOptions {
  userAgent: string;
  timeoutMs: number;
  /** Stop after collecting this many URLs. */
  maxUrls: number;
  /** Safety cap on how many sitemap documents we fetch (index files fan out). */
  maxSitemaps: number;
}

export const defaultSitemapOptions = (): SitemapOptions => ({
  userAgent: DEFAULT_USER_AGENT,
  timeoutMs: 15_000,
  maxUrls: 1_000,
  maxSitemaps: 50,
});

const parser = new XMLParser({
  ignoreAttributes: true,
  // Force these to arrays so single-entry sitemaps parse uniformly.
  isArray: (name) => name === 'url' || name === 'sitemap',
});

interface LocEntry {
  loc?: string | number;
}

/** Fetch a sitemap URL, transparently decompressing .gz payloads. */
const fetchSitemapText = async (url: string, opts: SitemapOptions): Promise<string | null> => {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: { 'User-Agent': opts.userAgent, Accept: 'application/xml,text/xml,*/*' },
    });
    if (!res.ok) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    // gzip magic bytes, or a .gz URL.
    const isGzip = (buf[0] === 0x1f && buf[1] === 0x8b) || url.endsWith('.gz');
    return (isGzip ? gunzipSync(buf) : buf).toString('utf8');
  } catch (err) {
    logger.debug(`sitemap fetch failed: ${url}`, err);
    return null;
  }
};

/** Read `Sitemap:` directives from an origin's robots.txt. */
const sitemapsFromRobots = async (origin: string, opts: SitemapOptions): Promise<string[]> => {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: { 'User-Agent': opts.userAgent },
    });
    if (!res.ok) return [];
    const text = await res.text();
    return text
      .split(/\r?\n/)
      .map((line) => /^\s*sitemap:\s*(.+)$/i.exec(line)?.[1]?.trim())
      .filter((v): v is string => Boolean(v));
  } catch {
    return [];
  }
};

const toLoc = (entry: LocEntry): string | null =>
  entry.loc === undefined ? null : String(entry.loc).trim();

/**
 * Discover important URLs for the given seed sites via their sitemaps.
 *
 * Walks robots.txt `Sitemap:` entries plus `/sitemap.xml`, follows
 * `<sitemapindex>` files recursively, and returns normalized, in-scope,
 * de-duplicated page URLs (bounded by `maxUrls`/`maxSitemaps`).
 */
export const discoverSitemapUrls = async (
  seedUrls: string[],
  overrides: Partial<SitemapOptions> = {}
): Promise<string[]> => {
  const opts = { ...defaultSitemapOptions(), ...overrides };

  const seedHosts = new Set<string>();
  const origins = new Set<string>();
  for (const seed of seedUrls) {
    const host = getHost(seed);
    const origin = getOrigin(seed);
    if (host) seedHosts.add(host);
    if (origin) origins.add(origin);
  }

  const inScope = (url: string): boolean => {
    const host = getHost(url);
    if (!host) return false;
    for (const seed of seedHosts) if (sameSite(seed, host)) return true;
    return false;
  };

  // Frontier of sitemap documents to fetch.
  const queue: string[] = [];
  const seenSitemaps = new Set<string>();
  const enqueueSitemap = (url: string): void => {
    const norm = normalizeUrl(url);
    if (norm && !seenSitemaps.has(norm)) {
      seenSitemaps.add(norm);
      queue.push(norm);
    }
  };

  for (const origin of origins) {
    for (const sm of await sitemapsFromRobots(origin, opts)) enqueueSitemap(sm);
    enqueueSitemap(`${origin}/sitemap.xml`);
  }

  const urls = new Set<string>();
  let fetched = 0;

  while (queue.length > 0 && fetched < opts.maxSitemaps && urls.size < opts.maxUrls) {
    const sitemapUrl = queue.shift() as string;
    fetched += 1;

    const xml = await fetchSitemapText(sitemapUrl, opts);
    if (!xml) continue;

    let doc: { sitemapindex?: { sitemap?: LocEntry[] }; urlset?: { url?: LocEntry[] } };
    try {
      doc = parser.parse(xml);
    } catch {
      continue;
    }

    // A sitemap index → enqueue child sitemaps.
    for (const entry of doc.sitemapindex?.sitemap ?? []) {
      const loc = toLoc(entry);
      if (loc) enqueueSitemap(loc);
    }

    // A urlset → collect in-scope page URLs.
    for (const entry of doc.urlset?.url ?? []) {
      if (urls.size >= opts.maxUrls) break;
      const loc = toLoc(entry);
      if (!loc) continue;
      const norm = normalizeUrl(loc);
      if (norm && inScope(norm)) urls.add(norm);
    }
  }

  logger.info(`Sitemap discovery: ${urls.size} URL(s) from ${fetched} sitemap document(s)`);
  return [...urls];
};
