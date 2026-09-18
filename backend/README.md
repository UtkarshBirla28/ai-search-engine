# AI Search Engine — Backend

Node.js + Express + TypeScript REST API using a clean, layered architecture.
It **crawls web pages, stores them in Postgres, and searches them** with native
full-text ranking, typo-tolerant fuzzy fallback, **pgvector semantic search**,
and **hybrid (Reciprocal-Rank-Fusion) ranking** — plus a **cited AI answer**
endpoint (OpenAI, with a non-LLM extractive fallback).

## Structure

```
backend/
├── src/
│   ├── config/         # env parsing, logger
│   ├── controllers/    # request handlers (thin)
│   ├── db/             # Postgres pool, transactions, migration runner
│   ├── middlewares/    # error handling, validation, rate limiting
│   ├── repositories/   # data access (all SQL) — Repository pattern
│   ├── routes/         # route definitions, versioned under /api/v1
│   ├── services/       # business logic: search, ingest, crawler/
│   ├── scripts/        # standalone entrypoints (crawl CLI, migrate)
│   ├── utils/          # ApiError, asyncHandler
│   ├── validators/     # Zod schemas
│   ├── app.ts          # express app wiring
│   └── server.ts       # bootstrap + graceful shutdown
├── migrations/         # versioned *.sql (optional/ = pgvector, not auto-applied)
├── docker-compose.yml  # local Postgres (pgvector image)
├── dist/               # compiled JS output (tsc, git-ignored)
├── tsconfig.json
├── .env.example
└── package.json
```

## Getting started

```bash
cd backend
npm install
docker compose up -d   # start Postgres (or point DATABASE_URL at your own)
cp .env.example .env    # DATABASE_URL matches docker-compose
npm run db:migrate      # create tables + indexes
npm run dev             # tsx watch, hot reload
# or
npm run build && npm start   # compile to dist/ then run
```

Server runs at `http://localhost:5000`. If port 5432 is already in use, start
Postgres on another port: `POSTGRES_PORT=5433 docker compose up -d` and update
`DATABASE_URL` accordingly.

Running **without** a database is supported (the server boots), but `/crawl` and
`/search` need Postgres; `/health` reports `database: not-configured`.

## Endpoints

| Method | Path                                    | Description                          |
| ------ | --------------------------------------- | ------------------------------------ |
| GET    | `/`                                     | API info                             |
| GET    | `/api/v1/health`                        | Health (+ DB/Redis/queue/AI status)  |
| GET    | `/api/v1/search?q=…&page=&limit=&mode=` | Search over stored pages             |
| GET    | `/api/v1/answer?q=…&mode=&maxSources=`  | Cited AI answer (RAG) over top hits  |
| GET    | `/api/v1/suggest?q=…&limit=`            | Autocomplete over indexed titles     |
| POST   | `/api/v1/crawl`                         | Crawl → parse → embed → store URLs   |
| GET    | `/api/v1/crawl/:jobId`                  | Async crawl job status/progress      |

### Search

```bash
curl "http://localhost:5000/api/v1/search?q=climate%20change&mode=hybrid&limit=5"
```

- `mode`:
  - `auto` — **hybrid** when embeddings are enabled, else full-text → fuzzy fallback
  - `fulltext` — keyword only (`ts_rank_cd` over a weighted `tsvector`: title >
    description > body, with snowball **stemming** + stopword removal)
  - `fuzzy` — `pg_trgm` trigram similarity (typo tolerant)
  - `semantic` — vector nearest-neighbour over embeddings (meaning, not keywords)
  - `hybrid` — full-text + semantic fused with **Reciprocal Rank Fusion**
- Results include highlighted `snippet`s and a `matchType`. Semantic/hybrid
  **degrade gracefully** to lexical search if embeddings are disabled or fail.

### Answer (RAG)

```bash
curl "http://localhost:5000/api/v1/answer?q=what%20is%20photosynthesis"
```

Retrieves the top pages (hybrid), then synthesizes a concise answer that **cites
each claim** with `[n]` markers mapping to the returned `sources`. Uses OpenAI when
`OPENAI_API_KEY` is set (`generator: "llm"`), otherwise a non-LLM extractive
summary (`generator: "extractive"`) — so the endpoint always returns something.

### Embeddings & semantic search

Embeddings are computed on crawl and stored in the `pages.embedding` pgvector
column (HNSW-indexed). Provider is set by `EMBEDDING_PROVIDER`:

- `openai` — `text-embedding-3-small` (1536-d); needs `OPENAI_API_KEY`
- `local` — `@xenova/transformers` MiniLM (384-d); `npm i @xenova/transformers`
- `hash` — offline, dependency-free (256-d); low quality, good for dev/CI
- `none` — semantic disabled (lexical only)

`EMBEDDING_DIM` must match the provider **and** the migrated column. Switching
providers → update `EMBEDDING_DIM`, re-migrate (or `npm run db:reset`), then
`npm run embed` to backfill.

### Crawler

Download and parse web pages, optionally following links.

**HTTP**

```bash
curl -X POST http://localhost:5000/api/v1/crawl \
  -H 'Content-Type: application/json' \
  -d '{"urls":["https://example.com"],"maxDepth":1,"maxPages":20}'
```

Body fields (all optional except `urls`): `urls` (string or string[]), `maxDepth`
(0–3, default 1), `maxPages` (1–200, default 20), `sameDomainOnly` (default true),
`concurrency` (1–20, default 5), `delayMs` (default 200), `respectRobots`
(default true), `timeoutMs` (default 15000), `maxRetries` (0–5, default 2),
`useSitemap` (default false — expand seeds via the sites' sitemaps).

Crawled pages (title, description, cleaned text, headings/images/og in a JSONB
`metadata` column) and their link graph are persisted to Postgres and indexed
for search. The response is a summary (`storage: { inserted, updated, … }`);
page bodies are stored, not echoed back.

**CLI**

```bash
npm run crawl -- https://example.com
npm run crawl -- https://a.com https://b.com --depth 2 --max 50 --out report.json
npm run crawl -- https://example.com --all-domains --no-robots --concurrency 8
```

The crawler respects `robots.txt` and per-host politeness delays, normalizes and
de-duplicates URLs, and retries transient failures with backoff.

## Scripts

- `npm run dev` — start with hot reload (tsx)
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run the compiled server from `dist/`
- `npm run typecheck` — type-check without emitting
- `npm run lint` — lint
- `npm run format` — format with Prettier
- `npm test` — run the unit test suite (node:test via tsx)
- `npm run worker` — run a standalone crawl worker (needs REDIS_URL)
- `npm run crawl -- <url> [flags]` — standalone crawler CLI (no DB)
- `npm run embed -- [--limit N]` — backfill embeddings for stored pages
- `npm run db:migrate` — apply pending SQL migrations
- `npm run db:reset` — drop schema and re-migrate (dev only)

## Scaling & resilience (Redis)

Set `REDIS_URL` to unlock three things (all optional — everything degrades
gracefully to single-node behaviour when it's unset):

- **Async crawl queue (BullMQ).** `POST /crawl` returns `202 + jobId`; a worker
  processes it with retry/backoff and reports progress; poll `GET /crawl/:jobId`.
  The API runs a worker in-process (`QUEUE_RUN_IN_PROCESS=true`); for scale, set
  that false and run one or more `npm run worker` processes.
- **Caching.** Search/answer/embedding/suggest results are cached and invalidated
  automatically on crawl via an index-version key — no manual cache busting.
- **Distributed rate limiting.** Uses a Redis store so limits hold across API
  instances.

External calls (OpenAI embeddings + chat) are wrapped in retry-with-backoff for
transient failures (429/5xx/network).
