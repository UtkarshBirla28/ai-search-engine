/**
 * Minimal, dependency-free migration runner.
 *
 *   npm run db:migrate          apply all pending migrations
 *   npm run db:migrate -- --reset   DROP everything, then re-apply (dev only)
 *
 * Migrations are plain .sql files in <root>/migrations, applied in filename
 * order and recorded in `schema_migrations`. Each file runs in its own
 * transaction, so a failure leaves the database on the last good version.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { closePool, getPool } from './pool.js';

const MIGRATIONS_DIR = path.resolve(fileURLToPath(new URL('../../migrations', import.meta.url)));

/**
 * Substitute `${VAR}` placeholders in migration SQL from a small, explicit
 * allow-list. Currently only the embedding vector dimension, which must be baked
 * into the `vector(N)` column DDL at migration time (pgvector needs a literal).
 */
const substituteVars = (sql: string): string =>
  sql.replace(/\$\{EMBEDDING_DIM\}/g, String(env.embedding.dimension));

const ensureMigrationsTable = async (): Promise<void> => {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
};

const appliedVersions = async (): Promise<Set<string>> => {
  const { rows } = await getPool().query<{ version: string }>(
    'SELECT version FROM schema_migrations'
  );
  return new Set(rows.map((r) => r.version));
};

const listMigrationFiles = async (): Promise<string[]> => {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((f) => f.endsWith('.sql')).sort();
};

/** Apply every migration that hasn't been recorded yet. */
export const runMigrations = async (): Promise<number> => {
  await ensureMigrationsTable();
  const applied = await appliedVersions();
  const files = await listMigrationFiles();
  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    logger.info('Migrations up to date.');
    return 0;
  }

  const pool = getPool();
  for (const file of pending) {
    const sql = substituteVars(await readFile(path.join(MIGRATIONS_DIR, file), 'utf8'));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await client.query('COMMIT');
      logger.info(`Applied migration: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`Migration failed: ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }
  return pending.length;
};

/** Drop the public schema and re-apply everything. Destructive — dev only. */
export const resetDatabase = async (): Promise<void> => {
  logger.warn('Resetting database: DROP SCHEMA public CASCADE');
  await getPool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await runMigrations();
};

// Executed directly via `tsx src/db/migrate.ts`.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const reset = process.argv.includes('--reset');
  (reset ? resetDatabase() : runMigrations())
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error(err);
      void closePool().finally(() => process.exit(1));
    });
}
