import asyncHandler from '../utils/asyncHandler.js';
import { performSearch } from '../services/search.service.js';
import type { SearchQuery } from '../validators/search.validator.js';

/**
 * GET /search
 * Query params are validated & coerced by the `validate` middleware.
 */
export const search = asyncHandler(async (req, res) => {
  const { q, page, limit, mode } = req.query as unknown as SearchQuery;
  const data = await performSearch({ q, page, limit, mode });

  res.status(200).json({
    success: true,
    data,
  });
});

export default { search };
