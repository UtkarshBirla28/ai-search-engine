import env from '../../config/env.js';
import logger from '../../config/logger.js';
import type { EmbeddingBackend } from './types.js';
import { HashEmbeddingBackend } from './hash.provider.js';
import { OpenAIEmbeddingBackend } from './openai.provider.js';
import { LocalEmbeddingBackend } from './local.provider.js';

export type { EmbeddingBackend } from './types.js';

let backend: EmbeddingBackend | null = null;

/** True when semantic search is configured (provider is not `none`). */
export const isEmbeddingEnabled = (): boolean => env.embedding.provider !== 'none';

/** Active embedding vector dimension (matches the DB column). */
export const embeddingDimension = (): number => env.embedding.dimension;

/** Active embedding model id (persisted per row). */
export const embeddingModel = (): string => env.embedding.model;

/**
 * Resolve (once) the configured embedding backend. Throws a clear error when a
 * provider's prerequisites are missing — we never silently switch providers,
 * because a different provider means a different vector dimension, which would
 * not fit the `pages.embedding` column.
 */
const getBackend = (): EmbeddingBackend => {
  if (backend) return backend;

  const { provider, model, dimension } = env.embedding;
  switch (provider) {
    case 'openai':
      if (!env.llm.apiKey) {
        throw new Error(
          'EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY. Set it, or use ' +
            'EMBEDDING_PROVIDER=hash (offline) / local.'
        );
      }
      backend = new OpenAIEmbeddingBackend(model, dimension, env.llm.apiKey, env.llm.baseUrl);
      break;
    case 'local':
      backend = new LocalEmbeddingBackend(model, dimension);
      break;
    case 'hash':
      backend = new HashEmbeddingBackend(dimension);
      break;
    case 'none':
    default:
      throw new Error('Embeddings are disabled (EMBEDDING_PROVIDER=none).');
  }

  logger.info(`Embedding backend: ${backend.name} (model=${backend.model}, dim=${backend.dimension})`);
  return backend;
};

/**
 * Embed a batch of texts, in provider-sized batches. Empty/whitespace texts are
 * embedded too (they yield a zero-ish vector) so indices always line up with the
 * input array.
 */
export const embed = async (texts: string[]): Promise<number[][]> => {
  if (!isEmbeddingEnabled()) throw new Error('Embeddings are disabled.');
  if (texts.length === 0) return [];

  const be = getBackend();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += env.embedding.batchSize) {
    const chunk = texts.slice(i, i + env.embedding.batchSize);
    const vectors = await be.embed(chunk);
    for (const v of vectors) {
      if (v.length !== be.dimension) {
        throw new Error(
          `Embedding dimension mismatch: got ${v.length}, expected ${be.dimension}. ` +
            'Check EMBEDDING_DIM matches the provider and the migrated column.'
        );
      }
      out.push(v);
    }
  }
  return out;
};

/** Embed a single text. */
export const embedOne = async (text: string): Promise<number[]> => (await embed([text]))[0];

/** Format a vector as a pgvector literal (`[0.1,0.2,...]`) for parameterized SQL. */
export const toVectorLiteral = (vec: number[]): string => `[${vec.join(',')}]`;

export default { embed, embedOne, isEmbeddingEnabled, embeddingDimension, embeddingModel, toVectorLiteral };
