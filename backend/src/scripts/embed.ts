/**
 * Backfill embeddings for stored pages that don't have an up-to-date one.
 *
 *   npm run embed              embed everything outstanding
 *   npm run embed -- --limit 500   cap this run at 500 pages
 *
 * Idempotent: pages already embedded by the current model are skipped. Run this
 * after switching EMBEDDING_PROVIDER (a provider change re-embeds everything).
 */
import env from '../config/env.js';
import logger from '../config/logger.js';
import { closePool, isDatabaseConfigured } from '../db/pool.js';
import { isEmbeddingEnabled } from '../services/embeddings/index.js';
import { embedMissingPages } from '../services/embed.service.js';

const main = async (): Promise<void> => {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_URL is not set.');
  if (!isEmbeddingEnabled()) {
    logger.warn('EMBEDDING_PROVIDER=none — nothing to embed.');
    return;
  }

  const limitFlag = process.argv.indexOf('--limit');
  const limit = limitFlag !== -1 ? Number(process.argv[limitFlag + 1]) : Infinity;

  logger.info(
    `Backfilling embeddings (provider=${env.embedding.provider}, model=${env.embedding.model}, dim=${env.embedding.dimension})…`
  );
  const { embedded, remaining } = await embedMissingPages(limit, env.embedding.batchSize);
  logger.info(`Done. Embedded ${embedded} page(s); ${remaining} still outstanding.`);
};

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error(err);
    void closePool().finally(() => process.exit(1));
  });
