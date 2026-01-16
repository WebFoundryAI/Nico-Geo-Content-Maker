/**
 * Cloudflare Worker Type Definitions
 *
 * Request and response types for the GEO Worker API.
 */

import type { BusinessInput } from '../inputs/business.schema';
import type { SiteGapAnalysis, GapFlag } from '../core/analyze/geoGapAnalyzer';
import type { SiteImprovementPlan, PageImprovementPlan } from '../core/analyze/improvementPlanner';
import type { CrawlResult } from '../core/ingest/siteCrawler';

/**
 * Supported execution modes for the GEO Worker.
 */
export type RunMode = 'improve' | 'generate' | 'audit';

/**
 * Constraints that can be applied to execution.
 */
export interface RunConstraints {
  noHallucinations: true;
  allowedSources?: string[];
  maxOutputSize?: number;
  maxPages?: number; // For audit/improve modes
}

/**
 * Request body for the /run endpoint.
 *
 * Mode requirements:
 * - "improve": requires siteUrl
 * - "generate": requires businessInput
 * - "audit": requires siteUrl
 */
export interface RunRequest {
  mode: RunMode;
  siteUrl?: string;
  businessInput?: BusinessInput;
  constraints: RunConstraints;
}

/**
 * Summary information included in response.
 */
export interface RunSummary {
  mode: RunMode;
  processedAt: string;
  inputSource: 'businessInput' | 'siteUrl';
  sectionsGenerated?: number;
  pagesAnalyzed?: number;
  sitemapFound?: boolean;
  warnings?: string[];
}

/**
 * Audit-specific results.
 */
export interface AuditResults {
  siteUrl: string;
  totalPages: number;
  pagesWithGaps: number;
  averageGeoScore: number;
  criticalIssues: number;
  warnings: number;
  suggestions: number;
  siteWideIssues: GapFlag[];
  pages: Array<{
    url: string;
    httpStatus: number;
    geoScore: number;
    gaps: GapFlag[];
    isServicePage: boolean;
    isLocationPage: boolean;
  }>;
  crawlErrors: string[];
}

/**
 * Improve-specific results (patch-ready blocks).
 */
export interface ImproveResults {
  siteUrl: string;
  totalPages: number;
  pagesWithImprovements: number;
  pages: PageImprovementPlan[];
  siteWideSuggestions: string[];
  crawlErrors: string[];
}

/**
 * Generate-specific results.
 */
export interface GenerateResults {
  titleMeta: unknown;
  answerCapsule: unknown;
  serviceDescriptions: unknown;
  faq: unknown;
  schema: unknown;
}

/**
 * Results from the GEO pipeline execution.
 * Type varies based on mode.
 */
export interface RunResults {
  // Generate mode results
  titleMeta?: unknown;
  answerCapsule?: unknown;
  serviceDescriptions?: unknown;
  faq?: unknown;
  schema?: unknown;

  // Audit mode results
  audit?: AuditResults;

  // Improve mode results
  improvements?: ImproveResults;
}

/**
 * Response body from the /run endpoint.
 */
export interface RunResponse {
  status: 'success' | 'error';
  mode: RunMode;
  summary: RunSummary;
  results: RunResults | null;
  error?: string;
}

/**
 * Error response structure.
 */
export interface ErrorResponse {
  status: 'error';
  mode: RunMode | null;
  summary: null;
  results: null;
  error: string;
}

/**
 * Type guard to check if request has valid mode.
 */
export function isValidMode(mode: unknown): mode is RunMode {
  return mode === 'improve' || mode === 'generate' || mode === 'audit';
}

/**
 * Type guard to check if constraints are valid.
 */
export function isValidConstraints(constraints: unknown): constraints is RunConstraints {
  if (!constraints || typeof constraints !== 'object') {
    return false;
  }

  const c = constraints as Record<string, unknown>;
  return c.noHallucinations === true;
}
