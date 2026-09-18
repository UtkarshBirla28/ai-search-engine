import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HashEmbeddingBackend } from '../src/services/embeddings/hash.provider.js';

const cosine = (a: number[], b: number[]): number => {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are L2-normalized, so dot product == cosine similarity
};

describe('HashEmbeddingBackend', () => {
  const be = new HashEmbeddingBackend(256);

  it('produces vectors of the configured dimension', async () => {
    const [v] = await be.embed(['hello world']);
    assert.equal(v.length, 256);
  });

  it('is deterministic', async () => {
    const [a] = await be.embed(['the quick brown fox']);
    const [b] = await be.embed(['the quick brown fox']);
    assert.deepEqual(a, b);
  });

  it('produces (approximately) unit-norm vectors', async () => {
    const [v] = await be.embed(['some reasonably long piece of text here']);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    assert.ok(Math.abs(norm - 1) < 1e-6, `norm was ${norm}`);
  });

  it('ranks overlapping text as more similar than unrelated text', async () => {
    const [q] = await be.embed(['machine learning and neural networks']);
    const [related] = await be.embed(['deep learning uses neural networks']);
    const [unrelated] = await be.embed(['banana bread recipe with walnuts']);
    assert.ok(cosine(q, related) > cosine(q, unrelated));
  });

  it('reports a model id encoding the dimension', () => {
    assert.equal(be.model, 'hash-256');
    assert.equal(be.name, 'hash');
  });
});
