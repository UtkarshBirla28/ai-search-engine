import logger from '../config/logger.js';

/** HTTP status codes that are worth retrying (transient). */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** An error that carries an HTTP status, so retry logic can classify it. */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Default policy: retry on transient HTTP statuses and network/timeout errors. */
export const isTransient = (err: unknown): boolean => {
  if (err instanceof HttpError) return RETRYABLE_STATUS.has(err.status);
  // fetch throws TypeError on network failure; AbortSignal.timeout → AbortError/TimeoutError.
  const name = (err as { name?: string })?.name;
  return name === 'TypeError' || name === 'AbortError' || name === 'TimeoutError';
};

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: (err: unknown) => boolean;
  label?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying transient failures with exponential backoff + jitter.
 * Re-throws the last error once attempts are exhausted. Used to wrap external
 * calls (OpenAI) so a blip doesn't fail the request outright.
 */
export const withRetry = async <T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> => {
  const { attempts = 3, baseDelayMs = 500, maxDelayMs = 8000, retryOn = isTransient, label = 'op' } = opts;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !retryOn(err)) break;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * (backoff / 2));
      const delay = backoff + jitter;
      logger.warn(`[retry] ${label} attempt ${attempt}/${attempts} failed (${(err as Error).message}); retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
};
