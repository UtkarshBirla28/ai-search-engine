import type { EmbeddingBackend } from './types.js';
import { HttpError, withRetry } from '../../utils/retry.js';

interface OpenAIEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
  model: string;
}

/**
 * OpenAI embeddings (default `text-embedding-3-small`, 1536-d). The `-3` models
 * support a `dimensions` parameter to shorten the vector (Matryoshka), so any
 * `dimension <= native` works and stays comparable. Requires OPENAI_API_KEY.
 */
export class OpenAIEmbeddingBackend implements EmbeddingBackend {
  readonly name = 'openai';

  constructor(
    readonly model: string,
    readonly dimension: number,
    private readonly apiKey: string,
    private readonly baseUrl: string
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Retry transient failures (429/5xx/network) with exponential backoff.
    return withRetry(
      async () => {
        const res = await fetch(`${this.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            input: texts,
            // 3rd-gen models honor an explicit shorter dimension; harmless otherwise.
            dimensions: this.dimension,
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new HttpError(`OpenAI embeddings failed (${res.status}): ${detail.slice(0, 300)}`, res.status);
        }

        const body = (await res.json()) as OpenAIEmbeddingResponse;
        // Sort by index defensively — the API returns them in order, but don't rely on it.
        return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
      },
      { label: 'openai.embeddings', attempts: 3 }
    );
  }
}
