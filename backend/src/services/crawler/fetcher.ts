import logger from '../../config/logger.js';

/** Skip bodies larger than this to avoid unbounded memory use (8 MB). */
const MAX_CONTENT_BYTES = 8 * 1024 * 1024;

export interface FetchOptions {
  userAgent: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface FetchOutcome {
  ok: boolean;
  status: number | null;
  contentType: string | null;
  finalUrl: string;
  /** Response body as text, or null when not fetched/parsed. */
  body: string | null;
  error: string | null;
  elapsedMs: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Transient conditions worth retrying. */
const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 429 || status >= 500;

/**
 * Fetch a single URL as text with a per-attempt timeout and exponential-backoff
 * retries for transient failures. Only text/html and XML-ish bodies are read;
 * other content types return ok=true with a null body so the caller can skip
 * parsing without treating it as an error.
 */
export const fetchPage = async (url: string, opts: FetchOptions): Promise<FetchOutcome> => {
  const startedAt = Date.now();
  let lastError = 'Unknown error';

  for (let attempt = 0; attempt <= opts.maxRetries; attempt += 1) {
    if (attempt > 0) {
      const backoff = Math.min(2 ** (attempt - 1) * 500, 8000);
      logger.debug(`Retry ${attempt}/${opts.maxRetries} for ${url} after ${backoff}ms`);
      await sleep(backoff);
    }

    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(opts.timeoutMs),
        headers: {
          'User-Agent': opts.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      const contentType = response.headers.get('content-type');
      const finalUrl = response.url || url;

      if (!response.ok) {
        lastError = `HTTP ${response.status} ${response.statusText}`;
        if (isRetryableStatus(response.status) && attempt < opts.maxRetries) continue;
        return {
          ok: false,
          status: response.status,
          contentType,
          finalUrl,
          body: null,
          error: lastError,
          elapsedMs: Date.now() - startedAt,
        };
      }

      const length = Number(response.headers.get('content-length') ?? '0');
      if (length > MAX_CONTENT_BYTES) {
        return {
          ok: false,
          status: response.status,
          contentType,
          finalUrl,
          body: null,
          error: `Body too large (${length} bytes)`,
          elapsedMs: Date.now() - startedAt,
        };
      }

      // Only read parseable text; skip binaries (PDF, images, etc.) cleanly.
      const isTextual =
        !contentType ||
        contentType.includes('text/html') ||
        contentType.includes('application/xhtml') ||
        contentType.includes('text/plain') ||
        contentType.includes('xml');

      const body = isTextual ? await response.text() : null;

      return {
        ok: true,
        status: response.status,
        contentType,
        finalUrl,
        body,
        error: null,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (err) {
      lastError =
        err instanceof Error
          ? err.name === 'TimeoutError'
            ? `Timed out after ${opts.timeoutMs}ms`
            : err.message
          : String(err);
      // Network-level failures are retryable up to the limit.
    }
  }

  return {
    ok: false,
    status: null,
    contentType: null,
    finalUrl: url,
    body: null,
    error: lastError,
    elapsedMs: Date.now() - startedAt,
  };
};
