import { z } from 'zod';

export const searchQuerySchema = z.object({
  q: z
    .string({ required_error: 'Query parameter "q" is required' })
    .trim()
    .min(1, 'Query must not be empty')
    .max(500, 'Query must be at most 500 characters'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  /**
   * auto     = hybrid when embeddings are enabled, else full-text→fuzzy fallback,
   * fulltext = keyword only, fuzzy = trigram/typo only,
   * semantic = vector nearest-neighbour (meaning), hybrid = RRF of full-text + semantic.
   */
  mode: z.enum(['auto', 'fulltext', 'fuzzy', 'semantic', 'hybrid']).default('auto'),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
