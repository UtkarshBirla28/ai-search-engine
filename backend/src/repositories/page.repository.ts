import { getPool, type Queryable } from '../db/pool.js';
import { toVectorLiteral } from '../services/embeddings/index.js';
import type {
  NewPage,
  Page,
  PageContent,
  PageNeedingEmbedding,
  SearchHit,
  SearchPage,
  SearchParams,
  SemanticSearchParams,
  UpsertResult,
} from './types.js';

/** Shape of a full `pages` row as returned from SQL. */
interface PageRow {
  id: string;
  url: string;
  final_url: string;
  host: string;
  status: number | null;
  title: string | null;
  description: string | null;
  content_text: string;
  content_hash: string;
  lang: string | null;
  depth: number;
  word_count: number;
  metadata: Record<string, unknown>;
  crawled_at: Date;
  updated_at: Date;
}

const mapPage = (r: PageRow): Page => ({
  id: r.id,
  url: r.url,
  finalUrl: r.final_url,
  host: r.host,
  status: r.status,
  title: r.title,
  description: r.description,
  contentText: r.content_text,
  contentHash: r.content_hash,
  lang: r.lang,
  depth: r.depth,
  wordCount: r.word_count,
  metadata: r.metadata,
  crawledAt: r.crawled_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

/**
 * Data access for crawled pages. Construct with a transaction client to enlist
 * in a transaction, or leave the default to use the shared pool.
 */
export class PageRepository {
  constructor(private readonly db?: Queryable) {}

  private get exec(): Queryable {
    return this.db ?? getPool();
  }

  /** Insert a page or update it in place (keyed by normalized url). */
  async upsert(page: NewPage): Promise<UpsertResult> {
    const { rows } = await this.exec.query<{ id: string; inserted: boolean }>(
      `INSERT INTO pages
         (url, final_url, host, status, title, description,
          content_text, content_hash, lang, depth, word_count, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
       ON CONFLICT (url) DO UPDATE SET
         final_url    = EXCLUDED.final_url,
         status       = EXCLUDED.status,
         title        = EXCLUDED.title,
         description  = EXCLUDED.description,
         content_text = EXCLUDED.content_text,
         content_hash = EXCLUDED.content_hash,
         lang         = EXCLUDED.lang,
         depth        = LEAST(pages.depth, EXCLUDED.depth),
         word_count   = EXCLUDED.word_count,
         metadata     = EXCLUDED.metadata,
         updated_at   = now()
       RETURNING id::text AS id, (xmax = 0) AS inserted`,
      [
        page.url,
        page.finalUrl,
        page.host,
        page.status,
        page.title,
        page.description,
        page.contentText,
        page.contentHash,
        page.lang,
        page.depth,
        page.wordCount,
        JSON.stringify(page.metadata),
      ]
    );
    return rows[0];
  }

  async getById(id: string): Promise<Page | null> {
    const { rows } = await this.exec.query<PageRow>('SELECT * FROM pages WHERE id = $1', [id]);
    return rows[0] ? mapPage(rows[0]) : null;
  }

  async getByUrl(url: string): Promise<Page | null> {
    const { rows } = await this.exec.query<PageRow>('SELECT * FROM pages WHERE url = $1', [url]);
    return rows[0] ? mapPage(rows[0]) : null;
  }

  async count(): Promise<number> {
    const { rows } = await this.exec.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM pages'
    );
    return rows[0].count;
  }

  /**
   * Full-text search: rank by weighted `ts_rank_cd`, with server-generated
   * highlighted snippets. `total` is the full match count (for pagination).
   */
  async searchFullText(params: SearchParams): Promise<SearchPage> {
    const { rows } = await this.exec.query<{
      id: string;
      url: string;
      title: string | null;
      snippet: string;
      score: number;
      total: number;
    }>(
      `WITH q AS (SELECT websearch_to_tsquery($2::regconfig, $1) AS query)
       SELECT p.id::text AS id,
              p.url,
              p.title,
              ts_headline($2::regconfig, coalesce(p.content_text, ''), q.query,
                'StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MinWords=6,MaxWords=24,ShortWord=3'
              ) AS snippet,
              ts_rank_cd(p.search_vector, q.query) AS score,
              count(*) OVER() AS total
       FROM pages p, q
       WHERE p.search_vector @@ q.query
       ORDER BY score DESC, p.id
       LIMIT $3 OFFSET $4`,
      [params.query, params.language, params.limit, params.offset]
    );

    return {
      total: rows[0]?.total ?? 0,
      hits: rows.map(
        (r): SearchHit => ({
          id: r.id,
          url: r.url,
          title: r.title,
          snippet: r.snippet,
          score: Number(r.score),
          matchType: 'fulltext',
        })
      ),
    };
  }

  /**
   * Typo-tolerant fallback using trigram similarity on title/description.
   * Used when full-text finds nothing (e.g. the user misspelled a term).
   */
  async searchFuzzy(params: SearchParams): Promise<SearchPage> {
    const { rows } = await this.exec.query<{
      id: string;
      url: string;
      title: string | null;
      snippet: string;
      score: number;
      total: number;
    }>(
      // word_similarity matches the query against the closest WORD in the text, so
      // a short typo ("histry") still matches inside a long title ("History | …").
      // We keep whole-string similarity too and take the max of both signals.
      `SELECT p.id::text AS id,
              p.url,
              p.title,
              left(coalesce(p.content_text, ''), 200) AS snippet,
              GREATEST(similarity(coalesce(p.title, ''), $1),
                       word_similarity($1, coalesce(p.title, '')),
                       word_similarity($1, coalesce(p.description, ''))) AS score,
              count(*) OVER() AS total
       FROM pages p
       WHERE GREATEST(similarity(coalesce(p.title, ''), $1),
                      word_similarity($1, coalesce(p.title, '')),
                      word_similarity($1, coalesce(p.description, ''))) >= $2
       ORDER BY score DESC, p.id
       LIMIT $3 OFFSET $4`,
      [params.query, params.fuzzyThreshold, params.limit, params.offset]
    );

    return {
      total: rows[0]?.total ?? 0,
      hits: rows.map(
        (r): SearchHit => ({
          id: r.id,
          url: r.url,
          title: r.title,
          snippet: r.snippet,
          score: Number(r.score),
          matchType: 'fuzzy',
        })
      ),
    };
  }

  /**
   * Semantic search: nearest neighbours by cosine distance over `embedding`,
   * using the HNSW index. Score is cosine similarity (1 - distance) in [0,1].
   * Only rows that have an embedding participate.
   */
  async searchSemantic(params: SemanticSearchParams): Promise<SearchPage> {
    const vector = toVectorLiteral(params.queryEmbedding);
    const { rows } = await this.exec.query<{
      id: string;
      url: string;
      title: string | null;
      snippet: string;
      score: number;
      total: number;
    }>(
      `SELECT p.id::text AS id,
              p.url,
              p.title,
              left(coalesce(p.description, p.content_text, ''), 240) AS snippet,
              1 - (p.embedding <=> $1::vector) AS score,
              count(*) OVER() AS total
       FROM pages p
       WHERE p.embedding IS NOT NULL
       ORDER BY p.embedding <=> $1::vector
       LIMIT $2 OFFSET $3`,
      [vector, params.limit, params.offset]
    );

    return {
      total: rows[0]?.total ?? 0,
      hits: rows.map(
        (r): SearchHit => ({
          id: r.id,
          url: r.url,
          title: r.title,
          snippet: r.snippet,
          score: Number(r.score),
          matchType: 'semantic',
        })
      ),
    };
  }

  /**
   * Hybrid search in a SINGLE round-trip. Ranks the corpus by full-text and by
   * vector distance in two CTEs, fuses them with Reciprocal Rank Fusion in SQL
   * (`sum(1/(k+rank))`), and returns the fused page plus an ACCURATE `total`
   * (the size of the fused candidate set). This replaces the two-query + JS-merge
   * approach: fewer round-trips, correct pagination counts.
   */
  async searchHybrid(
    params: SearchParams & { queryEmbedding: number[]; rrfK: number; pool: number }
  ): Promise<SearchPage> {
    const vector = toVectorLiteral(params.queryEmbedding);
    const { rows } = await this.exec.query<{
      id: string;
      url: string;
      title: string | null;
      snippet: string;
      score: number;
      total: number;
    }>(
      `WITH q AS (SELECT websearch_to_tsquery($2::regconfig, $1) AS query),
       ft AS (
         SELECT p.id,
                row_number() OVER (ORDER BY ts_rank_cd(p.search_vector, q.query) DESC, p.id) AS rank
         FROM pages p, q
         WHERE p.search_vector @@ q.query
         LIMIT $5
       ),
       sem AS (
         SELECT p.id,
                row_number() OVER (ORDER BY p.embedding <=> $3::vector) AS rank
         FROM pages p
         WHERE p.embedding IS NOT NULL
         ORDER BY p.embedding <=> $3::vector
         LIMIT $5
       ),
       fused AS (
         SELECT id, sum(1.0 / ($4 + rank)) AS score
         FROM (SELECT id, rank FROM ft UNION ALL SELECT id, rank FROM sem) u
         GROUP BY id
       )
       SELECT p.id::text AS id,
              p.url,
              p.title,
              ts_headline($2::regconfig, coalesce(p.content_text, ''), q.query,
                'StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MinWords=6,MaxWords=24,ShortWord=3'
              ) AS snippet,
              f.score,
              count(*) OVER() AS total
       FROM fused f
       JOIN pages p ON p.id = f.id, q
       ORDER BY f.score DESC, p.id
       LIMIT $6 OFFSET $7`,
      [params.query, params.language, vector, params.rrfK, params.pool, params.limit, params.offset]
    );

    return {
      total: rows[0]?.total ?? 0,
      hits: rows.map(
        (r): SearchHit => ({
          id: r.id,
          url: r.url,
          title: r.title,
          snippet: r.snippet,
          score: Number(r.score),
          matchType: 'hybrid',
        })
      ),
    };
  }

  /** Store (or clear) a page's embedding plus the model that produced it. */
  async updateEmbedding(id: string, embedding: number[] | null, model: string | null): Promise<void> {
    await this.exec.query(
      `UPDATE pages SET embedding = $2::vector, embedding_model = $3 WHERE id = $1`,
      [id, embedding ? toVectorLiteral(embedding) : null, model]
    );
  }

  /**
   * Pages that still need an embedding — either never embedded, or embedded by a
   * different model than the one currently configured (so a provider switch can
   * be backfilled). Ordered oldest-first for stable batching.
   */
  async listMissingEmbeddings(currentModel: string, limit: number): Promise<PageNeedingEmbedding[]> {
    const { rows } = await this.exec.query<{
      id: string;
      title: string | null;
      description: string | null;
      content_text: string;
    }>(
      `SELECT id::text AS id, title, description, content_text
       FROM pages
       WHERE embedding IS NULL OR embedding_model IS DISTINCT FROM $1
       ORDER BY id
       LIMIT $2`,
      [currentModel, limit]
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      contentText: r.content_text,
    }));
  }

  /** How many pages still need (re)embedding for the given model. */
  async countMissingEmbeddings(currentModel: string): Promise<number> {
    const { rows } = await this.exec.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pages
       WHERE embedding IS NULL OR embedding_model IS DISTINCT FROM $1`,
      [currentModel]
    );
    return rows[0].count;
  }

  /**
   * Autocomplete suggestions: distinct page titles matching the (partial) query,
   * ranked by trigram word-similarity so typos/partials still surface. Backed by
   * the existing title trigram GIN index.
   */
  async suggestTitles(query: string, limit: number): Promise<string[]> {
    const { rows } = await this.exec.query<{ title: string }>(
      `SELECT title, max(word_similarity($1, title)) AS sim
       FROM pages
       WHERE title IS NOT NULL AND title <> ''
         AND (title ILIKE '%' || $1 || '%' OR word_similarity($1, title) > 0.3)
       GROUP BY title
       ORDER BY sim DESC, title
       LIMIT $2`,
      [query, limit]
    );
    return rows.map((r) => r.title);
  }

  /** Fetch full content for a set of ids, preserving the given order (for RAG). */
  async getContentByIds(ids: string[]): Promise<PageContent[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.exec.query<{
      id: string;
      url: string;
      title: string | null;
      description: string | null;
      content_text: string;
    }>(
      `SELECT id::text AS id, url, title, description, content_text
       FROM pages WHERE id = ANY($1::bigint[])`,
      [ids]
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined)
      .map((r) => ({
        id: r.id,
        url: r.url,
        title: r.title,
        description: r.description,
        contentText: r.content_text,
      }));
  }
}

/** Shared instance bound to the pool. */
export const pageRepository = new PageRepository();
