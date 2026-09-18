/**
 * URL normalization & scoping helpers.
 *
 * Normalization is what makes de-duplication work: two URLs that point at the
 * same resource must collapse to the same string. We lower-case the host, drop
 * the fragment, strip known tracking params, remove default ports, and tidy the
 * trailing slash.
 */

/** Query params that never change the returned resource — safe to strip. */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'fbclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  '_ga',
]);

const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443',
};

/** Only these schemes are ever fetched. */
export const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Resolve a possibly-relative href against a base URL.
 * Returns null for non-HTTP(S) or unparseable links.
 */
export const resolveUrl = (href: string, base: string): string | null => {
  try {
    const resolved = new URL(href, base);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.toString();
  } catch {
    return null;
  }
};

/**
 * Produce a canonical form of a URL for de-duplication.
 * Returns null if the URL is invalid or not HTTP(S).
 */
export const normalizeUrl = (value: string): string | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hash = '';
  url.hostname = url.hostname.toLowerCase();

  if (url.port && DEFAULT_PORTS[url.protocol] === url.port) {
    url.port = '';
  }

  // Drop tracking params, then sort the rest for a stable ordering.
  const params = url.searchParams;
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) params.delete(key);
  }
  params.sort();
  url.search = params.toString() ? `?${params.toString()}` : '';

  // Collapse a bare "/" path and strip a single trailing slash (but keep "/").
  if (url.pathname === '') url.pathname = '/';
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  return url.toString();
};

/** Extract the lower-cased hostname, or null if invalid. */
export const getHost = (value: string): string | null => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/** Extract the origin (scheme + host + port), or null if invalid. */
export const getOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

/**
 * Treat "example.com" and "www.example.com" as the same site so a seed of
 * either form matches links using the other.
 */
export const sameSite = (a: string, b: string): boolean => {
  const stripWww = (h: string): string => h.replace(/^www\./, '');
  return stripWww(a) === stripWww(b);
};
