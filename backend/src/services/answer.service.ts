import env from '../config/env.js';
import logger from '../config/logger.js';
import { pageRepository } from '../repositories/index.js';
import type { PageContent } from '../repositories/types.js';
import { performSearch, type SearchMode } from './search.service.js';
import { chat, isLlmEnabled } from './llm/openai.client.js';
import { cached, cacheKey, getIndexVersion } from './cache.js';

export interface AnswerSource {
  n: number;
  id: string;
  title: string | null;
  url: string;
  snippet: string;
}

export interface AnswerResponse {
  query: string;
  answer: string;
  /** How the answer was produced: an LLM, or a non-LLM extractive fallback. */
  generator: 'llm' | 'extractive';
  model: string | null;
  sources: AnswerSource[];
}

export interface AnswerParams {
  q: string;
  mode?: SearchMode;
  maxSources?: number;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'was',
  'were', 'be', 'been', 'it', 'this', 'that', 'these', 'those', 'as', 'at', 'by', 'from', 'how',
  'what', 'why', 'when', 'where', 'who', 'which', 'do', 'does', 'did', 'can', 'will', 'about',
]);

const queryTerms = (q: string): string[] =>
  q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

/** Truncate to a character budget on a word boundary. */
const clip = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max)}…`;
};

const buildSources = (contents: PageContent[]): AnswerSource[] =>
  contents.map((c, i) => ({
    n: i + 1,
    id: c.id,
    title: c.title,
    url: c.url,
    snippet: clip((c.description || c.contentText || '').replace(/\s+/g, ' ').trim(), 240),
  }));

/**
 * Extractive (non-LLM) fallback: pick the sentences across the top sources that
 * best cover the query terms, attach citations. Always available — this is what
 * makes the answer box work with no API key.
 */
export const extractiveAnswer = (q: string, contents: PageContent[]): string => {
  const terms = queryTerms(q);
  if (terms.length === 0 || contents.length === 0) {
    const first = contents[0];
    return first
      ? `${clip((first.description || first.contentText || '').replace(/\s+/g, ' ').trim(), 300)} [1]`
      : 'No indexed pages matched this query.';
  }

  interface Scored {
    sentence: string;
    score: number;
    source: number;
  }
  const scored: Scored[] = [];

  contents.forEach((c, idx) => {
    const text = (c.contentText || c.description || '').replace(/\s+/g, ' ').trim();
    const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 30 && s.length < 400);
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      let score = 0;
      for (const term of terms) if (lower.includes(term)) score += 1;
      if (score > 0) scored.push({ sentence, score, source: idx + 1 });
    }
  });

  scored.sort((a, b) => b.score - a.score);

  const picked: Scored[] = [];
  const seen = new Set<string>();
  for (const s of scored) {
    const key = s.sentence.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(s);
    if (picked.length >= 4) break;
  }

  if (picked.length === 0) {
    const first = contents[0];
    return `${clip((first.description || first.contentText || '').replace(/\s+/g, ' ').trim(), 300)} [1]`;
  }

  // Keep original source order for readability, cite each sentence.
  picked.sort((a, b) => a.source - b.source);
  return picked.map((p) => `${p.sentence.trim()} [${p.source}]`).join(' ');
};

/** Build the LLM prompt from numbered sources and call the chat model. */
const llmAnswer = async (q: string, contents: PageContent[]): Promise<string> => {
  const sourcesBlock = contents
    .map((c, i) => {
      const body = clip((c.contentText || c.description || '').replace(/\s+/g, ' ').trim(), env.llm.maxContextChars);
      return `[${i + 1}] ${c.title ?? c.url}\nURL: ${c.url}\n${body}`;
    })
    .join('\n\n');

  const system =
    'You are a helpful search assistant. Answer the user\'s question using ONLY the numbered ' +
    'sources provided. Cite every claim inline with its source number in square brackets, e.g. [1]. ' +
    'If the sources do not contain the answer, say so plainly. Be concise (2–5 sentences) and neutral.';

  const user = `Question: ${q}\n\nSources:\n${sourcesBlock}`;

  return chat([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);
};

/**
 * Retrieve the most relevant pages for `q` (hybrid search) and synthesize a cited
 * answer. Uses the configured LLM when available, otherwise an extractive summary.
 * Either way the response carries the sources so the UI can render citations.
 */
const runGenerateAnswer = async ({ q, mode = 'auto', maxSources }: AnswerParams): Promise<AnswerResponse> => {
  const limit = maxSources ?? env.llm.maxSources;

  const search = await performSearch({ q, page: 1, limit, mode });
  const ids = search.results.map((r) => r.id);
  const contents = await pageRepository.getContentByIds(ids);
  const sources = buildSources(contents);

  if (sources.length === 0) {
    return {
      query: q,
      answer: 'No indexed pages matched this query. Try crawling some sites first, or rephrase.',
      generator: 'extractive',
      model: null,
      sources: [],
    };
  }

  if (isLlmEnabled()) {
    try {
      const answer = await llmAnswer(q, contents);
      return { query: q, answer, generator: 'llm', model: env.llm.model, sources };
    } catch (err) {
      logger.error('LLM answer failed — falling back to extractive summary.', err);
    }
  }

  return {
    query: q,
    answer: extractiveAnswer(q, contents),
    generator: 'extractive',
    model: null,
    sources,
  };
};

/**
 * Cached wrapper: AI answers are relatively expensive (retrieval + LLM), so we
 * cache them keyed by the index version (a crawl invalidates stale answers) and
 * the query/mode/source-count. Computes directly when Redis is off.
 */
export const generateAnswer = async (params: AnswerParams): Promise<AnswerResponse> => {
  const version = await getIndexVersion();
  const key = cacheKey('answer', version, params.mode ?? 'auto', params.maxSources ?? env.llm.maxSources, params.q.toLowerCase());
  return cached(key, env.cache.answerTtl, () => runGenerateAnswer(params));
};

export default { generateAnswer };
