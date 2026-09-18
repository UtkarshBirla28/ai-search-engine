import dotenv from 'dotenv';

dotenv.config();

export const required = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const bool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : /^(1|true|yes|on)$/i.test(value);

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

export interface DatabaseConfig {
  /** Postgres connection string. Undefined ⇒ DB features are disabled. */
  url: string | undefined;
  /** Max clients in the pool. */
  poolMax: number;
  /** Enable TLS (needed by most hosted providers, e.g. Neon/Supabase). */
  ssl: boolean;
  /** ms a client may sit idle before being closed. */
  idleTimeoutMs: number;
  /** ms to wait for a connection before erroring. */
  connectionTimeoutMs: number;
}

export interface SearchConfig {
  /** Postgres text-search configuration (drives stemming + stopwords). */
  language: string;
  /** Below this trigram similarity, fuzzy matches are discarded (0–1). */
  fuzzyThreshold: number;
  /** Default search mode when the client doesn't specify one. */
  defaultMode: 'auto' | 'fulltext' | 'fuzzy' | 'semantic' | 'hybrid';
  /** Reciprocal-rank-fusion constant (k) used to fuse lexical + semantic ranks. */
  rrfK: number;
  /** How many candidates to pull from each retriever before fusing. */
  candidatePool: number;
}

/** Which engine produces vector embeddings (and therefore the vector dimension). */
export type EmbeddingProvider = 'openai' | 'local' | 'hash' | 'none';

export interface EmbeddingConfig {
  /**
   * openai → text-embedding-3-* via OpenAI API (needs OPENAI_API_KEY).
   * local  → @xenova/transformers, runs on-device (optional dependency).
   * hash   → deterministic, dependency-free, offline. Low quality; for
   *          dev/CI so the hybrid pipeline works with no key and no download.
   * none   → semantic search disabled; lexical only.
   */
  provider: EmbeddingProvider;
  /** Model id (provider-specific). */
  model: string;
  /** Vector dimension. MUST match the `pages.embedding` column (migration 002). */
  dimension: number;
  /** Max texts per embedding request/batch. */
  batchSize: number;
}

export interface LlmConfig {
  /** openai → OpenAI Chat Completions. none → extractive (non-LLM) answers. */
  provider: 'openai' | 'none';
  apiKey: string | undefined;
  /** Chat model used to synthesize the AI answer. */
  model: string;
  /** Override the OpenAI-compatible base URL (e.g. Azure/OpenRouter). */
  baseUrl: string;
  /** Max sources fed to the answer synthesizer. */
  maxSources: number;
  /** Max characters of context per source. */
  maxContextChars: number;
  /** Sampling temperature for the answer. */
  temperature: number;
}

export interface RedisConfig {
  /** Redis connection string. Undefined ⇒ queue/cache/distributed-limit disabled. */
  url: string | undefined;
}

export interface CacheConfig {
  /** TTL (seconds) for cached search responses. */
  searchTtl: number;
  /** TTL (seconds) for cached AI answers. */
  answerTtl: number;
  /** TTL (seconds) for cached query embeddings (stable per model — can be long). */
  embeddingTtl: number;
}

export interface QueueConfig {
  /** Run crawls asynchronously via BullMQ when Redis is available. */
  enabled: boolean;
  /** Retry attempts for a failed crawl job. */
  attempts: number;
  /** Worker concurrency (jobs processed in parallel). */
  concurrency: number;
  /**
   * Also run the worker inside the API process (handy for `npm run dev` / single
   * container). In production prefer a separate `npm run worker` process.
   */
  runInProcess: boolean;
}

export interface Env {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  corsOrigin: string;
  logLevel: string;
  rateLimit: RateLimitConfig;
  database: DatabaseConfig;
  search: SearchConfig;
  embedding: EmbeddingConfig;
  llm: LlmConfig;
  redis: RedisConfig;
  cache: CacheConfig;
  queue: QueueConfig;
  isProduction: boolean;
}

/** Natural output dimension for each provider's default model. */
const DEFAULT_DIM: Record<EmbeddingProvider, number> = {
  openai: 1536, // text-embedding-3-small
  local: 384, // Xenova/all-MiniLM-L6-v2
  hash: 256,
  none: 0,
};

const embeddingProvider = (process.env.EMBEDDING_PROVIDER || 'hash').toLowerCase() as EmbeddingProvider;
const openaiApiKey = process.env.OPENAI_API_KEY || undefined;

const env: Env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  logLevel: process.env.LOG_LEVEL || 'info',
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX) || 100,
  },
  database: {
    url: process.env.DATABASE_URL,
    poolMax: Number(process.env.DATABASE_POOL_MAX) || 10,
    ssl: bool(process.env.DATABASE_SSL, false),
    idleTimeoutMs: Number(process.env.DATABASE_IDLE_TIMEOUT_MS) || 30_000,
    connectionTimeoutMs: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS) || 10_000,
  },
  search: {
    language: process.env.SEARCH_LANGUAGE || 'english',
    fuzzyThreshold: Number(process.env.SEARCH_FUZZY_THRESHOLD) || 0.2,
    defaultMode: (process.env.SEARCH_DEFAULT_MODE as SearchConfig['defaultMode']) || 'auto',
    rrfK: Number(process.env.SEARCH_RRF_K) || 60,
    candidatePool: Number(process.env.SEARCH_CANDIDATE_POOL) || 50,
  },
  embedding: {
    provider: embeddingProvider,
    model:
      process.env.EMBEDDING_MODEL ||
      (embeddingProvider === 'openai'
        ? 'text-embedding-3-small'
        : embeddingProvider === 'local'
          ? 'Xenova/all-MiniLM-L6-v2'
          : 'hash-256'),
    dimension: Number(process.env.EMBEDDING_DIM) || DEFAULT_DIM[embeddingProvider] || 256,
    batchSize: Number(process.env.EMBEDDING_BATCH_SIZE) || 64,
  },
  llm: {
    provider: (process.env.LLM_PROVIDER as LlmConfig['provider']) || (openaiApiKey ? 'openai' : 'none'),
    apiKey: openaiApiKey,
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    maxSources: Number(process.env.ANSWER_MAX_SOURCES) || 6,
    maxContextChars: Number(process.env.ANSWER_MAX_CONTEXT_CHARS) || 1200,
    temperature: Number(process.env.ANSWER_TEMPERATURE) || 0.2,
  },
  redis: {
    url: process.env.REDIS_URL || undefined,
  },
  cache: {
    searchTtl: Number(process.env.CACHE_SEARCH_TTL) || 60,
    answerTtl: Number(process.env.CACHE_ANSWER_TTL) || 300,
    embeddingTtl: Number(process.env.CACHE_EMBEDDING_TTL) || 86_400,
  },
  queue: {
    // Default ON whenever Redis is configured; opt out with QUEUE_ENABLED=false.
    enabled: bool(process.env.QUEUE_ENABLED, Boolean(process.env.REDIS_URL)),
    attempts: Number(process.env.QUEUE_ATTEMPTS) || 3,
    concurrency: Number(process.env.QUEUE_CONCURRENCY) || 2,
    runInProcess: bool(process.env.QUEUE_RUN_IN_PROCESS, true),
  },
  isProduction: (process.env.NODE_ENV || 'development') === 'production',
};

/** True when semantic search is configured (embedding provider is not `none`). */
export const isEmbeddingEnabled = (): boolean => env.embedding.provider !== 'none';

/** True when a Redis connection is configured (enables queue/cache/dist-limit). */
export const isRedisConfigured = (): boolean => Boolean(env.redis.url);

/** True when async crawling via the job queue is active. */
export const isQueueEnabled = (): boolean => isRedisConfigured() && env.queue.enabled;

export default env;
