-- 002_embeddings — semantic search via pgvector.
--
-- The `${EMBEDDING_DIM}` placeholder is substituted by the migration runner from
-- EMBEDDING_DIM (see src/db/migrate.ts) because pgvector needs a literal
-- dimension in the column DDL. It MUST match the active embedding provider:
--   openai text-embedding-3-small = 1536, local MiniLM = 384, hash = 256.
--
-- Requires a Postgres image that ships the `vector` extension (docker-compose
-- uses pgvector/pgvector). Embeddings are populated on crawl (ingest.service)
-- and can be backfilled with `npm run embed`.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE pages ADD COLUMN IF NOT EXISTS embedding vector(${EMBEDDING_DIM});

-- Tracks which model/dimension produced each embedding, so a provider change is
-- detectable (rows with a stale model can be re-embedded).
ALTER TABLE pages ADD COLUMN IF NOT EXISTS embedding_model TEXT;

-- Approximate nearest-neighbour index for cosine distance (<=>).
CREATE INDEX IF NOT EXISTS idx_pages_embedding
  ON pages USING hnsw (embedding vector_cosine_ops);

-- Hybrid search fuses lexical rank (ts_rank_cd) with semantic distance
-- (1 - (embedding <=> query_embedding)) via reciprocal-rank fusion in the
-- search service.
