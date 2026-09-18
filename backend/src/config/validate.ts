import env from './env.js';
import logger from './logger.js';

/** Provider → the vector dimension it must be paired with. */
const EXPECTED_DIM: Record<string, number | null> = {
  openai: null, // any dimension ≤ native is valid (Matryoshka), so don't enforce
  local: 384,
  hash: null, // hash adapts to any dimension
  none: 0,
};

/**
 * Validate configuration at boot. Fatal misconfigurations throw (fail fast);
 * risky-but-runnable ones warn. Call this once before the server starts so a bad
 * deploy dies immediately instead of erroring on the first request.
 */
export const validateEnv = (): void => {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Production must not run on optional/dev fallbacks.
  if (env.isProduction) {
    if (!env.database.url) errors.push('DATABASE_URL is required in production.');
    if (env.corsOrigin === '*') warnings.push('CORS_ORIGIN=* in production allows any origin.');
    if (env.embedding.provider === 'hash') {
      warnings.push('EMBEDDING_PROVIDER=hash gives low-quality semantic search — use openai/local in production.');
    }
  }

  // Embedding provider prerequisites.
  if (env.embedding.provider === 'openai' && !env.llm.apiKey) {
    errors.push('EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY.');
  }
  const expected = EXPECTED_DIM[env.embedding.provider];
  if (expected && env.embedding.dimension !== expected) {
    warnings.push(
      `EMBEDDING_DIM=${env.embedding.dimension} but provider "${env.embedding.provider}" expects ${expected}. ` +
        'The DB column must match — re-migrate if you changed this.'
    );
  }

  // LLM answer prerequisites (non-fatal: we degrade to extractive).
  if (env.llm.provider === 'openai' && !env.llm.apiKey) {
    warnings.push('LLM_PROVIDER=openai but OPENAI_API_KEY is unset — answers will use the extractive fallback.');
  }

  for (const w of warnings) logger.warn(`[config] ${w}`);

  if (errors.length > 0) {
    for (const e of errors) logger.error(`[config] ${e}`);
    throw new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
  }
};

export default validateEnv;
