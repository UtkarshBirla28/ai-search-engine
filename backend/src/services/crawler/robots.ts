import robotsParserImport from 'robots-parser';
import logger from '../../config/logger.js';
import { getOrigin } from './urlUtils.js';

/** Minimal surface of a robots-parser instance that we actually use. */
interface Robot {
  isAllowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
}

// robots-parser is CommonJS (`module.exports = fn`); its bundled types don't
// expose a callable default cleanly under NodeNext, so we re-type it here.
const robotsParser = robotsParserImport as unknown as (url: string, robotstxt: string) => Robot;

/**
 * Fetches and caches one robots.txt per origin, and answers allow/crawl-delay
 * questions against it. A missing or unreachable robots.txt is treated as
 * "allow all" (the common permissive convention for a small crawler).
 */
export class RobotsCache {
  private readonly cache = new Map<string, Robot | null>();

  constructor(
    private readonly userAgent: string,
    private readonly timeoutMs: number
  ) {}

  private async getRobot(origin: string): Promise<Robot | null> {
    if (this.cache.has(origin)) return this.cache.get(origin) ?? null;

    const robotsUrl = `${origin}/robots.txt`;
    let robot: Robot | null = null;
    try {
      const response = await fetch(robotsUrl, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { 'User-Agent': this.userAgent },
      });
      if (response.ok) {
        robot = robotsParser(robotsUrl, await response.text());
      } else {
        logger.debug(`robots.txt for ${origin} returned HTTP ${response.status}; allowing all`);
      }
    } catch (err) {
      logger.debug(`robots.txt fetch failed for ${origin}; allowing all`, err);
    }

    this.cache.set(origin, robot);
    return robot;
  }

  /** Whether the given URL may be fetched. Unknown origins default to allowed. */
  async isAllowed(url: string): Promise<boolean> {
    const origin = getOrigin(url);
    if (!origin) return false;
    const robot = await this.getRobot(origin);
    if (!robot) return true;
    // robots-parser returns undefined when no rule matches → allowed.
    return robot.isAllowed(url, this.userAgent) !== false;
  }

  /** Crawl-delay (ms) declared for this origin, or 0 when none. */
  async getCrawlDelayMs(url: string): Promise<number> {
    const origin = getOrigin(url);
    if (!origin) return 0;
    const robot = await this.getRobot(origin);
    const seconds = robot?.getCrawlDelay(this.userAgent);
    return seconds ? seconds * 1000 : 0;
  }
}
