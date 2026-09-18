'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnswerBox } from '@/components/AnswerBox';
import { SearchBar } from '@/components/SearchBar';
import { SearchResults } from '@/components/SearchResults';
import { useSearch } from '@/hooks/useSearch';
import type { SearchMode } from '@/types/search';

export default function Home() {
  const { data, answer, isLoading, isAnswerLoading, error, pageSize, search, goToPage } = useSearch();
  const hasSearched = data !== null || error !== null || isLoading;

  const [initialQuery, setInitialQuery] = useState('');
  const [initialMode, setInitialMode] = useState<SearchMode>('auto');
  const didInit = useRef(false);

  // Search + keep the URL shareable (?q=&mode=).
  const runSearch = useCallback(
    (q: string, mode: SearchMode) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      const params = new URLSearchParams({ q: trimmed, mode });
      window.history.replaceState(null, '', `/?${params.toString()}`);
      search(trimmed, mode);
    },
    [search]
  );

  // On first load, run any query passed in the URL (shared/bookmarked search).
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    const mode = (params.get('mode') as SearchMode) || 'auto';
    if (q) {
      setInitialQuery(q);
      setInitialMode(mode);
      search(q, mode);
    }
  }, [search]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-16 sm:py-20">
      <header className={hasSearched ? 'mb-6' : 'mb-8 text-center'}>
        <div className="flex items-center justify-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">AI Search Engine</h1>
        </div>
        {!hasSearched && (
          <p className="mt-3 text-sm opacity-60">
            Crawl the web, then search it by keyword or meaning — with a cited AI answer on top.
          </p>
        )}
      </header>

      <SearchBar onSearch={runSearch} isLoading={isLoading} initialQuery={initialQuery} initialMode={initialMode} />

      <AnswerBox answer={answer} isLoading={isAnswerLoading} />
      <SearchResults
        data={data}
        isLoading={isLoading}
        error={error}
        pageSize={pageSize}
        onPageChange={goToPage}
      />

      {!hasSearched && (
        <p className="mt-10 text-center text-xs opacity-50">
          Nothing indexed yet?{' '}
          <a href="/admin" className="underline hover:opacity-100">
            Index some sites →
          </a>
        </p>
      )}
    </main>
  );
}
