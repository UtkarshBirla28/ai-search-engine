import env from '../config/env.js';
import logger from '../config/logger.js';
import { pageRepository } from '../repositories/index.js';
import type { SearchHit, SearchMatchType, SearchParams } from '../repositories/types.js';
import { embedOne, embeddingModel, isEmbeddingEnabled } from './embeddings/index.js';
import { cached, cacheKey, getIndexVersion } from './cache.js';

export type SearchMode = 'auto' | 'fulltext' | 'fuzzy' | 'semantic' | 'hybrid';
export type EffectiveMode = 'fulltext' | 'fuzzy' | 'semantic' | 'hybrid';

export interface SearchQueryParams {
  q: string;
  page: number;
  limit: number;
  mode: SearchMode;
}

export interface SearchResultItem {
  id: string;
  title: string | null;
  snippet: string;
  url: string;
  score: number;
  matchType: SearchMatchType;
}

export interface SearchResponse {
  query: string;
  page: number;
  limit: number;
  total: number;
  mode: EffectiveMode;
  results: SearchResultItem[];
}

const toItem = (h: SearchHit): SearchResultItem => ({
  id: h.id,
  title: h.title,
  snippet: h.snippet,
  url: h.url,
  score: h.score,
  matchType: h.matchType,
});

/**
 * Reciprocal Rank Fusion: combine several ranked lists into one. A document's
 * fused score is Σ 1/(k + rank) across the lists it appears in (rank is 1-based).
 * RRF needs no score calibration between retrievers — it only uses positions.
 *
 * NOTE: the hot hybrid path now fuses in SQL (PageRepository.searchHybrid) for a
 * single round-trip and an accurate total. This JS implementation is kept for
 * unit tests and as a reference/fallback.
 */
export const reciprocalRankFusion = (lists: SearchHit[][], k: number): SearchHit[] => {
  const scores = new Map<string, number>();
  const best = new Map<string, SearchHit>();

  for (const list of lists) {
    list.forEach((hit, index) => {
      const rank = index + 1;
      scores.set(hit.id, (scores.get(hit.id) ?? 0) + 1 / (k + rank));
      const existing = best.get(hit.id);
      if (!existing || (!existing.snippet.includes('<mark>') && hit.snippet.includes('<mark>'))) {
        best.set(hit.id, hit);
      }
    });
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ ...best.get(id)!, score, matchType: 'hybrid' as const }));
};

/** Full-text with a typo-tolerant fuzzy fallback when it finds nothing. */
const lexicalWithFallback = async (
  params: SearchParams
): Promise<{ hits: SearchHit[]; total: number; mode: EffectiveMode }> => {
  const ft = await pageRepository.searchFullText(params);
  if (ft.total > 0) return { hits: ft.hits, total: ft.total, mode: 'fulltext' };
  const fz = await pageRepository.searchFuzzy(params);
  return { hits: fz.hits, total: fz.total, mode: 'fuzzy' };
};

/** Embed the query, memoized in Redis (embeddings are stable per model). */
const embedQuery = (q: string): Promise<number[]> =>
  cached(cacheKey('emb', embeddingModel(), q), env.cache.embeddingTtl, () => embedOne(q));

const buildResponse = (
  q: string,
  page: number,
  limit: number,
  r: { hits: SearchHit[]; total: number },
  mode: EffectiveMode
): SearchResponse => ({ query: q, page, limit, total: r.total, mode, results: r.hits.map(toItem) });

/** The actual search logic (uncached). Wrapped by `performSearch`. */
const runSearch = async ({ q, page, limit, mode }: SearchQueryParams): Promise<SearchResponse> => {
  const offset = (page - 1) * limit;
  const baseParams: SearchParams = {
    query: q,
    limit,
    offset,
    language: env.search.language,
    fuzzyThreshold: env.search.fuzzyThreshold,
  };

  const resolved: SearchMode = mode === 'auto' ? (isEmbeddingEnabled() ? 'hybrid' : 'fulltext') : mode;
  const lexicalAutoFallback = mode === 'auto';

  logger.debug(`Search "${q}" (mode=${mode}→${resolved}, page=${page}, limit=${limit})`);

  if (resolved === 'fulltext') {
    if (lexicalAutoFallback) {
      const r = await lexicalWithFallback(baseParams);
      return buildResponse(q, page, limit, r, r.mode);
    }
    return buildResponse(q, page, limit, await pageRepository.searchFullText(baseParams), 'fulltext');
  }
  if (resolved === 'fuzzy') {
    return buildResponse(q, page, limit, await pageRepository.searchFuzzy(baseParams), 'fuzzy');
  }

  // Semantic / hybrid need embeddings; degrade to lexical if unavailable.
  if (!isEmbeddingEnabled()) {
    logger.warn('Semantic search requested but embeddings are disabled — using full-text.');
    const r = await lexicalWithFallback(baseParams);
    return buildResponse(q, page, limit, r, r.mode);
  }

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedQuery(q);
  } catch (err) {
    logger.error('Query embedding failed — falling back to lexical search.', err);
    const r = await lexicalWithFallback(baseParams);
    return buildResponse(q, page, limit, r, r.mode);
  }

  if (resolved === 'semantic') {
    return buildResponse(q, page, limit, await pageRepository.searchSemantic({ queryEmbedding, limit, offset }), 'semantic');
  }

  // Hybrid — single SQL query fuses full-text + semantic via RRF (accurate total).
  const hybrid = await pageRepository.searchHybrid({
    ...baseParams,
    queryEmbedding,
    rrfK: env.search.rrfK,
    pool: env.search.candidatePool,
  });
  if (hybrid.total === 0) {
    return buildResponse(q, page, limit, await pageRepository.searchFuzzy(baseParams), 'fuzzy');
  }
  return buildResponse(q, page, limit, hybrid, 'hybrid');
};

/**
 * Search stored pages. Cache-aside on Redis (keyed by the index version so a new
 * crawl transparently invalidates results); computes directly when Redis is off.
 *
 * Modes: `fulltext` | `fuzzy` | `semantic` | `hybrid` | `auto` (hybrid when
 * embeddings are enabled, else full-text→fuzzy). Semantic/hybrid degrade to
 * lexical if embeddings are disabled or fail — search never hard-fails.
 */
export const performSearch = async (p: SearchQueryParams): Promise<SearchResponse> => {
  const version = await getIndexVersion();
  const key = cacheKey('search', version, p.mode, p.limit, p.page, p.q.toLowerCase());
  return cached(key, env.cache.searchTtl, () => runSearch(p));
};

export default { performSearch };
