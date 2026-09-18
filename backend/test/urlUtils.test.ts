import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUrl,
  isHttpUrl,
  resolveUrl,
  sameSite,
  getHost,
} from '../src/services/crawler/urlUtils.js';

describe('normalizeUrl', () => {
  it('lower-cases the host and drops the fragment', () => {
    assert.equal(normalizeUrl('https://Example.com/Path#section'), 'https://example.com/Path');
  });

  it('strips tracking params but keeps meaningful ones, sorted', () => {
    assert.equal(
      normalizeUrl('https://x.com/p?utm_source=news&b=2&a=1&fbclid=xyz'),
      'https://x.com/p?a=1&b=2'
    );
  });

  it('removes default ports and a single trailing slash', () => {
    assert.equal(normalizeUrl('https://x.com:443/a/b/'), 'https://x.com/a/b');
    assert.equal(normalizeUrl('http://x.com:80/'), 'http://x.com/');
  });

  it('collapses two equivalent URLs to the same string (dedup key)', () => {
    assert.equal(
      normalizeUrl('https://x.com/a/?utm_medium=x#top'),
      normalizeUrl('https://x.com/a')
    );
  });

  it('rejects non-HTTP(S) and invalid URLs', () => {
    assert.equal(normalizeUrl('mailto:a@b.com'), null);
    assert.equal(normalizeUrl('not a url'), null);
  });
});

describe('isHttpUrl / resolveUrl / sameSite / getHost', () => {
  it('isHttpUrl accepts http(s) only', () => {
    assert.equal(isHttpUrl('https://a.com'), true);
    assert.equal(isHttpUrl('ftp://a.com'), false);
  });

  it('resolveUrl resolves relative hrefs against a base', () => {
    assert.equal(resolveUrl('/b', 'https://a.com/x/'), 'https://a.com/b');
    assert.equal(resolveUrl('javascript:void(0)', 'https://a.com'), null);
  });

  it('sameSite treats www and apex as equal', () => {
    assert.equal(sameSite('www.a.com', 'a.com'), true);
    assert.equal(sameSite('a.com', 'b.com'), false);
  });

  it('getHost lower-cases the hostname', () => {
    assert.equal(getHost('https://A.COM/x'), 'a.com');
  });
});
