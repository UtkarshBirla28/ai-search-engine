# src/db — database access layer

Owns the Postgres connection and schema. **Nothing outside `db/` and
`repositories/` should import `pg` or write SQL.**

## Files

- `pool.ts` — lazy singleton `pg.Pool`. Exports `query()` (pool-level), `withTransaction(fn)` (runs `fn` with a dedicated client between BEGIN/COMMIT, ROLLBACK on throw), `getPool`, `ping`, `closePool`, and the `Queryable` type.
- `migrate.ts` — dependency-free runner. Applies `migrations/*.sql` in filename order, each in its own transaction, recorded in `schema_migrations`. `--reset` drops and re-applies.
- `index.ts` — barrel exports.

## Rules

- **`Queryable`** is `Pick<PoolClient, 'query'>` — satisfied by both the pool and a transaction client. Repositories take a `Queryable` in their constructor so the same method works standalone *or* inside `withTransaction`.
- **Migrations are append-only and immutable.** Never edit a migration that has shipped; add a new numbered file (`002_*.sql`, `003_*.sql`). The runner only reads top-level `migrations/*.sql` — `migrations/optional/` is ignored (that's where the pgvector migration lives until activated).
- **`DATABASE_URL` unset ⇒ DB disabled.** `getPool()` throws a clear error; `isDatabaseConfigured()` lets callers degrade gracefully (e.g. health endpoint reports `not-configured` instead of failing).
- Full-text lives in the schema, not in code: the `pages.search_vector` **generated column** does tokenize + stopwords + stemming via the `'english'` config. Change ranking/analysis by altering the column in a new migration, not in TS.
- All queries are **parameterized** (`$1, $2, …`) — never string-interpolate user input.
