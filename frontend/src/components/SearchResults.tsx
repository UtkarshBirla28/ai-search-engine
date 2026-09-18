import type { MatchType, SearchData } from '@/types/search';

interface SearchResultsProps {
  data: SearchData | null;
  isLoading: boolean;
  error: string | null;
  pageSize: number;
  onPageChange: (page: number) => void;
}

const MATCH_LABEL: Record<MatchType, string> = {
  hybrid: 'hybrid',
  semantic: 'semantic',
  fulltext: 'keyword',
  fuzzy: 'fuzzy',
};

function MatchBadge({ matchType }: { matchType: MatchType }) {
  return (
    <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide opacity-55 dark:bg-white/10">
      {MATCH_LABEL[matchType]}
    </span>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function SearchResults({ data, isLoading, error, pageSize, onPageChange }: SearchResultsProps) {
  if (isLoading) {
    return (
      <div className="mt-8 space-y-4" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-xl border border-black/5 p-5 dark:border-white/10">
            <div className="mb-3 h-4 w-2/3 rounded bg-black/10 dark:bg-white/10" />
            <div className="h-3 w-full rounded bg-black/5 dark:bg-white/5" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-8 rounded-xl border border-red-500/30 bg-red-500/5 p-5 text-sm text-red-600 dark:text-red-400">
        {error}
      </div>
    );
  }

  if (!data) return null;

  if (data.results.length === 0) {
    return (
      <p className="mt-8 text-center text-sm opacity-60">
        No results found for “{data.query}”. Try a different query or index more sites.
      </p>
    );
  }

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));

  return (
    <div className="mt-8">
      <p className="mb-4 text-sm opacity-60">
        {data.total} result{data.total === 1 ? '' : 's'} · {MATCH_LABEL[data.mode]} ranking
      </p>
      <ul className="space-y-4">
        {data.results.map((item) => (
          <li
            key={item.id}
            className="rounded-xl border border-black/5 p-5 transition hover:border-black/15 hover:shadow-sm dark:border-white/10 dark:hover:border-white/20"
          >
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="group block">
              <p className="mb-1 truncate text-xs opacity-50">{hostOf(item.url)}</p>
              <div className="mb-1 flex items-center justify-between gap-3">
                <h3 className="font-medium group-hover:underline">{item.title || item.url}</h3>
                <div className="flex shrink-0 items-center gap-2">
                  <MatchBadge matchType={item.matchType} />
                </div>
              </div>
              {/* Snippet is server-highlighted (<mark>) by Postgres ts_headline. */}
              <p
                className="search-snippet text-sm opacity-70"
                dangerouslySetInnerHTML={{ __html: item.snippet }}
              />
            </a>
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Pagination">
          <button
            onClick={() => onPageChange(data.page - 1)}
            disabled={data.page <= 1}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/5"
          >
            ← Prev
          </button>
          <span className="px-2 text-sm opacity-60">
            Page {data.page} of {totalPages}
          </span>
          <button
            onClick={() => onPageChange(data.page + 1)}
            disabled={data.page >= totalPages}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/5"
          >
            Next →
          </button>
        </nav>
      )}
    </div>
  );
}
