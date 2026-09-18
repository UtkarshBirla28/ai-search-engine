-- 001_init — core crawl store + full-text search.
--
-- Design notes:
--  * `search_vector` is a STORED generated column. Postgres builds it from the
--    text-search config ('english' → tokenize + drop stopwords + snowball
--    stemming), weighting title (A) > description (B) > body (C). The GIN index
--    over it makes @@ matches and ts_rank ordering fast. This is why we don't
--    hand-roll tokenizer/stopword/stemmer code — the database does it, indexed.
--  * pg_trgm powers typo-tolerant "similar" lookups on titles.
--  * `metadata JSONB` holds the genuinely-variable extras (og tags, headings,
--    images) — structured columns for the stable fields, JSONB for the rest.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS pages (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  url           TEXT        NOT NULL UNIQUE,          -- normalized URL (dedup key)
  final_url     TEXT        NOT NULL,                 -- after redirects
  host          TEXT        NOT NULL,
  status        INTEGER,
  title         TEXT,
  description   TEXT,
  content_text  TEXT        NOT NULL DEFAULT '',
  content_hash  TEXT        NOT NULL,                 -- change detection
  lang          TEXT,
  depth         INTEGER     NOT NULL DEFAULT 0,
  word_count    INTEGER     NOT NULL DEFAULT 0,
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  search_vector TSVECTOR GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(content_text, '')), 'C')
  ) STORED,
  crawled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pages_search      ON pages USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_pages_title_trgm  ON pages USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pages_host        ON pages (host);

CREATE TABLE IF NOT EXISTS links (
  from_page_id BIGINT NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  to_url       TEXT   NOT NULL,
  PRIMARY KEY (from_page_id, to_url)
);

-- Reverse lookup ("what links to this URL?") — the basis for authority ranking.
CREATE INDEX IF NOT EXISTS idx_links_to_url ON links (to_url);
