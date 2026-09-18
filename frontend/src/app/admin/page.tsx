'use client';

import { useRef, useState } from 'react';
import { ApiRequestError, searchApi } from '@/lib/api';
import { isEnqueued, type CrawlProgress, type CrawlReport } from '@/types/search';

const PHASES: CrawlProgress['phase'][] = ['queued', 'crawling', 'storing', 'embedding', 'done'];

function ProgressBar({ progress }: { progress: CrawlProgress }) {
  const idx = Math.max(0, PHASES.indexOf(progress.phase));
  const pct = ((idx + 1) / PHASES.length) * 100;
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium capitalize">{progress.phase}…</span>
        <span className="opacity-60">
          {progress.pagesCrawled != null && `${progress.pagesCrawled} crawled`}
          {progress.embedded != null && ` · ${progress.embedded} embedded`}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div className="h-full rounded-full bg-blue-600 transition-all duration-500 dark:bg-blue-400" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [urls, setUrls] = useState('https://quotes.toscrape.com');
  const [maxDepth, setMaxDepth] = useState(1);
  const [maxPages, setMaxPages] = useState(20);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const [result, setResult] = useState<CrawlReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pollJob = (jobId: string) =>
    new Promise<CrawlReport>((resolve, reject) => {
      const tick = async () => {
        try {
          const s = await searchApi.crawlStatus(jobId);
          if (typeof s.progress === 'object' && s.progress) setProgress(s.progress);
          if (s.state === 'completed' && s.result) return resolve(s.result);
          if (s.state === 'failed') return reject(new Error(s.failedReason || 'Crawl job failed'));
          pollRef.current = setTimeout(tick, 1000);
        } catch (err) {
          reject(err);
        }
      };
      void tick();
    });

  const run = async () => {
    const list = urls.split('\n').map((u) => u.trim()).filter(Boolean);
    if (list.length === 0) return;

    setIsRunning(true);
    setError(null);
    setResult(null);
    setProgress({ phase: 'queued' });
    try {
      const data = await searchApi.crawl({ urls: list, maxDepth, maxPages });
      const report = isEnqueued(data) ? await pollJob(data.jobId) : data;
      setResult(report);
      setProgress(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : (err as Error).message || 'Crawl failed.');
      setProgress(null);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-16">
      <header className="mb-6">
        <a href="/" className="text-sm opacity-60 hover:opacity-100">← Back to search</a>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">Index sites</h1>
        <p className="mt-2 text-sm opacity-60">
          Crawl one or more URLs into the search index. The crawler respects robots.txt and stays on
          the seed domain by default. Pages are embedded for semantic search automatically. Large
          crawls run as a background job with live progress.
        </p>
      </header>

      <label className="mb-1 block text-sm font-medium">URLs (one per line)</label>
      <textarea
        value={urls}
        onChange={(e) => setUrls(e.target.value)}
        rows={4}
        spellCheck={false}
        className="w-full rounded-xl border border-black/10 bg-white/60 p-3 font-mono text-sm outline-none focus:border-black/30 dark:border-white/15 dark:bg-white/5"
        placeholder="https://example.com"
      />

      <div className="mt-4 flex flex-wrap gap-4">
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-medium">Max depth</span>
          <input type="number" min={0} max={3} value={maxDepth} onChange={(e) => setMaxDepth(Number(e.target.value))}
            className="w-24 rounded-lg border border-black/10 bg-transparent px-3 py-1.5 outline-none focus:border-black/30 dark:border-white/15" />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-medium">Max pages</span>
          <input type="number" min={1} max={200} value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))}
            className="w-24 rounded-lg border border-black/10 bg-transparent px-3 py-1.5 outline-none focus:border-black/30 dark:border-white/15" />
        </label>
      </div>

      <button
        onClick={run}
        disabled={isRunning}
        className="mt-5 self-start rounded-full bg-foreground px-6 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isRunning ? 'Crawling…' : 'Start crawl'}
      </button>

      {isRunning && progress && <ProgressBar progress={progress} />}

      {error && (
        <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400">{error}</div>
      )}

      {result && (
        <div className="mt-6 rounded-xl border border-green-600/25 bg-green-600/5 p-5 text-sm">
          <p className="mb-2 font-medium">Crawl complete ({(result.elapsedMs / 1000).toFixed(1)}s)</p>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 opacity-80 sm:grid-cols-3">
            <li>Crawled: {result.pagesCrawled}</li>
            <li>New: {result.storage.inserted}</li>
            <li>Updated: {result.storage.updated}</li>
            <li>Embedded: {result.storage.embedded}</li>
            <li>Failed: {result.pagesFailed}</li>
            <li>Skipped: {result.storage.skipped}</li>
          </ul>
          <a href="/" className="mt-4 inline-block text-blue-700 hover:underline dark:text-blue-400">→ Try searching now</a>
        </div>
      )}
    </main>
  );
}
