import type { EmbeddingBackend } from './types.js';

// Loose type for the dynamically-imported transformers.js pipeline so we don't
// need the package installed at build time.
type FeatureExtractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean }
) => Promise<{ tolist(): number[][] }>;

/**
 * On-device embeddings via @xenova/transformers (default MiniLM, 384-d). Runs
 * fully local — no API key — but the package is heavy (bundles onnxruntime) and
 * downloads model weights on first use, so it's an OPTIONAL dependency:
 *
 *   npm install @xenova/transformers
 *
 * The import is dynamic; selecting this provider without installing it throws a
 * clear, actionable error rather than breaking the build for everyone else.
 */
export class LocalEmbeddingBackend implements EmbeddingBackend {
  readonly name = 'local';
  private extractor: FeatureExtractor | null = null;

  constructor(
    readonly model: string,
    readonly dimension: number
  ) {}

  private async getExtractor(): Promise<FeatureExtractor> {
    if (this.extractor) return this.extractor;
    let mod: { pipeline: (task: string, model: string) => Promise<FeatureExtractor> };
    try {
      // @ts-expect-error — optional dependency, resolved at runtime only.
      mod = await import('@xenova/transformers');
    } catch {
      throw new Error(
        "EMBEDDING_PROVIDER=local requires the optional '@xenova/transformers' package. " +
          'Install it (`npm install @xenova/transformers`) or use EMBEDDING_PROVIDER=openai|hash.'
      );
    }
    this.extractor = await mod.pipeline('feature-extraction', this.model);
    return this.extractor;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.getExtractor();
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    return output.tolist();
  }
}
