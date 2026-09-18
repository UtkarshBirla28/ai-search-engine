import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry, HttpError, isTransient } from '../src/utils/retry.js';

const fast = { baseDelayMs: 1, maxDelayMs: 2 };

describe('withRetry', () => {
  it('returns immediately on success (no retries)', async () => {
    let calls = 0;
    const out = await withRetry(async () => {
      calls++;
      return 'ok';
    }, fast);
    assert.equal(out, 'ok');
    assert.equal(calls, 1);
  });

  it('retries transient errors then succeeds', async () => {
    let calls = 0;
    const out = await withRetry(async () => {
      calls++;
      if (calls < 3) throw new HttpError('rate limited', 429);
      return 'recovered';
    }, { ...fast, attempts: 5 });
    assert.equal(out, 'recovered');
    assert.equal(calls, 3);
  });

  it('does NOT retry non-transient errors (e.g. 400)', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(async () => {
        calls++;
        throw new HttpError('bad request', 400);
      }, { ...fast, attempts: 5 })
    );
    assert.equal(calls, 1); // failed fast, no retries
  });

  it('gives up after the configured attempts', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(async () => {
        calls++;
        throw new HttpError('server error', 500);
      }, { ...fast, attempts: 3 })
    );
    assert.equal(calls, 3);
  });
});

describe('isTransient', () => {
  it('classifies 429/5xx and network errors as transient', () => {
    assert.equal(isTransient(new HttpError('x', 429)), true);
    assert.equal(isTransient(new HttpError('x', 503)), true);
    assert.equal(isTransient(Object.assign(new Error('net'), { name: 'TypeError' })), true);
    assert.equal(isTransient(Object.assign(new Error('timeout'), { name: 'AbortError' })), true);
  });

  it('classifies 4xx (except 408/429) as permanent', () => {
    assert.equal(isTransient(new HttpError('x', 400)), false);
    assert.equal(isTransient(new HttpError('x', 404)), false);
  });
});
