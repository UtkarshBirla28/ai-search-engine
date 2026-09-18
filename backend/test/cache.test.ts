import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cacheKey } from '../src/services/cache.js';

describe('cacheKey', () => {
  it('joins parts with a colon separator', () => {
    assert.equal(cacheKey('search', 3, 'hybrid', 10, 1, 'love'), 'search:3:hybrid:10:1:love');
  });

  it('changes when the index version changes (enables invalidation)', () => {
    const v1 = cacheKey('search', 1, 'auto', 10, 1, 'q');
    const v2 = cacheKey('search', 2, 'auto', 10, 1, 'q');
    assert.notEqual(v1, v2);
  });

  it('distinguishes different queries/pages/modes', () => {
    const keys = new Set([
      cacheKey('search', 1, 'auto', 10, 1, 'cats'),
      cacheKey('search', 1, 'auto', 10, 1, 'dogs'),
      cacheKey('search', 1, 'auto', 10, 2, 'cats'),
      cacheKey('search', 1, 'hybrid', 10, 1, 'cats'),
    ]);
    assert.equal(keys.size, 4);
  });
});
