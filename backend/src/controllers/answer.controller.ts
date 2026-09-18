import asyncHandler from '../utils/asyncHandler.js';
import { generateAnswer } from '../services/answer.service.js';
import type { AnswerQuery } from '../validators/answer.validator.js';

/**
 * GET /answer
 * Retrieve top pages for the query and synthesize a cited AI answer.
 * Query params are validated & coerced by the `validate` middleware.
 */
export const answer = asyncHandler(async (req, res) => {
  const { q, mode, maxSources } = req.query as unknown as AnswerQuery;
  const data = await generateAnswer({ q, mode, maxSources });

  res.status(200).json({ success: true, data });
});

export default { answer };
