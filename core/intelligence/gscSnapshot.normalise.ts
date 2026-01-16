/**
 * GSC Snapshot Normalisation and Matching
 *
 * Normalizes page URLs/paths from both GSC data and ingested pages
 * to enable deterministic matching.
 *
 * NORMALISATION RULES:
 * 1. Extract path from full URLs (remove protocol + host)
 * 2. Lowercase all paths
 * 3. Remove trailing slashes (except for root "/")
 * 4. Remove query strings and fragments
 * 5. Collapse multiple slashes to single slash
 *
 * AGGREGATION RULES (when multiple GSC rows map to same path):
 * - clicks: sum
 * - impressions: sum
 * - ctr: weighted average by impressions
 * - position: weighted average by impressions
 */

import type { GscSnapshotRow } from './gscSnapshot.types';

/**
 * Aggregated GSC metrics for a single normalized path.
 */
export interface AggregatedGscMetrics {
  /** Normalized path */
  path: string;
  /** Original page values that mapped to this path */
  originalPages: string[];
  /** Total clicks (sum) */
  clicks: number;
  /** Total impressions (sum) */
  impressions: number;
  /** Weighted average CTR by impressions */
  ctr: number;
  /** Weighted average position by impressions */
  position: number;
  /** Date range (from first row) */
  dateRange: string;
}

/**
 * Result of matching GSC data to ingested pages.
 */
export interface GscMatchResult {
  /** Path */
  path: string;
  /** Full URL (from ingested pages) */
  url: string;
  /** Aggregated GSC metrics (null if no GSC data for this path) */
  gscMetrics: AggregatedGscMetrics | null;
  /** Whether GSC data was found for this page */
  hasGscData: boolean;
}

/**
 * Normalizes a URL or path to a canonical path format.
 *
 * Examples:
 *   "https://example.com/about/" -> "/about"
 *   "/About/" -> "/about"
 *   "https://example.com/foo//bar?q=1#anchor" -> "/foo/bar"
 *   "/" -> "/"
 *   "" -> "/"
 */
export function normalizePath(urlOrPath: string): string {
  let path: string;

  // Try to parse as URL to extract pathname
  try {
    const url = new URL(urlOrPath, 'https://placeholder.local');
    path = url.pathname;
  } catch {
    // Not a valid URL, treat as path
    path = urlOrPath;
  }

  // Lowercase
  path = path.toLowerCase();

  // Collapse multiple slashes
  path = path.replace(/\/+/g, '/');

  // Remove trailing slash (except for root)
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  // Ensure starts with /
  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  // Handle empty path
  if (path === '' || path === '/') {
    return '/';
  }

  return path;
}

/**
 * Extracts the origin (protocol + host) from a URL, or null if not a full URL.
 */
export function extractOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Aggregates multiple GSC rows that map to the same normalized path.
 */
function aggregateRows(rows: GscSnapshotRow[], normalizedPath: string): AggregatedGscMetrics {
  const originalPages = rows.map(r => r.page);
  const dateRange = rows[0]?.dateRange || 'unknown';

  // Sum clicks and impressions
  let totalClicks = 0;
  let totalImpressions = 0;

  for (const row of rows) {
    totalClicks += row.clicks;
    totalImpressions += row.impressions;
  }

  // Weighted averages for CTR and position
  let weightedCtr = 0;
  let weightedPosition = 0;

  if (totalImpressions > 0) {
    for (const row of rows) {
      const weight = row.impressions / totalImpressions;
      weightedCtr += row.ctr * weight;
      weightedPosition += row.position * weight;
    }
  } else {
    // No impressions - use simple average
    const count = rows.length;
    if (count > 0) {
      weightedCtr = rows.reduce((sum, r) => sum + r.ctr, 0) / count;
      weightedPosition = rows.reduce((sum, r) => sum + r.position, 0) / count;
    }
  }

  return {
    path: normalizedPath,
    originalPages,
    clicks: totalClicks,
    impressions: totalImpressions,
    ctr: weightedCtr,
    position: weightedPosition,
    dateRange,
  };
}

/**
 * Groups GSC rows by normalized path and aggregates metrics.
 */
export function aggregateGscByPath(rows: GscSnapshotRow[]): Map<string, AggregatedGscMetrics> {
  // Group rows by normalized path
  const pathGroups = new Map<string, GscSnapshotRow[]>();

  for (const row of rows) {
    const normalizedPath = normalizePath(row.page);
    const existing = pathGroups.get(normalizedPath) || [];
    existing.push(row);
    pathGroups.set(normalizedPath, existing);
  }

  // Aggregate each group
  const result = new Map<string, AggregatedGscMetrics>();

  for (const [path, groupRows] of pathGroups) {
    result.set(path, aggregateRows(groupRows, path));
  }

  return result;
}

/**
 * Matches GSC data to a list of ingested page URLs.
 * Returns match results for each ingested page.
 */
export function matchGscToPages(
  ingestedUrls: string[],
  gscRows: GscSnapshotRow[]
): GscMatchResult[] {
  // Aggregate GSC data by path
  const gscByPath = aggregateGscByPath(gscRows);

  // Match each ingested URL
  const results: GscMatchResult[] = [];

  for (const url of ingestedUrls) {
    const normalizedPath = normalizePath(url);
    const gscMetrics = gscByPath.get(normalizedPath) || null;

    results.push({
      path: normalizedPath,
      url,
      gscMetrics,
      hasGscData: gscMetrics !== null,
    });
  }

  return results;
}

/**
 * Creates a lookup map from normalized path to full URL.
 */
export function createPathToUrlMap(urls: string[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const url of urls) {
    const path = normalizePath(url);
    // Keep first URL for each path (deterministic)
    if (!map.has(path)) {
      map.set(path, url);
    }
  }

  return map;
}
