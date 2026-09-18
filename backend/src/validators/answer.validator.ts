import { z } from 'zod';

export const answerQuerySchema = z.object({
  q: z
    .string({ required_error: 'Query parameter "q" is required' })
    .trim()
    .min(1, 'Query must not be empty')
    .max(500, 'Query must be at most 500 characters'),
  /** Which retrieval strategy feeds the answer (defaults to auto/hybrid). */
  mode: z.enum(['auto', 'fulltext', 'fuzzy', 'semantic', 'hybrid']).default('auto'),
  /** How many sources to retrieve and cite. */
  maxSources: z.coerce.number().int().min(1).max(10).default(6),
});

export type AnswerQuery = z.infer<typeof answerQuerySchema>;
