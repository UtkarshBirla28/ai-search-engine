import { z } from 'zod';

/** A single http(s) URL. */
const urlSchema = z
  .string()
  .trim()
  .url('Must be a valid URL')
  .refine((u) => /^https?:\/\//i.test(u), 'Only http(s) URLs are supported');

export const crawlBodySchema = z.object({
  /** One or more seed URLs (also accepts a single string). */
  urls: z
    .union([urlSchema, z.array(urlSchema).min(1).max(50)])
    .transform((v) => (Array.isArray(v) ? v : [v])),
  maxDepth: z.coerce.number().int().min(0).max(3).default(1),
  maxPages: z.coerce.number().int().min(1).max(200).default(20),
  sameDomainOnly: z.coerce.boolean().default(true),
  concurrency: z.coerce.number().int().min(1).max(20).default(5),
  delayMs: z.coerce.number().int().min(0).max(10_000).default(200),
  respectRobots: z.coerce.boolean().default(true),
  timeoutMs: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  maxRetries: z.coerce.number().int().min(0).max(5).default(2),
  /** Expand seeds with URLs discovered from the sites' sitemaps. */
  useSitemap: z.coerce.boolean().default(false),
});

export type CrawlBody = z.infer<typeof crawlBodySchema>;
