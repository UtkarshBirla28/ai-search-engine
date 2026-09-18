import * as cheerio from 'cheerio';
import type { ParsedPage } from './types.js';
import { resolveUrl } from './urlUtils.js';

/** Cap stored visible text so reports stay manageable (~20k chars). */
const MAX_TEXT_LENGTH = 20_000;

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

/**
 * Parse an HTML document into structured data.
 *
 * @param html    Raw HTML string.
 * @param baseUrl The (final) URL the HTML was fetched from — used to resolve
 *                relative links/images to absolute URLs.
 */
export const parseHtml = (html: string, baseUrl: string): ParsedPage => {
  const $ = cheerio.load(html);

  // Prefer <base href> when present for correct relative-URL resolution.
  const baseHref = $('base[href]').attr('href');
  const base = baseHref ? resolveUrl(baseHref, baseUrl) || baseUrl : baseUrl;

  const title = collapseWhitespace($('title').first().text()) || null;
  const description = $('meta[name="description"]').attr('content')?.trim() || null;
  const canonicalRaw = $('link[rel="canonical"]').attr('href');
  const canonical = canonicalRaw ? resolveUrl(canonicalRaw, base) : null;
  const lang = $('html').attr('lang')?.trim() || null;

  const headings = {
    h1: $('h1')
      .map((_, el) => collapseWhitespace($(el).text()))
      .get()
      .filter(Boolean),
    h2: $('h2')
      .map((_, el) => collapseWhitespace($(el).text()))
      .get()
      .filter(Boolean),
  };

  const openGraph: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, el) => {
    const key = $(el).attr('property');
    const content = $(el).attr('content');
    if (key && content) openGraph[key] = content.trim();
  });

  // Absolute, de-duplicated outbound links.
  const linkSet = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const abs = resolveUrl(href, base);
    if (abs) linkSet.add(abs);
  });

  const imageSet = new Set<string>();
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    const abs = resolveUrl(src, base);
    if (abs) imageSet.add(abs);
  });

  // Visible text: drop non-content nodes first.
  $('script, style, noscript, template, svg').remove();
  const fullText = collapseWhitespace($('body').text() || $.root().text());
  const wordCount = fullText ? fullText.split(' ').length : 0;
  const text = fullText.slice(0, MAX_TEXT_LENGTH);

  return {
    title,
    description,
    canonical,
    lang,
    headings,
    text,
    wordCount,
    links: [...linkSet],
    images: [...imageSet],
    openGraph,
  };
};
