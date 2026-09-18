/**
 * An embedding backend turns text into fixed-length vectors. Implementations
 * live alongside this file (hash / openai / local) and are selected by
 * `EMBEDDING_PROVIDER`. All vectors from one backend share `dimension`.
 */
export interface EmbeddingBackend {
  /** Provider id (matches EMBEDDING_PROVIDER). */
  readonly name: string;
  /** Model identifier, stored per-row so a provider change is detectable. */
  readonly model: string;
  /** Output vector length. Must match the `pages.embedding` column. */
  readonly dimension: number;
  /** Embed a batch of texts, preserving order. */
  embed(texts: string[]): Promise<number[][]>;
}
