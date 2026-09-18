import { config } from './config';
import type {
  AnswerData,
  ApiResponse,
  CrawlEnqueued,
  CrawlJobStatus,
  CrawlReport,
  SearchData,
  SearchMode,
  SuggestData,
} from '@/types/search';

/**
 * Thrown when the API returns a non-2xx response or a `success: false` body.
 */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.apiBaseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    throw new ApiRequestError('Unable to reach the server. Is the backend running?', 0);
  }

  let body: ApiResponse<T> | null = null;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    // Non-JSON response.
  }

  if (!res.ok || !body || body.success === false) {
    const message =
      body && body.success === false
        ? body.error.message
        : `Request failed with status ${res.status}`;
    throw new ApiRequestError(message, res.status);
  }

  return body.data;
}

export interface SearchOptions {
  page?: number;
  limit?: number;
  mode?: SearchMode;
}

export const searchApi = {
  search: (query: string, { page = 1, limit = 10, mode = 'auto' }: SearchOptions = {}) => {
    const params = new URLSearchParams({
      q: query,
      page: String(page),
      limit: String(limit),
      mode,
    });
    return request<SearchData>(`/search?${params.toString()}`);
  },

  answer: (query: string, mode: SearchMode = 'auto') => {
    const params = new URLSearchParams({ q: query, mode });
    return request<AnswerData>(`/answer?${params.toString()}`);
  },

  suggest: (query: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ q: query });
    return request<SuggestData>(`/suggest?${params.toString()}`, { signal });
  },

  // Returns either a completed CrawlReport (sync mode) or an enqueue ack (async).
  crawl: (payload: Record<string, unknown>) =>
    request<CrawlReport | CrawlEnqueued>(`/crawl`, { method: 'POST', body: JSON.stringify(payload) }),

  crawlStatus: (jobId: string) => request<CrawlJobStatus>(`/crawl/${jobId}`),
};
