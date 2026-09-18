# AI Search Engine

A from-scratch, full-stack **AI search engine**: it crawls the web, indexes pages
in Postgres, and searches them with **hybrid keyword + semantic** ranking — then
puts a **Perplexity-style AI answer with citations** on top.

- **Backend** — Node + Express + TypeScript. Real web crawler, Postgres full-text
  search (`tsvector`/`ts_rank_cd`), `pg_trgm` fuzzy, **pgvector** semantic search,
  and single-query Reciprocal-Rank-Fusion hybrid ranking. Cited answers via OpenAI
  (with a non-LLM extractive fallback). **Redis** powers an async crawl **job
  queue** (BullMQ), response **caching**, and **distributed rate limiting**.
- **Frontend** — Next.js 16 (App Router, TypeScript, Tailwind v4). Search UI with
  an AI answer box, inline citations, autocomplete, mode toggle
  (auto/hybrid/semantic/keyword), pagination, and an admin page that crawls sites
  with a **live progress bar**.

```
ai_search_engine/
├── backend/          # Express REST API — crawler, search, embeddings, AI answers, queue
├── frontend/         # Next.js UI
├── docker-compose.yml# full stack: Postgres (pgvector) + Redis + backend + worker + frontend
└── .github/workflows/# CI: typecheck, lint, test, build, migrate
```

### Scale / resilience (all gracefully degrade with no Redis)

- **Async crawling** — `POST /crawl` enqueues a BullMQ job and returns a `jobId`;
  workers crawl+embed in the background with retries; poll `GET /crawl/:jobId` for
  live progress. Run more workers with `docker compose up --scale worker=3`.
- **Caching** — search/answer/embedding results are cached in Redis and invalidated
  automatically when a crawl changes the corpus (index-version keys).
- **Distributed rate limiting** — Redis-backed, so limits hold across API instances.
- **Fault tolerance** — retry-with-backoff on OpenAI calls; every Redis/AI feature
  degrades cleanly when unavailable (sync crawl, no cache, extractive answers).

## Quick start (Docker — the whole stack)

```bash
docker compose up --build
# frontend → http://localhost:3000   backend → http://localhost:5000/api/v1
```

Runs out of the box with **offline `hash` embeddings** and **extractive answers**
(no API key needed). To enable OpenAI semantic search + LLM answers, create a
`.env` next to `docker-compose.yml`:

```env
OPENAI_API_KEY=sk-...
EMBEDDING_PROVIDER=openai
EMBEDDING_DIM=1536
LLM_PROVIDER=openai
```

## Quick start (local dev)

```bash
npm install && npm run install:all      # root tool + backend + frontend deps

# 1) Database (pgvector)
cd backend && docker compose up -d      # Postgres on :5432 (POSTGRES_PORT to override)
cp .env.example .env                     # defaults match docker-compose
npm run db:migrate

# 2) Run both apps (from repo root)
cd .. && npm run dev
# frontend → http://localhost:3000   backend → http://localhost:5000
```

Then open the app, go to **Index sites** (`/admin`), crawl e.g.
`https://quotes.toscrape.com`, and search.

## API

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET  | `/api/v1/health` | Liveness + DB/Redis/queue/AI status |
| GET  | `/api/v1/search?q=…&mode=&page=&limit=` | Search: `mode` = `auto`\|`hybrid`\|`semantic`\|`fulltext`\|`fuzzy` |
| GET  | `/api/v1/answer?q=…&mode=&maxSources=` | Retrieve top pages and synthesize a **cited** AI answer |
| GET  | `/api/v1/suggest?q=…` | Autocomplete over indexed titles |
| POST | `/api/v1/crawl` | Crawl → parse → embed → store. Returns `202 + jobId` when the queue is on, else a sync report |
| GET  | `/api/v1/crawl/:jobId` | Async crawl job status / progress / result |

See [`backend/README.md`](./backend/README.md) for the full backend guide and
[`backend/CLAUDE.md`](./backend/CLAUDE.md) for architecture/conventions.

## Documentation & diagrams

- **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)** — full architecture doc with
  flowcharts (system, query, indexing, data model, request lifecycle) as Mermaid.
- **[`docs/architecture.html`](./docs/architecture.html)** — interactive, themed
  visual version of the diagrams (open in a browser).
- **[`docs/diagrams/`](./docs/diagrams/)** — SVG image exports
  ([architecture](./docs/diagrams/architecture.svg) · [request flows](./docs/diagrams/flow.svg)).

## How the AI search works

1. **Crawl** — a polite crawler (robots.txt, per-host delays, dedup) fetches and
   parses pages, storing title/description/body + link graph in Postgres.
2. **Index** — each page gets a `tsvector` (keyword) and a **vector embedding**
   (semantic), indexed with GIN and HNSW respectively.
3. **Retrieve** — full-text and vector search run in parallel; results are fused
   with **Reciprocal Rank Fusion** (hybrid), with a fuzzy fallback for typos.
4. **Answer** — the top sources are handed to an LLM to write a concise, **cited**
   answer; with no API key it falls back to an extractive summary.
