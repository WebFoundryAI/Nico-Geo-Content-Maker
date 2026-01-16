/**
 * Site Crawler - Bounded HTML Ingestion
 *
 * A deterministic, bounded crawler for extracting GEO-relevant data
 * from existing websites. Same-origin only, no JavaScript rendering.
 *
 * DESIGN CONSTRAINTS:
 * - Maximum pages bounded by MAX_PAGES
 * - Same-origin links only
 * - Request timeouts enforced
 * - Deterministic URL ordering (sorted)
 * - No headless browser / JS rendering
 * - Partial results on errors
 *
 * DEPENDENCIES:
 * - Uses built-in fetch API
 * - Basic regex-based HTML parsing (no external parser for MVP)
 *   This is intentionally simple; a proper HTML parser would be better
 *   for production but adds dependency weight.
 */

import { discoverSitemapUrls } from './sitemapDiscovery';

/**
 * Configuration for the crawler.
 */
export interface CrawlerConfig {
  maxPages: number;
  requestTimeoutMs: number;
  userAgent: string;
}

/**
 * Default crawler configuration.
 */
export const DEFAULT_CRAWLER_CONFIG: CrawlerConfig = {
  maxPages: 25,
  requestTimeoutMs: 10000,
  userAgent: 'NicoGeoBot/1.0 (GEO Content Analyzer)',
};

/**
 * Extracted data from a single page.
 */
export interface PageData {
  url: string;
  httpStatus: number;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  h1Text: string | null;
  headingsSummary: {
    h2Count: number;
    h3Count: number;
  };
  detectedSchemaTypes: string[];
  contentTextLength: number;
  internalLinks: string[];
  fetchError: string | null;
}

/**
 * Result of a full site crawl.
 */
export interface CrawlResult {
  baseUrl: string;
  crawledAt: string;
  pagesAnalyzed: number;
  maxPagesLimit: number;
  pages: PageData[];
  errors: string[];
  sitemapFound: boolean;
}

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
 * Normalizes a URL by removing trailing slashes and fragments.
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove fragment
    parsed.hash = '';
    // Remove trailing slash from pathname (except for root)
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.href;
  } catch {
    return url;
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
 * Extracts text content from between HTML tags (simple regex approach).
 * This is intentionally basic - a proper DOM parser would be more robust.
 */
function extractTagContent(html: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`, 'i');
  const match = html.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Extracts meta tag content by name or property.
 */
function extractMetaContent(html: string, nameOrProperty: string): string | null {
  // Try name attribute
  const nameRegex = new RegExp(
    `<meta[^>]*name=["']${nameOrProperty}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    'i'
  );
  let match = html.match(nameRegex);
  if (match) return match[1].trim();

  // Try content before name
  const nameRegex2 = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${nameOrProperty}["'][^>]*>`,
    'i'
  );
  match = html.match(nameRegex2);
  if (match) return match[1].trim();

  // Try property attribute (for OG tags)
  const propRegex = new RegExp(
    `<meta[^>]*property=["']${nameOrProperty}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    'i'
  );
  match = html.match(propRegex);
  if (match) return match[1].trim();

  return null;
}

/**
 * Extracts canonical link.
 */
function extractCanonical(html: string): string | null {
  const regex = /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i;
  const match = html.match(regex);
  if (match) return match[1].trim();

  // Try href before rel
  const regex2 = /<link[^>]*href=["']([^"']*)["'][^>]*rel=["']canonical["'][^>]*>/i;
  const match2 = html.match(regex2);
  return match2 ? match2[1].trim() : null;
}

/**
 * Extracts first H1 text.
 */
function extractH1(html: string): string | null {
  const regex = /<h1[^>]*>([\s\S]*?)<\/h1>/i;
  const match = html.match(regex);
  if (!match) return null;
  // Strip inner tags and clean whitespace
  return match[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || null;
}

/**
 * Counts H2 and H3 headings.
 */
function countHeadings(html: string): { h2Count: number; h3Count: number } {
  const h2Matches = html.match(/<h2[^>]*>/gi);
  const h3Matches = html.match(/<h3[^>]*>/gi);
  return {
    h2Count: h2Matches ? h2Matches.length : 0,
    h3Count: h3Matches ? h3Matches.length : 0,
  };
}

/**
 * Detects schema.org types from JSON-LD scripts.
 */
function detectSchemaTypes(html: string): string[] {
  const types: string[] = [];
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const json = JSON.parse(match[1]);
      if (json['@type']) {
        if (Array.isArray(json['@type'])) {
          types.push(...json['@type']);
        } else {
          types.push(json['@type']);
        }
      }
      // Check for @graph
      if (json['@graph'] && Array.isArray(json['@graph'])) {
        for (const item of json['@graph']) {
          if (item['@type']) {
            if (Array.isArray(item['@type'])) {
              types.push(...item['@type']);
            } else {
              types.push(item['@type']);
            }
          }
        }
      }
    } catch {
      // Invalid JSON-LD, skip
    }
  }

  return [...new Set(types)]; // Deduplicate
}

/**
 * Estimates text content length (strips HTML tags).
 */
function estimateContentLength(html: string): number {
  // Remove script and style blocks
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Remove all HTML tags
  text = text.replace(/<[^>]*>/g, ' ');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text.length;
}

/**
 * Extracts internal links from HTML.
 */
function extractInternalLinks(html: string, origin: string): string[] {
  const links: Set<string> = new Set();
  const regex = /<a[^>]*href=["']([^"'#][^"']*)["'][^>]*>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    let href = match[1].trim();

    // Skip javascript:, mailto:, tel:, etc.
    if (href.match(/^(javascript|mailto|tel|data):/i)) {
      continue;
    }

    // Handle relative URLs
    try {
      const fullUrl = new URL(href, origin);
      if (isSameOrigin(fullUrl.href, origin)) {
        links.add(normalizeUrl(fullUrl.href));
      }
    } catch {
      // Invalid URL, skip
    }
  }

  return Array.from(links).sort();
}

/**
 * Fetches a single page and extracts GEO-relevant data.
 */
async function fetchAndParsePage(
  url: string,
  origin: string,
  config: CrawlerConfig
): Promise<PageData> {
  const pageData: PageData = {
    url,
    httpStatus: 0,
    title: null,
    metaDescription: null,
    canonical: null,
    h1Text: null,
    headingsSummary: { h2Count: 0, h3Count: 0 },
    detectedSchemaTypes: [],
    contentTextLength: 0,
    internalLinks: [],
    fetchError: null,
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    const response = await fetch(url, {
      headers: {
        'User-Agent': config.userAgent,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeoutId);

    pageData.httpStatus = response.status;

    if (!response.ok) {
      pageData.fetchError = `HTTP ${response.status}`;
      return pageData;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      pageData.fetchError = `Non-HTML content type: ${contentType}`;
      return pageData;
    }

    const html = await response.text();

    // Extract all data
    pageData.title = extractTagContent(html, 'title');
    pageData.metaDescription = extractMetaContent(html, 'description');
    pageData.canonical = extractCanonical(html);
    pageData.h1Text = extractH1(html);
    pageData.headingsSummary = countHeadings(html);
    pageData.detectedSchemaTypes = detectSchemaTypes(html);
    pageData.contentTextLength = estimateContentLength(html);
    pageData.internalLinks = extractInternalLinks(html, origin);
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        pageData.fetchError = 'Request timeout';
      } else {
        pageData.fetchError = err.message;
      }
    } else {
      pageData.fetchError = 'Unknown fetch error';
    }
  }

  return pageData;
}

/**
 * Crawls a website starting from the given URL.
 *
 * Strategy:
 * 1. Try to discover URLs from sitemap
 * 2. Fallback to homepage link extraction
 * 3. Crawl up to maxPages URLs
 * 4. Return structured results with partial data on errors
 */
export async function crawlSite(
  siteUrl: string,
  config: Partial<CrawlerConfig> = {}
): Promise<CrawlResult> {
  const fullConfig: CrawlerConfig = { ...DEFAULT_CRAWLER_CONFIG, ...config };
  const origin = getOrigin(siteUrl);

  if (!origin) {
    return {
      baseUrl: siteUrl,
      crawledAt: new Date().toISOString(),
      pagesAnalyzed: 0,
      maxPagesLimit: fullConfig.maxPages,
      pages: [],
      errors: ['Invalid URL: could not determine origin'],
      sitemapFound: false,
    };
  }

  const result: CrawlResult = {
    baseUrl: siteUrl,
    crawledAt: new Date().toISOString(),
    pagesAnalyzed: 0,
    maxPagesLimit: fullConfig.maxPages,
    pages: [],
    errors: [],
    sitemapFound: false,
  };

  // Step 1: Discover URLs
  let urlsToVisit: string[] = [];

  try {
    const sitemapUrls = await discoverSitemapUrls(origin, fullConfig.requestTimeoutMs);
    if (sitemapUrls.length > 0) {
      result.sitemapFound = true;
      urlsToVisit = sitemapUrls;
    }
  } catch (err) {
    result.errors.push(`Sitemap discovery failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  }

  // Step 2: If no sitemap, crawl homepage for links
  if (urlsToVisit.length === 0) {
    urlsToVisit = [normalizeUrl(siteUrl)];

    // Fetch homepage to extract links
    const homepage = await fetchAndParsePage(normalizeUrl(siteUrl), origin, fullConfig);
    result.pages.push(homepage);
    result.pagesAnalyzed = 1;

    if (homepage.internalLinks.length > 0) {
      urlsToVisit = [
        normalizeUrl(siteUrl),
        ...homepage.internalLinks.filter(link => link !== normalizeUrl(siteUrl)),
      ];
    }
  }

  // Step 3: Sort and limit URLs
  urlsToVisit = [...new Set(urlsToVisit)].sort().slice(0, fullConfig.maxPages);

  // Step 4: Crawl all URLs (skip already visited)
  const visited = new Set(result.pages.map(p => p.url));

  for (const url of urlsToVisit) {
    if (visited.has(url)) continue;
    if (result.pagesAnalyzed >= fullConfig.maxPages) break;

    const pageData = await fetchAndParsePage(url, origin, fullConfig);
    result.pages.push(pageData);
    result.pagesAnalyzed++;
    visited.add(url);

    if (pageData.fetchError) {
      result.errors.push(`${url}: ${pageData.fetchError}`);
    }
  }

  // Sort pages by URL for deterministic output
  result.pages.sort((a, b) => a.url.localeCompare(b.url));

  return result;
}
