import { z } from 'zod';

export const suggestQuerySchema = z.object({
  q: z.string().trim().min(1, 'Query must not be empty').max(200),
  limit: z.coerce.number().int().min(1).max(10).default(8),
});

export type SuggestQuery = z.infer<typeof suggestQuerySchema>;
