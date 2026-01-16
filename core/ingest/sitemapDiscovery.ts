/**
 * Sitemap Discovery Helper
 *
 * Attempts to discover and parse sitemap.xml to find page URLs.
 * Falls back gracefully if sitemap is missing or invalid.
 *
 * STRATEGY:
 * 1. Try GET /sitemap.xml
 * 2. Parse <loc> entries (same-origin only)
 * 3. Handle sitemap index files (nested sitemaps)
 * 4. Return empty array if sitemap unavailable
 *
 * CONSTRAINTS:
 * - Same-origin URLs only
 * - Basic XML regex parsing (no external XML parser for MVP)
 * - Bounded by reasonable limits
 */

/**
 * Maximum number of URLs to extract from sitemap.
 */
const MAX_SITEMAP_URLS = 100;

/**
 * Maximum number of nested sitemaps to follow.
 */
const MAX_NESTED_SITEMAPS = 5;

/**
 * Extracts the origin (scheme + host) from a URL.
 */
function getOrigin(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return '';
  }
}

/**
 * Checks if a URL is same-origin.
 */
function isSameOrigin(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin;
  } catch {
    return false;
  }
}

/**
 * Extracts <loc> URLs from sitemap XML content.
 */
function extractLocUrls(xml: string, origin: string): string[] {
  const urls: string[] = [];
  const locRegex = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let match;

  while ((match = locRegex.exec(xml)) !== null) {
    const url = match[1].trim();
    if (isSameOrigin(url, origin)) {
      urls.push(url);
    }
  }

  return urls;
}

/**
 * Checks if XML content appears to be a sitemap index.
 */
function isSitemapIndex(xml: string): boolean {
  return xml.includes('<sitemapindex') || xml.includes('<sitemap>');
}

/**
 * Fetches sitemap content from a URL.
 */
async function fetchSitemap(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'NicoGeoBot/1.0 (Sitemap Discovery)',
        Accept: 'application/xml,text/xml,*/*',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    // Accept XML or plain text (some servers misconfigure content-type)
    if (!contentType.includes('xml') && !contentType.includes('text/plain')) {
      // Try anyway - some servers serve XML with wrong content-type
    }

    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Discovers URLs from a site's sitemap.
 *
 * @param origin - The origin URL (e.g., "https://example.com")
 * @param timeoutMs - Request timeout in milliseconds
 * @returns Array of discovered URLs (same-origin only)
 */
export async function discoverSitemapUrls(
  origin: string,
  timeoutMs: number = 10000
): Promise<string[]> {
  const allUrls: Set<string> = new Set();
  const sitemapUrl = `${origin}/sitemap.xml`;

  // Try to fetch main sitemap
  const mainSitemap = await fetchSitemap(sitemapUrl, timeoutMs);
  if (!mainSitemap) {
    // Try common alternatives
    const alternatives = [
      `${origin}/sitemap_index.xml`,
      `${origin}/sitemap-index.xml`,
      `${origin}/sitemaps/sitemap.xml`,
    ];

    for (const alt of alternatives) {
      const altSitemap = await fetchSitemap(alt, timeoutMs);
      if (altSitemap) {
        const urls = await processSitemapContent(altSitemap, origin, timeoutMs, 0);
        urls.forEach(url => allUrls.add(url));
        break;
      }
    }

    return Array.from(allUrls).slice(0, MAX_SITEMAP_URLS);
  }

  // Process main sitemap
  const urls = await processSitemapContent(mainSitemap, origin, timeoutMs, 0);
  urls.forEach(url => allUrls.add(url));

  return Array.from(allUrls).slice(0, MAX_SITEMAP_URLS);
}

/**
 * Processes sitemap content, handling both regular sitemaps and sitemap indexes.
 */
async function processSitemapContent(
  xml: string,
  origin: string,
  timeoutMs: number,
  depth: number
): Promise<string[]> {
  const allUrls: string[] = [];

  if (isSitemapIndex(xml) && depth < MAX_NESTED_SITEMAPS) {
    // This is a sitemap index - extract nested sitemap URLs
    const nestedSitemapUrls = extractLocUrls(xml, origin);

    for (const nestedUrl of nestedSitemapUrls.slice(0, MAX_NESTED_SITEMAPS)) {
      const nestedContent = await fetchSitemap(nestedUrl, timeoutMs);
      if (nestedContent) {
        const nestedUrls = await processSitemapContent(
          nestedContent,
          origin,
          timeoutMs,
          depth + 1
        );
        allUrls.push(...nestedUrls);
      }

      if (allUrls.length >= MAX_SITEMAP_URLS) {
        break;
      }
    }
  } else {
    // Regular sitemap - extract page URLs
    const pageUrls = extractLocUrls(xml, origin);
    allUrls.push(...pageUrls);
  }

  return allUrls.slice(0, MAX_SITEMAP_URLS);
}

/**
 * Tries to find robots.txt and extract sitemap URL from it.
 * This is a fallback if /sitemap.xml doesn't exist.
 */
export async function discoverSitemapFromRobots(
  origin: string,
  timeoutMs: number = 10000
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${origin}/robots.txt`, {
      headers: {
        'User-Agent': 'NicoGeoBot/1.0 (Robots Discovery)',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    const sitemapRegex = /^Sitemap:\s*(.+)$/im;
    const match = text.match(sitemapRegex);

    if (match && match[1]) {
      const sitemapUrl = match[1].trim();
      if (isSameOrigin(sitemapUrl, origin)) {
        return sitemapUrl;
      }
    }

    return null;
  } catch {
    return null;
  }
}
