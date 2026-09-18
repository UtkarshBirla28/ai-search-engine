/**
 * Domain types for the persistence layer. Repositories map snake_case DB rows
 * to these camelCase shapes so the rest of the app never sees raw column names.
 */

/** Input to upsert a crawled page. */
export interface NewPage {
  url: string;
  finalUrl: string;
  host: string;
  status: number | null;
  title: string | null;
  description: string | null;
  contentText: string;
  contentHash: string;
  lang: string | null;
  depth: number;
  wordCount: number;
  metadata: Record<string, unknown>;
}

/** A stored page as returned to callers. */
export interface Page {
  id: string;
  url: string;
  finalUrl: string;
  host: string;
  status: number | null;
  title: string | null;
  description: string | null;
  contentText: string;
  contentHash: string;
  lang: string | null;
  depth: number;
  wordCount: number;
  metadata: Record<string, unknown>;
  crawledAt: string;
  updatedAt: string;
}

/** Result of an upsert — id plus whether the row was newly inserted. */
export interface UpsertResult {
  id: string;
  inserted: boolean;
}

/** How a search match should be interpreted. */
export type SearchMatchType = 'fulltext' | 'fuzzy' | 'semantic' | 'hybrid';

/** A single search result row. */
export interface SearchHit {
  id: string;
  url: string;
  title: string | null;
  snippet: string;
  score: number;
  matchType: SearchMatchType;
}

/** A page of search results plus the total match count. */
export interface SearchPage {
  total: number;
  hits: SearchHit[];
}

export interface SearchParams {
  query: string;
  limit: number;
  offset: number;
  language: string;
  fuzzyThreshold: number;
}

/** Parameters for a vector (semantic) nearest-neighbour search. */
export interface SemanticSearchParams {
  /** The query embedding, same dimension as `pages.embedding`. */
  queryEmbedding: number[];
  limit: number;
  offset: number;
}

/** A page that still needs an embedding computed (for ingest/backfill). */
export interface PageNeedingEmbedding {
  id: string;
  title: string | null;
  description: string | null;
  contentText: string;
}

/** Full page content for answer synthesis (RAG context). */
export interface PageContent {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  contentText: string;
}
