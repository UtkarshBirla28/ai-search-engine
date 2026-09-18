import asyncHandler from '../utils/asyncHandler.js';
import env, { isQueueEnabled } from '../config/env.js';
import { isDatabaseConfigured, ping } from '../db/pool.js';
import { isRedisConfigured, pingRedis } from '../config/redis.js';
import { isEmbeddingEnabled } from '../services/embeddings/index.js';
import { isLlmEnabled } from '../services/llm/openai.client.js';

/**
 * GET /health — liveness/readiness probe.
 * Reports database connectivity + AI capability status without failing when
 * those features are optional/down.
 */
export const healthCheck = asyncHandler(async (_req, res) => {
  const [database, redis] = await Promise.all([
    !isDatabaseConfigured() ? Promise.resolve('not-configured') : ping().then((up) => (up ? 'up' : 'down')),
    !isRedisConfigured() ? Promise.resolve('not-configured') : pingRedis().then((up) => (up ? 'up' : 'down')),
  ]);

  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      environment: env.nodeEnv,
      database,
      redis,
      crawlMode: isQueueEnabled() ? 'async-queue' : 'sync',
      search: {
        semantic: isEmbeddingEnabled(),
        embeddingProvider: env.embedding.provider,
        embeddingModel: env.embedding.model,
        answerGenerator: isLlmEnabled() ? 'llm' : 'extractive',
        llmModel: isLlmEnabled() ? env.llm.model : null,
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
  });
});

export default { healthCheck };
