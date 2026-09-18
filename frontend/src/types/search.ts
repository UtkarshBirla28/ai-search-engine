export type SearchMode = 'auto' | 'fulltext' | 'fuzzy' | 'semantic' | 'hybrid';
export type MatchType = 'fulltext' | 'fuzzy' | 'semantic' | 'hybrid';

export interface SearchResultItem {
  id: string;
  title: string | null;
  snippet: string;
  url: string;
  score: number;
  matchType: MatchType;
}

export interface SearchData {
  query: string;
  page: number;
  limit: number;
  total: number;
  mode: MatchType;
  results: SearchResultItem[];
}

export interface AnswerSource {
  n: number;
  id: string;
  title: string | null;
  url: string;
  snippet: string;
}

export interface AnswerData {
  query: string;
  answer: string;
  generator: 'llm' | 'extractive';
  model: string | null;
  sources: AnswerSource[];
}

export interface SuggestData {
  query: string;
  suggestions: string[];
}

export interface CrawlStorage {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  embedded: number;
}

export interface CrawlReport {
  pagesCrawled: number;
  pagesFailed: number;
  elapsedMs: number;
  storage: CrawlStorage;
}

export interface CrawlEnqueued {
  jobId: string;
  status: 'queued';
  statusUrl: string;
}

export interface CrawlProgress {
  phase: 'queued' | 'crawling' | 'storing' | 'embedding' | 'done';
  pagesCrawled?: number;
  stored?: number;
  embedded?: number;
}

export interface CrawlJobStatus {
  id: string;
  state: string;
  progress: CrawlProgress | number | null;
  result: CrawlReport | null;
  failedReason: string | null;
}

export const isEnqueued = (d: CrawlReport | CrawlEnqueued): d is CrawlEnqueued =>
  (d as CrawlEnqueued).jobId !== undefined;

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
