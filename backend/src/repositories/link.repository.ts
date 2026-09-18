import { getPool, type Queryable } from '../db/pool.js';

/**
 * Data access for the page→page link graph. Constructed with a transaction
 * client during ingestion so a page and its links commit atomically.
 */
export class LinkRepository {
  constructor(private readonly db?: Queryable) {}

  private get exec(): Queryable {
    return this.db ?? getPool();
  }

  /**
   * Replace all outbound links for a page. Delete-then-insert keeps the graph
   * correct across recrawls (stale links are dropped). Uses a single set-based
   * insert via `unnest` rather than one round-trip per link.
   */
  async replaceLinks(fromPageId: string, toUrls: readonly string[]): Promise<number> {
    await this.exec.query('DELETE FROM links WHERE from_page_id = $1', [fromPageId]);

    const unique = [...new Set(toUrls)];
    if (unique.length === 0) return 0;

    await this.exec.query(
      `INSERT INTO links (from_page_id, to_url)
       SELECT $1, u FROM unnest($2::text[]) AS u
       ON CONFLICT (from_page_id, to_url) DO NOTHING`,
      [fromPageId, unique]
    );
    return unique.length;
  }

  /** How many stored pages link to a given URL (authority signal). */
  async inboundCount(toUrl: string): Promise<number> {
    const { rows } = await this.exec.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM links WHERE to_url = $1',
      [toUrl]
    );
    return rows[0].count;
  }
}

/** Shared instance bound to the pool. */
export const linkRepository = new LinkRepository();
