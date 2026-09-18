import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractiveAnswer } from '../src/services/answer.service.js';
import type { PageContent } from '../src/repositories/types.js';

const page = (id: string, contentText: string, title = id): PageContent => ({
  id,
  url: `https://x.com/${id}`,
  title,
  description: null,
  contentText,
});

describe('extractiveAnswer (non-LLM fallback)', () => {
  it('selects query-relevant sentences and cites their source', () => {
    const contents = [
      page(
        '1',
        'Photosynthesis is how plants convert sunlight into chemical energy. ' +
          'It happens in the chloroplast. Cats are unrelated to this topic entirely here.'
      ),
    ];
    const answer = extractiveAnswer('How do plants convert sunlight?', contents);
    assert.match(answer, /photosynthesis/i);
    assert.match(answer, /\[1\]/); // carries a citation
    assert.doesNotMatch(answer, /cats are unrelated/i); // irrelevant sentence dropped
  });

  it('attributes sentences to the correct source number', () => {
    const contents = [
      page('1', 'The mitochondria is the powerhouse of the cell and produces energy.'),
      page('2', 'Ribosomes synthesize proteins from amino acids in the cell.'),
    ];
    const answer = extractiveAnswer('What produces energy in the cell?', contents);
    assert.match(answer, /\[1\]/);
  });

  it('falls back to the first source when nothing matches the query', () => {
    const contents = [page('1', 'A completely different subject about ocean tides and the moon.')];
    const answer = extractiveAnswer('quantum chromodynamics gluons', contents);
    assert.match(answer, /\[1\]/);
    assert.ok(answer.length > 0);
  });

  it('handles an empty source list gracefully', () => {
    assert.equal(extractiveAnswer('anything', []), 'No indexed pages matched this query.');
  });
});
