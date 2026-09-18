import logger from '../config/logger.js';
import type { Queryable } from '../db/pool.js';
import { PageRepository, pageRepository } from '../repositories/index.js';
import type { PageNeedingEmbedding } from '../repositories/types.js';
import { embed, embeddingModel, isEmbeddingEnabled } from './embeddings/index.js';

/** Max characters of body text folded into a page's embedding input. */
const EMBED_TEXT_CHARS = 2000;

/** Build the text we embed for a page: title + description + a body prefix. */
export const embeddingText = (p: PageNeedingEmbedding): string =>
  [p.title ?? '', p.description ?? '', (p.contentText ?? '').slice(0, EMBED_TEXT_CHARS)]
    .filter(Boolean)
    .join('\n')
    .trim();

export interface EmbedResult {
  embedded: number;
  remaining: number;
}

/**
 * Embed pages that don't yet have an up-to-date embedding, in batches, until the
 * limit is reached (or everything is done when `limit` is omitted). Safe to call
 * repeatedly — it's the backbone of both crawl-time indexing and `npm run embed`.
 * Failures are logged and skipped so one bad page never aborts the batch.
 */
export const embedMissingPages = async (
  limit = Infinity,
  batchSize = 64
): Promise<EmbedResult> => {
  if (!isEmbeddingEnabled()) return { embedded: 0, remaining: 0 };

  const model = embeddingModel();
  let embedded = 0;

  while (embedded < limit) {
    const take = Math.min(batchSize, limit - embedded);
    const pages = await pageRepository.listMissingEmbeddings(model, take);
    if (pages.length === 0) break;

    const texts = pages.map(embeddingText);
    let vectors: number[][];
    try {
      vectors = await embed(texts);
    } catch (err) {
      logger.error('Embedding batch failed — aborting this run (pages left unembedded).', err);
      break;
    }

    // One row per page; keep going if a single update fails.
    await Promise.all(
      pages.map(async (p, i) => {
        try {
          await pageRepository.updateEmbedding(p.id, vectors[i], model);
          embedded += 1;
        } catch (err) {
          logger.error(`Failed to store embedding for page ${p.id}`, err);
        }
      })
    );

    logger.info(`Embedded ${pages.length} pages (total this run: ${embedded}).`);
  }

  const remaining = await pageRepository.countMissingEmbeddings(model);
  return { embedded, remaining };
};

/** Embed a specific set of page ids (used right after a crawl). */
export const embedPagesByIds = async (ids: string[], client?: Queryable): Promise<number> => {
  if (!isEmbeddingEnabled() || ids.length === 0) return 0;
  const repo = client ? new PageRepository(client) : pageRepository;
  const contents = await repo.getContentByIds(ids);
  if (contents.length === 0) return 0;

  const model = embeddingModel();
  const texts = contents.map((c) =>
    embeddingText({ id: c.id, title: c.title, description: c.description, contentText: c.contentText })
  );

  let vectors: number[][];
  try {
    vectors = await embed(texts);
  } catch (err) {
    logger.error('Post-crawl embedding failed; pages remain searchable lexically.', err);
    return 0;
  }

  let count = 0;
  await Promise.all(
    contents.map(async (c, i) => {
      try {
        await repo.updateEmbedding(c.id, vectors[i], model);
        count += 1;
      } catch (err) {
        logger.error(`Failed to store embedding for page ${c.id}`, err);
      }
    })
  );
  return count;
};

export default { embedMissingPages, embedPagesByIds, embeddingText };
