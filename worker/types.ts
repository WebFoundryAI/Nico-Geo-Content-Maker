/**
 * Cloudflare Worker Type Definitions
 *
 * Request and response types for the GEO Worker API.
 */

import type { BusinessInput } from '../inputs/business.schema';
import type { SiteGapAnalysis, GapFlag } from '../core/analyze/geoGapAnalyzer';
import type { SiteImprovementPlan, PageImprovementPlan } from '../core/analyze/improvementPlanner';
import type { CrawlResult } from '../core/ingest/siteCrawler';
import type { CommitResult } from '../core/writeback/githubClient';
import type { FilePatch, PlannedFileChange, DiffPreview } from '../core/writeback/patchApplier';
import type { ProjectType, RouteStrategy, PathContractConfig } from '../core/writeback/pathContract';

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
 * Target repository configuration for write-back.
 */
export interface TargetRepoConfig {
  owner: string;
  repo: string;
  branch: string;
  /** Project type determines file structure (astro-pages or static-html) */
  projectType: ProjectType;
  /** Route strategy determines file naming (path-index or flat-html) */
  routeStrategy: RouteStrategy;
}

/**
 * Path mapping for write-back operations.
 */
export interface WriteBackPathMapping {
  urlPath: string;
  filePath: string;
  fileType: 'astro' | 'html' | 'markdown' | 'json';
}

/**
 * Write-back configuration.
 */
export interface WriteBackConfig {
  pathMappings?: WriteBackPathMapping[];
  patchOutputDir?: string;
}

/**
 * Request body for the /run endpoint.
 *
 * Mode requirements:
 * - "improve": requires siteUrl
 * - "generate": requires businessInput
 * - "audit": requires siteUrl
 *
 * Write-back requirements (improve mode only):
 * - writeBack: true to enable write-back
 * - targetRepo: { owner, repo, branch } to specify destination
 * - GitHub token in X-GitHub-Token header
 */
export interface RunRequest {
  mode: RunMode;
  siteUrl?: string;
  businessInput?: BusinessInput;
  constraints: RunConstraints;
  writeBack?: boolean;
  /** Request diff preview without applying changes */
  diffPreview?: boolean;
  targetRepo?: TargetRepoConfig;
  writeBackConfig?: WriteBackConfig;
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
  writeBackEnabled?: boolean;
  writeBackDryRun?: boolean;
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
 * Write-back result information.
 */
export interface WriteBackResult {
  success: boolean;
  dryRun: boolean;
  patchesGenerated: number;
  patchesApplied: number;
  commits: Array<{
    sha: string;
    path: string;
    message: string;
    url: string;
  }>;
  patches: Array<{
    path: string;
    operation: 'create' | 'update' | 'append';
    humanReviewRequired: boolean;
    reviewNotes: string[];
  }>;
  /** Planned file changes with full details (for diff preview) */
  plannedChanges: Array<{
    url: string;
    filePath: string;
    action: 'create' | 'update' | 'no-op';
    humanReviewRequired: boolean;
    reviewNotes: string[];
  }>;
  /** Unified diff previews for each planned change */
  diffPreviews: Array<{
    filePath: string;
    action: 'create' | 'update' | 'no-op';
    diff: string;
    truncated: boolean;
  }>;
  /** Path mapping errors (URLs that couldn't be mapped to files) */
  mappingErrors: Array<{
    url: string;
    error: string;
  }>;
  errors: string[];
  warnings: string[];
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
  writeBack?: WriteBackResult;
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

/**
 * Type guard to check if targetRepo is valid.
 */
export function isValidTargetRepo(targetRepo: unknown): targetRepo is TargetRepoConfig {
  if (!targetRepo || typeof targetRepo !== 'object') {
    return false;
  }

  const t = targetRepo as Record<string, unknown>;
  return (
    typeof t.owner === 'string' &&
    t.owner.length > 0 &&
    typeof t.repo === 'string' &&
    t.repo.length > 0 &&
    typeof t.branch === 'string' &&
    t.branch.length > 0 &&
    (t.projectType === 'astro-pages' || t.projectType === 'static-html') &&
    (t.routeStrategy === 'path-index' || t.routeStrategy === 'flat-html')
  );
}

/**
 * Re-export path contract types for convenience.
 */
export type { ProjectType, RouteStrategy, PathContractConfig };
