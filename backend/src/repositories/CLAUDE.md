# src/repositories — data access (Repository pattern)

The **only** place besides `db/` allowed to contain SQL. Services call
repositories; they never touch `pg` or write queries themselves. This keeps
persistence swappable and the SQL in one auditable place.

## Pattern

- Each repository is a class taking an optional `Queryable` (`db/pool.ts`):
  - **no arg** → uses the shared pool (default `pageRepository` / `linkRepository` singletons).
  - **a transaction client** → `new PageRepository(client)` inside `withTransaction` so multiple writes commit atomically (see `services/ingest.service.ts`).
- Methods return **camelCase domain types** (`types.ts`), never raw rows. Add a `map*` function when you add a query.

## Conventions

- **Parameterize everything** (`$1,$2,…`). Never interpolate user input into SQL.
- Keep methods thin and single-purpose; put orchestration (crawl→map→persist) in services, not here.
- Search lives in `PageRepository`:
  - `searchFullText` — weighted `ts_rank_cd` over the `search_vector` generated column, `ts_headline` snippets, `websearch_to_tsquery` parsing. This is the primary path.
  - `searchFuzzy` — trigram (`pg_trgm`) fallback for typos; seq-scans on `similarity()`, so it's a fallback, not the hot path.
  - `total` comes from `count(*) OVER()` in the same query — one round-trip for rows + count.
- New tables → new repository; register its singleton in `index.ts`.
- Semantic search (pgvector) will add a `searchSemantic` method here once the optional embeddings migration is enabled.
