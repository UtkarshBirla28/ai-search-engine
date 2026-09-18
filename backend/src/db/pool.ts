import pg from 'pg';
import env from '../config/env.js';
import logger from '../config/logger.js';

const { Pool } = pg;

/**
 * Anything that can run a parameterized query — the shared pool OR a single
 * client bound to a transaction. Repositories accept this so the exact same
 * code runs inside and outside a transaction.
 */
export type Queryable = Pick<pg.PoolClient, 'query'>;

let pool: pg.Pool | null = null;

/** Lazily create the shared connection pool. Throws if DB isn't configured. */
export const getPool = (): pg.Pool => {
  if (pool) return pool;

  if (!env.database.url) {
    throw new Error(
      'DATABASE_URL is not set. Configure Postgres (see .env.example) to use DB-backed features.'
    );
  }

  pool = new Pool({
    connectionString: env.database.url,
    max: env.database.poolMax,
    ssl: env.database.ssl ? { rejectUnauthorized: false } : undefined,
    idleTimeoutMillis: env.database.idleTimeoutMs,
    connectionTimeoutMillis: env.database.connectionTimeoutMs,
  });

  // A pool-level error (e.g. an idle client dropped by the server) must never
  // crash the process; log it and let the pool recover.
  pool.on('error', (err) => {
    logger.error('Unexpected idle Postgres client error', err);
  });

  logger.info(`Postgres pool initialized (max=${env.database.poolMax})`);
  return pool;
};

/** Run a parameterized query against the shared pool. */
export const query = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: readonly unknown[]
): Promise<pg.QueryResult<T>> => getPool().query<T>(text, params as unknown[]);

/**
 * Run `fn` inside a transaction, committing on success and rolling back on any
 * error. The callback receives a dedicated client — pass it to repositories so
 * every statement runs on the same connection.
 */
export const withTransaction = async <T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/** True if a database connection string is configured. */
export const isDatabaseConfigured = (): boolean => Boolean(env.database.url);

/** Liveness probe used by the health endpoint. */
export const ping = async (): Promise<boolean> => {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
};

/** Close the pool during graceful shutdown. Safe to call when never opened. */
export const closePool = async (): Promise<void> => {
  if (!pool) return;
  await pool.end();
  pool = null;
  logger.info('Postgres pool closed.');
};
