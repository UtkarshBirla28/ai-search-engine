# CLAUDE.md

Guidance for Claude Code (and humans) working in this backend. Read this first — it is the single source of truth for how the project is wired, the conventions to follow, and the traps to avoid.

## What this is

Node.js + Express + **TypeScript** REST API for the AI Search Engine. Clean, layered architecture. ESM throughout (`"type": "module"`). It **crawls web pages, stores them in Postgres, and searches them** with real full-text ranking (and typo-tolerant fuzzy fallback). Semantic/vector search is designed-in but not yet enabled (see "Search subsystem").

- Node `>=18` (developed/tested on Node 22).
- Package manager: **npm** (there is a `package-lock.json`).
- Platform note: development happens on **Windows / PowerShell**. Prefer cross-platform commands.
- **Postgres** is the datastore (via `pg`). Full-text search is native Postgres (`tsvector` + GIN); fuzzy is `pg_trgm`. Local dev DB via `docker-compose.yml`.
- **Persistence is optional at boot**: with `DATABASE_URL` unset the server still runs, but `/crawl` and `/search` return 503 / errors. `/health` reports `database: up|down|not-configured`.

## Commands

```bash
npm run dev        # hot-reload dev server via tsx (runs src/*.ts directly, no build step)
npm run build      # tsc → compiles src/ to dist/
npm start          # node dist/server.js (run build first)
npm run typecheck  # tsc --noEmit — fast type-only check
npm run lint       # eslint . (typescript-eslint, flat config)
npm run lint:fix   # eslint . --fix
npm run format     # prettier --write "src/**/*.ts"
npm run crawl -- <url> [flags]   # standalone crawler CLI (no DB)
npm run db:migrate # apply migrations/*.sql (idempotent)
npm run db:reset   # DROP schema + re-migrate (dev only)
```

### Database setup (local)

```bash
docker compose up -d           # Postgres (pgvector image) on :5432
# If 5432 is taken: POSTGRES_PORT=5433 docker compose up -d  (and match DATABASE_URL)
cp .env.example .env           # DATABASE_URL points at the compose DB
npm run db:migrate             # create tables + indexes
```

**Before considering any change done, run `npm run typecheck && npm run lint && npm run build` — all three must exit 0.** There are no automated tests yet; verify behavior by running the server and hitting the endpoints (see below).

### Manual smoke test

```bash
docker compose up -d && npm run db:migrate         # ensure DB + schema
npm run build && PORT=5055 node dist/server.js      # or: PORT=5055 npm run dev
# then, in another shell:
curl -s localhost:5055/                            # API info
curl -s localhost:5055/api/v1/health               # health probe (database: up)
curl -s -X POST localhost:5055/api/v1/crawl -H 'Content-Type: application/json' \
  -d '{"urls":["https://quotes.toscrape.com"],"maxDepth":1,"maxPages":6}'   # crawl+store
curl -s "localhost:5055/api/v1/search?q=love&limit=3"    # real full-text search
curl -s localhost:5055/api/v1/search               # 400 — missing required q
curl -s localhost:5055/nope                        # 404 envelope
```

## Architecture & request flow

Layered, one direction of dependency: **routes → controllers → services**. Cross-cutting concerns live in `middlewares/`, `config/`, `utils/`, and `validators/`.

```
HTTP request
  → app.ts            helmet, cors, compression, body parsers, morgan, rateLimiter
  → routes/index.ts   mounts /health, /search, /crawl under env.apiPrefix (/api/v1)
  → validate(schema)  middleware: Zod-parses & COERCES req.query/body/params in place
  → controller        thin; unwraps validated input, calls a service, sends envelope
  → service           business logic (search.service, ingest.service)
  → repositories      data access (all SQL) → db/pool (Postgres)
  → errorHandler      last middleware; turns thrown errors into the JSON error envelope
```

### Directory map (`src/`)

| Path | Responsibility |
| --- | --- |
| `config/env.ts` | Loads `.env` (dotenv), exports typed `env` object + `required()` helper. **All config reads go through here — never read `process.env` elsewhere.** |
| `config/logger.ts` | Winston logger (dev: colorized text, prod: JSON). Exports `logger` (default) + `httpLogStream` for morgan. |
| `controllers/` | Thin request handlers. Wrapped in `asyncHandler`. No business logic. |
| `middlewares/` | `errorHandler.ts` (+ `notFoundHandler`), `validate.ts`, `rateLimiter.ts`. |
| `routes/` | Route wiring only. `index.ts` is the aggregator mounted at `env.apiPrefix`. |
| `db/` | Postgres pool, transaction helper, migration runner. **SQL only lives here + `repositories/`.** Has its own `CLAUDE.md`. |
| `repositories/` | Data access (Repository pattern). `page.repository.ts` (upsert + FTS/fuzzy search), `link.repository.ts` (link graph). Returns camelCase domain types. Has its own `CLAUDE.md`. |
| `services/` | Business logic. `search.service.ts` (real Postgres FTS), `ingest.service.ts` (crawl→persist orchestration), `crawler/` self-contained crawler module (see below). |
| `scripts/` | Standalone runnable entrypoints (via tsx), e.g. `crawl.ts` CLI. Not part of the HTTP server. |
| `migrations/` (repo root) | Versioned `*.sql`, applied in filename order. `migrations/optional/` holds not-auto-applied ones (pgvector). |
| `utils/` | `ApiError.ts` (typed operational error), `asyncHandler.ts` (promise→next wrapper). |
| `validators/` | Zod schemas; each exports the schema **and** a `z.infer` type. |
| `app.ts` | Express app assembly + middleware order. Exported without `.listen()` (testable). |
| `server.ts` | Bootstrap: `.listen()`, graceful shutdown, process-level error handlers. |

## Conventions (follow these — the codebase is consistent)

- **ESM + NodeNext**: relative imports **must** carry a `.js` extension even though the source is `.ts` (e.g. `import env from './config/env.js'`). This is required by `moduleResolution: NodeNext` and is what tsx/tsc both expect. Do not drop the extension.
- **TypeScript is `strict`**, plus `noUnusedLocals` / `noUnusedParameters`. Prefix intentionally-unused params with `_` (e.g. `_req`, `_next`) — both TS and ESLint ignore the `_` prefix.
- **Response envelope — always use it.** Success: `{ success: true, data: ... }`. Error (emitted only by `errorHandler`): `{ success: false, error: { message, details?, stack? } }`. `stack` is included only when not production.
- **Errors**: throw `ApiError` (or its static helpers `ApiError.badRequest/unauthorized/forbidden/notFound/internal`). Never call `res` from a service. Anything non-`ApiError` reaching the handler becomes a 500 with `isOperational: false`.
- **Async controllers/handlers must be wrapped in `asyncHandler`** so rejected promises reach Express' error pipeline instead of crashing the process.
- **Validation**: define a Zod schema in `validators/`, apply it via `validate({ query|body|params: schema })` in the route. `validate` **replaces** `req[segment]` with the parsed/coerced value, so read coerced values (numbers, defaults) directly. In the controller, cast with the inferred type: `req.query as unknown as SearchQuery`.
- **Config**: add new settings to the `Env` interface + `env` object in `config/env.ts`, and document them in `.env.example`. Provide sane fallbacks; use `required()` for values that must exist.
- **Logging**: use `logger` from `config/logger.ts`. Do not `console.log` in committed code (lint allows it, but the logger is the convention).
- **Style**: Prettier — single quotes, semicolons, `printWidth` 100, 2-space indent, `trailingComma: es5`. Run `npm run format`.

## How to add a feature (worked example: a new endpoint)

1. **Validator** — `src/validators/<name>.validator.ts`: export a Zod schema + `export type X = z.infer<typeof schema>`.
2. **Service** — `src/services/<name>.service.ts`: pure business logic, typed params/returns, throws `ApiError` on failure.
3. **Controller** — `src/controllers/<name>.controller.ts`: `asyncHandler` wrapper, read validated input, call service, send `{ success: true, data }`.
4. **Route** — `src/routes/<name>.routes.ts`: `router.get('/', validate({...}), handler)`.
5. **Mount** — add `router.use('/<name>', <name>Routes)` in `src/routes/index.ts`.
6. Update `.env.example` if you added config, and add the endpoint to the README table.
7. `npm run typecheck && npm run lint && npm run build`, then smoke-test with curl.

## Data & search subsystem

Flow: **`POST /crawl` → `ingest.service.crawlAndStore` → crawler fetches/parses → each page persisted (page + link graph) in a transaction → `GET /search` → `search.service` → `PageRepository` → Postgres FTS.**

- **Persistence layers** (see the nested `CLAUDE.md` in `src/db/` and `src/repositories/`): `db/` owns the pool + migrations; `repositories/` own all SQL. Services never import `pg` or write SQL.
- **`ingest.service.ts`** decouples crawling from storage: the crawler stays pure (returns a `CrawlReport`); ingest maps each `CrawlResult` → `NewPage` (+ links) and upserts. Variable per-page extras (og tags, headings, images, canonical) go in the `metadata` **JSONB** column; stable fields are real columns.
- **Full-text search is native Postgres.** The `pages.search_vector` **generated column** does tokenize + stopword-removal + snowball **stemming** (via the `'english'` config), weighted title(A)/description(B)/body(C), indexed with GIN. `PageRepository.searchFullText` ranks with `ts_rank_cd` and builds `<mark>` snippets with `ts_headline`. **We deliberately do not hand-roll tokenizer/stemmer/stopword code** — the DB does it, indexed.
- **Fuzzy/typo "similar"** = `pg_trgm` trigram similarity (`searchFuzzy`), used as the `auto`-mode fallback when full-text finds nothing.
- **Semantic "similar" (vectors)** is designed-in but OFF: `migrations/optional/002_embeddings.sql` adds a `pgvector` column + HNSW index. Activating it needs (1) the `vector` extension in the DB image (the compose pgvector image has it) and (2) an embedding provider (local transformers.js, or hosted Voyage/OpenAI). Then add `PageRepository.searchSemantic` and fuse with FTS via reciprocal-rank fusion.

## Crawler module (`services/crawler/`)

Self-contained, dependency-light web crawler. Stack: native `fetch` (download),
**cheerio** (parse), **p-limit** (concurrency), **robots-parser** (robots.txt).
Entry point: `crawl(urls, overrides)` → `CrawlReport`. Exposed as `POST /api/v1/crawl`
and the `npm run crawl` CLI (`scripts/crawl.ts`).

File responsibilities:

- `types.ts` — `CrawlOptions`, `ParsedPage`, `CrawlResult`, `CrawlReport`.
- `urlUtils.ts` — URL normalization (drops fragments/tracking params, tidies slashes) → **this is what makes dedup work**; also scope helpers (`sameSite` treats `www.` as equal).
- `fetcher.ts` — `fetch` with per-attempt timeout (`AbortSignal.timeout`), retry+backoff on 408/429/5xx/network, 8 MB body cap, reads only textual content types.
- `parser.ts` — cheerio extraction; strips script/style before text; resolves links/images to absolute via `<base>`/final URL; text capped at 20k chars.
- `robots.ts` — `RobotsCache`, one robots.txt fetch per origin (cached); unreachable/404 ⇒ allow-all.
- `crawler.ts` — BFS engine: `visited` Set (normalized) for dedup, `p-limit` concurrency, per-host politeness spacing (`max(delayMs, crawl-delay)`), depth + maxPages caps, same-domain scoping. `defaultOptions()` holds the defaults.

Also `sitemap.ts` — discovers URLs via robots.txt `Sitemap:` entries + `/sitemap.xml`, recurses `<sitemapindex>` files, handles gzip (`fast-xml-parser`). Used when `POST /crawl` is called with `useSitemap: true`.

Conventions when extending it: keep `crawl()`'s signature stable; add new tunables to `CrawlOptions` **and** the Zod `crawlBodySchema` **and** `defaultOptions()`; add new extracted fields to `ParsedPage` and populate them in `parseHtml`. Be a good citizen — don't remove robots/politeness handling.

Design note: crawls run **synchronously** within the HTTP request and are bounded by `maxPages`/`maxDepth`/`timeoutMs`. For large crawls this should move to a background job/queue (BullMQ + Redis) — it is intentionally simple for now.

## Traps & gotchas

- **Don't remove `.js` from imports** — builds and dev both break without it.
- **`@types/express` is pinned to v4** to match Express 4. Do **not** bump it to v5; the runtime is Express 4 and v5 types cause signature errors.
- **`errorHandler` must stay the last `app.use`**, and it must keep its 4-arg signature (`err, req, res, _next`) or Express won't recognize it as an error handler.
- **`dist/` is generated** and git-ignored — never edit compiled output; edit `src/` and rebuild.
- **`.env` is git-ignored**; `.env.example` is the committed template — keep them in sync.
- **Migrations are append-only & immutable** — never edit a shipped `migrations/*.sql`; add a new numbered file. The runner only auto-applies top-level `migrations/*.sql` (not `optional/`).
- **All SQL lives in `db/` + `repositories/`** — never write `pg`/SQL in a service or controller. All queries parameterized (`$1,$2`), never string-interpolated.
- **`@types/pg` matches `pg` v8.** Repositories accept a `Queryable` so they work on the pool or a transaction client — pass the client inside `withTransaction`.
- **Local Postgres port**: `docker-compose.yml` defaults to 5432; override with `POSTGRES_PORT` if a native Postgres already holds it, and keep `DATABASE_URL` in sync.
- No test runner is configured yet. If you add one, wire it into an `npm test` script and reference it here.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/` | API info |
| GET | `/api/v1/health` | Health/liveness probe (+ `database` status) |
| GET | `/api/v1/search?q=…&page=&limit=&mode=` | Full-text search over stored pages (`mode` = `auto`\|`fulltext`\|`fuzzy`) |
| POST | `/api/v1/crawl` | Crawl → parse → **persist** URLs (body: `urls`, `maxDepth`, `maxPages`, `useSitemap`, …) |

Base path is `env.apiPrefix` (`/api/v1` by default).
