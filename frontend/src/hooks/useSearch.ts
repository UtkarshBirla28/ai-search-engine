'use client';

import { useCallback, useState } from 'react';
import { ApiRequestError, searchApi } from '@/lib/api';
import type { AnswerData, SearchData, SearchMode } from '@/types/search';

const PAGE_SIZE = 10;

interface UseSearchState {
  query: string;
  mode: SearchMode;
  data: SearchData | null;
  answer: AnswerData | null;
  isLoading: boolean;
  isAnswerLoading: boolean;
  error: string | null;
}

const messageFor = (err: unknown): string =>
  err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.';

const initialState: UseSearchState = {
  query: '',
  mode: 'auto',
  data: null,
  answer: null,
  isLoading: false,
  isAnswerLoading: false,
  error: null,
};

export function useSearch() {
  const [state, setState] = useState<UseSearchState>(initialState);

  /** Run a fresh search: results + AI answer fetched in parallel. */
  const search = useCallback(async (query: string, mode: SearchMode = 'auto') => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setState((prev) => ({
      ...prev,
      query: trimmed,
      mode,
      isLoading: true,
      isAnswerLoading: true,
      error: null,
      answer: null,
    }));

    // Results and answer are independent — don't let a slow/failed answer block results.
    searchApi
      .search(trimmed, { page: 1, limit: PAGE_SIZE, mode })
      .then((data) => setState((prev) => ({ ...prev, data, isLoading: false })))
      .catch((err) =>
        setState((prev) => ({ ...prev, data: null, isLoading: false, error: messageFor(err) }))
      );

    searchApi
      .answer(trimmed, mode)
      .then((answer) => setState((prev) => ({ ...prev, answer, isAnswerLoading: false })))
      .catch(() => setState((prev) => ({ ...prev, answer: null, isAnswerLoading: false })));
  }, []);

  /** Change results page without re-running the answer. */
  const goToPage = useCallback(
    async (page: number) => {
      const { query, mode } = state;
      if (!query) return;
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const data = await searchApi.search(query, { page, limit: PAGE_SIZE, mode });
        setState((prev) => ({ ...prev, data, isLoading: false }));
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        setState((prev) => ({ ...prev, isLoading: false, error: messageFor(err) }));
      }
    },
    [state]
  );

  const reset = useCallback(() => setState(initialState), []);

  return { ...state, pageSize: PAGE_SIZE, search, goToPage, reset };
}
