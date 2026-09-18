/**
 * Command-line crawler.
 *
 *   npm run crawl -- https://example.com
 *   npm run crawl -- https://a.com https://b.com --depth 2 --max 50
 *   npm run crawl -- https://example.com --no-robots --concurrency 8 --out result.json
 *
 * Flags:
 *   --depth <n>         link-hops to follow (default 1)
 *   --max <n>           max pages total (default 20)
 *   --concurrency <n>   parallel fetches (default 5)
 *   --delay <ms>        per-host politeness delay (default 200)
 *   --timeout <ms>      per-request timeout (default 15000)
 *   --retries <n>       retries on transient errors (default 2)
 *   --all-domains       do NOT restrict to the seed domain
 *   --no-robots         ignore robots.txt
 *   --out <file>        write full JSON report to a file
 *   --quiet             suppress the human summary (still writes --out)
 */
import { writeFile } from 'node:fs/promises';
import { crawl } from '../services/crawler/index.js';
import { isHttpUrl } from '../services/crawler/urlUtils.js';

interface CliArgs {
  urls: string[];
  overrides: Record<string, unknown>;
  out?: string;
  quiet: boolean;
}

const parseArgs = (argv: string[]): CliArgs => {
  const urls: string[] = [];
  const overrides: Record<string, unknown> = {};
  let out: string | undefined;
  let quiet = false;

  const num = (v: string | undefined, flag: string): number => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${flag} expects a number, got "${v}"`);
    return n;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--depth':
        overrides.maxDepth = num(argv[++i], '--depth');
        break;
      case '--max':
        overrides.maxPages = num(argv[++i], '--max');
        break;
      case '--concurrency':
        overrides.concurrency = num(argv[++i], '--concurrency');
        break;
      case '--delay':
        overrides.delayMs = num(argv[++i], '--delay');
        break;
      case '--timeout':
        overrides.timeoutMs = num(argv[++i], '--timeout');
        break;
      case '--retries':
        overrides.maxRetries = num(argv[++i], '--retries');
        break;
      case '--all-domains':
        overrides.sameDomainOnly = false;
        break;
      case '--no-robots':
        overrides.respectRobots = false;
        break;
      case '--out':
        out = argv[++i];
        break;
      case '--quiet':
        quiet = true;
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown flag: ${arg}`);
        urls.push(arg);
    }
  }

  return { urls, overrides, out, quiet };
};

const main = async (): Promise<void> => {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  const invalid = args.urls.filter((u) => !isHttpUrl(u));
  if (args.urls.length === 0 || invalid.length > 0) {
    if (invalid.length) console.error(`Invalid URL(s): ${invalid.join(', ')}`);
    console.error('Usage: npm run crawl -- <url> [more urls...] [flags]');
    console.error('       (see src/scripts/crawl.ts header for all flags)');
    process.exit(2);
  }

  const report = await crawl(args.urls, args.overrides);

  if (args.out) {
    await writeFile(args.out, JSON.stringify(report, null, 2), 'utf8');
    console.error(`\nFull report written to ${args.out}`);
  }

  if (!args.quiet) {
    console.error(
      `\n── Crawl summary ─────────────────────────────\n` +
        `pages: ${report.pagesCrawled}  failed: ${report.pagesFailed}  ` +
        `time: ${report.elapsedMs}ms`
    );
    for (const r of report.results) {
      const tag = r.ok ? String(r.status) : 'ERR';
      const title = r.data?.title ? ` — ${r.data.title}` : r.error ? ` — ${r.error}` : '';
      console.error(`  [${tag}] d${r.depth} ${r.finalUrl}${title}`);
    }
  }

  // When no file is requested, emit the JSON on stdout so it can be piped.
  if (!args.out) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
