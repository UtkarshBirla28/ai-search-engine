# AI Search Engine — Architecture & Documentation

A from-scratch, full-stack AI search engine: it **crawls** the web, **indexes** pages
in Postgres, **searches** them with hybrid keyword + semantic ranking, and answers
questions with a **cited AI answer**. Redis adds an async job queue, caching, and
distributed rate limiting. Everything degrades gracefully when optional
dependencies (Redis, an LLM key) are absent.

- **Frontend:** Next.js 16 (App Router) · React 19 · Tailwind v4
- **Backend:** Node · Express · TypeScript (ESM) · layered architecture
- **Data:** Postgres 16 + **pgvector** (FTS + vectors + link graph)
- **Infra:** Redis (BullMQ queue · cache · rate limit) · OpenAI (embeddings + chat)

> 🚀 **Live demo:** [web app](https://ai-search-engine-utkarshs-projects-621a47b8.vercel.app) · [API health](https://ai-search-engine-api-tz9f.onrender.com/api/v1/health) — deployed on Vercel + Render + Neon. See the [README](../README.md) for quick start.

> 📊 **Visual version:** open [`architecture.html`](./architecture.html) in a browser for
> interactive, themed diagrams. Image exports live in [`diagrams/`](./diagrams/).

![System architecture](./diagrams/architecture.svg)

![Request flows: indexing and query](./diagrams/flow.svg)

---

## 1. System architecture

```mermaid
flowchart LR
  subgraph client["Client"]
    UI["Next.js UI<br/>search · AI answer · admin"]
  end

  subgraph api["Express API (/api/v1)"]
    RT["Routes → Controllers<br/>Zod validation"]
    SVC["Services<br/>search · answer · ingest · embeddings"]
    REPO["Repositories<br/>(all SQL)"]
  end

  WK["Crawl Worker<br/>BullMQ consumer"]

  subgraph data["Data & Infra"]
    PG[("Postgres + pgvector<br/>pages · links · vectors")]
    RD[("Redis<br/>queue · cache · rate-limit")]
  end

  OAI["OpenAI<br/>embeddings + chat"]

  UI -->|"HTTP JSON"| RT --> SVC --> REPO --> PG
  SVC -->|"cache / query embed"| RD
  SVC -->|"embeddings · answers"| OAI
  RT -->|"enqueue crawl job"| RD
  RD -->|"consume jobs"| WK
  WK --> SVC
  WK --> OAI

  classDef store fill:#0891b2,stroke:#0e7490,color:#fff;
  classDef ext fill:#d97706,stroke:#b45309,color:#fff;
  class PG,RD store;
  class OAI ext;
```

**One direction of dependency** inside the API: `routes → controllers → services →
repositories → db`. All SQL lives in `repositories/` + `db/`; services never touch
`pg`. The worker reuses the exact same services as the API — the queue only changes
*when* work runs, not *how*.

---

## 2. Search & answer request flow

Search resolves `mode` (`auto` picks hybrid when embeddings are on), checks the
cache, and fuses keyword + vector ranking in a single SQL query.

```mermaid
flowchart TD
  Q["GET /search?q&mode&page"] --> C{"Redis cache hit?<br/>(key includes index version)"}
  C -->|hit| RESP["Return cached response"]
  C -->|miss| M{"resolve mode"}

  M -->|fulltext| FT["Postgres FTS<br/>ts_rank_cd over tsvector"]
  M -->|fuzzy| FZ["pg_trgm<br/>word_similarity (typos)"]
  M -->|semantic / hybrid / auto| E{"query embedding<br/>(cached per model)"}

  E -->|semantic| SE["vector KNN<br/>embedding <=> query (HNSW)"]
  E -->|hybrid| H["searchHybrid — ONE SQL query<br/>FTS ⋃ vector, fused by RRF<br/>accurate total"]

  FT --> OUT["ranked hits + &lt;mark&gt; snippets"]
  FZ --> OUT
  SE --> OUT
  H --> OUT
  OUT --> SET["cache (TTL + index version)"] --> RESP

  classDef warn fill:#0891b2,stroke:#0e7490,color:#fff;
  class H warn;
```

### AI answer (RAG)

```mermaid
flowchart TD
  AQ["GET /answer?q"] --> CA{"cache hit?"}
  CA -->|hit| AR["cited answer + sources"]
  CA -->|miss| S["hybrid search → top-K sources"]
  S --> CT["fetch page content (context)"]
  CT --> K{"OPENAI_API_KEY set?"}
  K -->|yes| LLM["OpenAI chat<br/>answer with [n] citations<br/>retry + backoff"]
  K -->|no| EX["extractive summary<br/>best query-matching sentences"]
  LLM --> A["answer + numbered sources"]
  EX --> A
  A --> SETA["cache"] --> AR

  classDef ext fill:#d97706,stroke:#b45309,color:#fff;
  class LLM ext;
```

---

## 3. Async crawl & indexing pipeline

`POST /crawl` enqueues a job and returns immediately; a worker crawls, parses,
stores, and embeds — reporting live progress. Falls back to a synchronous crawl
when the queue is disabled.

```mermaid
flowchart TD
  P["POST /crawl (urls, depth, maxPages)"] --> QE{"queue enabled?<br/>(Redis present)"}
  QE -->|no| SYNC["run inline"] --> REPORT
  QE -->|yes| ENQ["enqueue BullMQ job"] --> R202["202 Accepted + jobId"]
  R202 -.->|"poll GET /crawl/:jobId"| ST["status + progress"]

  ENQ ==>|"worker picks up"| WK["Crawl Worker"]
  WK --> CR["Crawl engine<br/>robots.txt · BFS · dedup · politeness · retry"]
  CR --> PA["Parse (cheerio)<br/>title · text · links · metadata"]
  PA --> STORE[("Upsert page + link graph<br/>Postgres transaction")]
  STORE --> EM["Embed pages → pgvector<br/>(batched, best-effort)"]
  EM --> BV["Bump index version<br/>→ invalidates cached results"]
  BV --> REPORT["Report: crawled / stored / embedded"]
  WK -.->|"progress: crawling→storing→embedding→done"| ST

  classDef store fill:#0891b2,stroke:#0e7490,color:#fff;
  class STORE store;
```

Scale by running more workers: `docker compose up --scale worker=3`. Each worker is
stateless and pulls from the shared Redis queue.

---

## 4. Data model

```mermaid
erDiagram
  PAGES ||--o{ LINKS : "has outbound"
  PAGES {
    bigint id PK
    text url UK "normalized (dedup key)"
    text title
    text description
    text content_text
    tsvector search_vector "generated, GIN index"
    vector embedding "HNSW cosine index"
    text embedding_model "detect provider change"
    jsonb metadata "og, headings, images"
    timestamptz crawled_at
  }
  LINKS {
    bigint from_page_id FK
    text to_url "reverse-lookup indexed"
  }
```

- **`search_vector`** is a *generated* column: Postgres tokenizes, removes
  stopwords, and stems (snowball) with weights title(A) > description(B) > body(C).
  We deliberately don't hand-roll a tokenizer/stemmer — the DB does it, indexed.
- **`embedding`** is a pgvector column (dimension = the active provider's). HNSW
  index enables fast approximate nearest-neighbour by cosine distance.
- **`links`** stores the outbound link graph (basis for future authority ranking).

---

## 5. How hybrid ranking works (RRF)

Keyword and semantic search each return a *ranked list*. **Reciprocal Rank Fusion**
combines them using only positions — no score calibration needed:

```
score(doc) = Σ  1 / (k + rank_in_list)      # k = 60
```

A document ranked #1 by keyword *and* #2 by vectors beats one that's #1 in only a
single list. This runs in **one SQL query** (`PageRepository.searchHybrid`): two
CTEs (`ts_rank_cd` and `embedding <=>`) rank the corpus, a third groups and sums the
RRF contributions, and the outer query joins back for snippets and an accurate total.

---

## 6. Request lifecycle (middleware order)

```mermaid
flowchart LR
  IN["request"] --> H["helmet"] --> CO["cors"] --> CMP["compression"]
  CMP --> BP["body parser"] --> LOG["morgan"] --> RL["rate limiter<br/>(Redis or in-memory)"]
  RL --> RTS["routes → validate(zod) → controller → service"]
  RTS --> ERR["errorHandler → JSON envelope"]
```

All responses use one envelope: `{ success: true, data }` or
`{ success: false, error: { message } }`.

---

## 7. Resilience & graceful degradation

| Optional dependency | Present | Absent (fallback) |
| --- | --- | --- |
| **Redis** | async queue, caching, distributed rate limit | sync crawl, no cache, in-memory rate limit |
| **OpenAI key** | LLM answers, OpenAI embeddings | extractive answers, local/hash embeddings |
| **Embeddings (`none`)** | semantic + hybrid search | keyword + fuzzy only |
| **Database** | crawl + search | server boots; `/health` reports `not-configured` |

Other resilience measures: retry-with-backoff on all OpenAI calls; BullMQ job
retries with exponential backoff; crawler retries transient HTTP with backoff;
embedding failures never fail a crawl (pages stay searchable lexically, backfill
later with `npm run embed`); DB pool errors are isolated; graceful shutdown drains
the worker, queue, pool, and Redis.

---

## 8. Tech stack & key files

| Concern | Choice | Where |
| --- | --- | --- |
| API | Express + TS (ESM) | `backend/src/app.ts`, `routes/` |
| Crawler | fetch + cheerio + p-limit + robots-parser | `services/crawler/` |
| Keyword search | Postgres FTS (`tsvector`/`ts_rank_cd`) | `repositories/page.repository.ts` |
| Fuzzy | `pg_trgm` `word_similarity` | `repositories/page.repository.ts` |
| Semantic | pgvector + HNSW | migration `002`, `searchSemantic` |
| Embeddings | OpenAI / local / hash / none | `services/embeddings/` |
| Hybrid | RRF in SQL | `searchHybrid`, `services/search.service.ts` |
| AI answer | OpenAI chat + extractive fallback | `services/answer.service.ts` |
| Queue | BullMQ + Redis | `queue/`, `worker.ts` |
| Cache | Redis, index-version invalidation | `services/cache.ts` |
| Rate limit | express-rate-limit (+ Redis store) | `middlewares/rateLimiter.ts` |
| Frontend | Next.js 16 + Tailwind v4 | `frontend/src/` |

---

## 9. API reference

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/health` | Liveness + DB/Redis/queue/AI status |
| GET | `/api/v1/search?q&mode&page&limit` | `mode` = auto\|hybrid\|semantic\|fulltext\|fuzzy |
| GET | `/api/v1/answer?q&mode&maxSources` | Cited AI answer (RAG) |
| GET | `/api/v1/suggest?q&limit` | Title autocomplete |
| POST | `/api/v1/crawl` | Crawl → embed → store (202 + jobId, or sync report) |
| GET | `/api/v1/crawl/:jobId` | Async job status / progress / result |

See [`../README.md`](../README.md) for quick start and [`../backend/CLAUDE.md`](../backend/CLAUDE.md)
for backend conventions.
