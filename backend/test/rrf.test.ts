import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reciprocalRankFusion } from '../src/services/search.service.js';
import type { SearchHit } from '../src/repositories/types.js';

const hit = (id: string, matchType: SearchHit['matchType'], snippet = ''): SearchHit => ({
  id,
  url: `https://x.com/${id}`,
  title: id,
  snippet,
  score: 0,
  matchType,
});

describe('reciprocalRankFusion', () => {
  it('ranks a doc that appears high in BOTH lists above single-list docs', () => {
    const lexical = [hit('a', 'fulltext'), hit('b', 'fulltext'), hit('c', 'fulltext')];
    const semantic = [hit('b', 'semantic'), hit('d', 'semantic'), hit('a', 'semantic')];
    const fused = reciprocalRankFusion([lexical, semantic], 60);
    // 'a' (ranks 1 & 3) and 'b' (ranks 2 & 1) appear in both → they lead.
    assert.deepEqual(fused.slice(0, 2).map((h) => h.id).sort(), ['a', 'b']);
    assert.equal(fused[0].matchType, 'hybrid');
  });

  it('deduplicates ids across lists', () => {
    const fused = reciprocalRankFusion(
      [[hit('a', 'fulltext'), hit('b', 'fulltext')], [hit('a', 'semantic')]],
      60
    );
    assert.equal(fused.length, 2);
    assert.equal(new Set(fused.map((h) => h.id)).size, 2);
  });

  it('prefers a highlighted (<mark>) snippet when merging duplicates', () => {
    const fused = reciprocalRankFusion(
      [[hit('a', 'semantic', 'plain text')], [hit('a', 'fulltext', 'has <mark>match</mark>')]],
      60
    );
    assert.match(fused[0].snippet, /<mark>/);
  });

  it('a higher rank contributes a larger fused score (1/(k+rank))', () => {
    const fused = reciprocalRankFusion([[hit('top', 'fulltext'), hit('low', 'fulltext')]], 60);
    const top = fused.find((h) => h.id === 'top')!;
    const low = fused.find((h) => h.id === 'low')!;
    assert.ok(top.score > low.score);
    assert.ok(Math.abs(top.score - 1 / 61) < 1e-9);
  });
});
