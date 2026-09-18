import type { EmbeddingBackend } from './types.js';

/**
 * Deterministic, dependency-free, offline embeddings via the hashing trick.
 *
 * Tokens are hashed into `dimension` buckets (a signed count per bucket), then
 * the vector is L2-normalized so cosine similarity ≈ weighted token overlap.
 * This is NOT a semantic model — it captures lexical overlap only — but it makes
 * the whole hybrid/semantic pipeline run with no API key and no model download,
 * which is exactly what we want for local dev and CI. Swap `EMBEDDING_PROVIDER`
 * to `openai` (or `local`) for real semantic quality.
 */
export class HashEmbeddingBackend implements EmbeddingBackend {
  readonly name = 'hash';
  readonly model: string;

  constructor(readonly dimension: number) {
    this.model = `hash-${dimension}`;
  }

  private static tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && t.length < 40);
  }

  /** FNV-1a — a fast, well-distributed string hash. */
  private static fnv1a(str: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  private embedOne(text: string): number[] {
    const vec = new Array<number>(this.dimension).fill(0);
    const tokens = HashEmbeddingBackend.tokenize(text);
    for (const token of tokens) {
      const h = HashEmbeddingBackend.fnv1a(token);
      const bucket = h % this.dimension;
      // A second hash bit decides the sign, reducing collisions between distinct
      // tokens that land in the same bucket.
      const sign = (h & 0x80000000) !== 0 ? 1 : -1;
      vec[bucket] += sign;
    }
    // L2 normalize so cosine distance is meaningful and vectors are comparable.
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    return vec;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }
}
