import asyncHandler from '../utils/asyncHandler.js';
import env from '../config/env.js';
import { pageRepository } from '../repositories/index.js';
import { cached, cacheKey, getIndexVersion } from '../services/cache.js';
import type { SuggestQuery } from '../validators/suggest.validator.js';

/**
 * GET /suggest — lightweight autocomplete over indexed page titles.
 * Cached briefly (index-version keyed) since the same prefixes are hit repeatedly.
 */
export const suggest = asyncHandler(async (req, res) => {
  const { q, limit } = req.query as unknown as SuggestQuery;
  const version = await getIndexVersion();
  const suggestions = await cached(
    cacheKey('suggest', version, limit, q.toLowerCase()),
    Math.min(env.cache.searchTtl, 30),
    () => pageRepository.suggestTitles(q, limit)
  );

  res.status(200).json({ success: true, data: { query: q, suggestions } });
});

export default { suggest };
