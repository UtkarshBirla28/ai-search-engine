'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { searchApi } from '@/lib/api';
import type { SearchMode } from '@/types/search';

interface SearchBarProps {
  onSearch: (query: string, mode: SearchMode) => void;
  isLoading?: boolean;
  initialMode?: SearchMode;
  initialQuery?: string;
}

const MODES: { value: SearchMode; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Hybrid when available, else keyword' },
  { value: 'hybrid', label: 'Hybrid', hint: 'Keyword + semantic, fused (RRF)' },
  { value: 'semantic', label: 'Semantic', hint: 'Meaning-based (vectors)' },
  { value: 'fulltext', label: 'Keyword', hint: 'Classic full-text' },
];

export function SearchBar({ onSearch, isLoading = false, initialMode = 'auto', initialQuery = '' }: SearchBarProps) {
  const [value, setValue] = useState(initialQuery);
  const [mode, setMode] = useState<SearchMode>(initialMode);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Reflect an externally-provided initial query (e.g. from a shared /?q= URL).
  useEffect(() => {
    if (initialQuery) setValue(initialQuery);
  }, [initialQuery]);
  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  // Debounced autocomplete against /suggest; aborts in-flight requests.
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      searchApi
        .suggest(q, controller.signal)
        .then((d) => setSuggestions(d.suggestions))
        .catch(() => undefined); // ignore aborts / errors — suggestions are best-effort
    }, 200);
    return () => clearTimeout(timer);
  }, [value]);

  const submit = (q: string) => {
    setOpen(false);
    onSearch(q, mode);
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submit(value);
  };

  return (
    <form onSubmit={handleSubmit} className="relative w-full">
      <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white/60 px-5 py-3 shadow-sm backdrop-blur transition focus-within:border-black/30 dark:border-white/15 dark:bg-white/5">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5 shrink-0 opacity-50" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <input
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="Ask anything…"
          aria-label="Search query"
          autoComplete="off"
          className="flex-1 bg-transparent text-base outline-none placeholder:opacity-50"
        />
        <button
          type="submit"
          disabled={isLoading || !value.trim()}
          className="rounded-full bg-foreground px-5 py-1.5 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isLoading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {open && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-2xl border border-black/10 bg-white shadow-lg dark:border-white/15 dark:bg-neutral-900">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                // onMouseDown (not onClick) so it fires before the input blur closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  setValue(s);
                  submit(s);
                }}
                className="flex w-full items-center gap-2 px-5 py-2.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 opacity-40" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.2-5.2M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
                </svg>
                <span className="truncate">{s}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setMode(m.value)}
            title={m.hint}
            aria-pressed={mode === m.value}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              mode === m.value ? 'bg-foreground text-background' : 'border border-black/10 opacity-70 hover:opacity-100 dark:border-white/15'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </form>
  );
}
