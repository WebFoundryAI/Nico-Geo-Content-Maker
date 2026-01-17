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
import type { GscSnapshotRow } from '../core/intelligence/gscSnapshot.types';
import type { ScoreBreakdown } from '../core/intelligence/opportunityScorer';
import type { RecommendedAction } from '../core/intelligence/actionQueue';

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
/**
 * Generator selection preferences.
 */
export interface GeneratorPreference {
  /** Explicitly enable specific generators (overrides autoDetect) */
  enabled?: string[];
  /** Explicitly disable specific generators (always respected) */
  disabled?: string[];
  /** Auto-detect industry and include applicable generators (default: true) */
  autoDetect?: boolean;
}

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
  /** GSC snapshot data for ranking intelligence (audit/improve modes) */
  gscSnapshot?: GscSnapshotRow[];
  /** Target paths to process in improve mode (if not provided, auto-selects top N) */
  targetPaths?: string[];
  /** Generator selection preferences (generate mode only) */
  generators?: GeneratorPreference;
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
  /** Generators that were executed (generate mode) */
  generatorsRun?: string[];
  /** Generators that were skipped (generate mode) */
  generatorsSkipped?: string[];
  /** Detected industry type (generate mode with autoDetect) */
  detectedIndustry?: string;
  /** Execution time in milliseconds */
  executionTimeMs?: number;
}

/**
 * Action queue item for prioritized improvements.
 */
export interface ActionQueueItem {
  /** Full URL */
  url: string;
  /** Normalized path */
  path: string;
  /** Total opportunity score */
  totalScore: number;
  /** Breakdown of score components */
  scoreBreakdown: ScoreBreakdown;
  /** Primary recommended action */
  recommendedNextAction: RecommendedAction;
  /** Evidence strings explaining the ranking */
  evidence: string[];
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
  /** Prioritized action queue (present when gscSnapshot provided or always for gap-based scoring) */
  actionQueue?: ActionQueueItem[];
  /** Summary statistics for the action queue */
  actionQueueSummary?: {
    totalPagesAnalyzed: number;
    pagesWithGscData: number;
    averageScore: number;
  };
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
  /** Auto-selected target paths (when gscSnapshot provided and no targetPaths specified) */
  selectedTargets?: string[];
  /** Action queue for reference (same format as audit mode) */
  actionQueue?: ActionQueueItem[];
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
  // Generate mode results - Core generators
  titleMeta?: unknown;
  answerCapsule?: unknown;
  serviceDescriptions?: unknown;
  whyChooseUs?: unknown;
  teamBios?: unknown;
  howWeWork?: unknown;
  caseStudies?: unknown;
  testimonials?: unknown;
  faq?: unknown;
  schema?: unknown;

  // Generate mode results - Industry-specific generators
  propertyMarketData?: unknown;
  permitsAndCodes?: unknown;
  localCourtProcess?: unknown;
  firstTimeBuyerPrograms?: unknown;
  seasonalClimate?: unknown;

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
 * Error response structure (legacy).
 */
export interface ErrorResponse {
  status: 'error';
  mode: RunMode | null;
  summary: null;
  results: null;
  error: string;
}

/**
 * Structured API error codes.
 */
export type ApiErrorCode =
  | 'MISSING_AUTH'
  | 'INVALID_FORMAT'
  | 'INVALID_KEY'
  | 'KEY_DISABLED'
  | 'DAILY_LIMIT_EXCEEDED'
  | 'MINUTE_LIMIT_EXCEEDED'
  | 'PLAN_REQUIRED'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

/**
 * Structured API error response.
 */
export interface ApiErrorResponse {
  status: 'error';
  errorCode: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Usage information included in responses.
 */
export interface UsageInfo {
  keyId: string;
  plan: 'free' | 'pro';
  requestsToday: number;
  dailyLimit: number;
  minuteWindowCount: number;
  minuteWindowLimit: number;
}

/**
 * Extended run response with usage info.
 */
export interface RunResponseWithUsage extends RunResponse {
  usage?: UsageInfo;
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

/**
 * Re-export intelligence types for convenience.
 */
export type { GscSnapshotRow, ScoreBreakdown, RecommendedAction };

// ============================================
// REVIEW SESSION TYPES (Baby Step 8D)
// ============================================

/**
 * Status of a review session.
 */
export type ReviewSessionStatus = 'pending' | 'approved' | 'expired' | 'applied';

/**
 * A planned file in a review session (subset of PlannedFileChange).
 */
export interface ReviewPlannedFile {
  url: string;
  filePath: string;
  action: 'create' | 'update' | 'no-op';
  humanReviewRequired: boolean;
  reviewNotes: string[];
}

/**
 * Diff preview stored in a review session.
 */
export interface ReviewDiffPreview {
  filePath: string;
  action: 'create' | 'update' | 'no-op';
  diff: string;
  truncated: boolean;
}

/**
 * Patch data stored in a review session (subset of improvement data).
 */
export interface ReviewPatch {
  url: string;
  filePath: string;
  newContent: string;
  originalContent: string | null;
}

/**
 * Review session model.
 * Stores improvement planning results for human review before write-back.
 */
export interface ReviewSession {
  /** Unique session identifier (UUID) */
  sessionId: string;
  /** Creation timestamp (UTC ISO string) */
  createdAt: string;
  /** Expiration timestamp (UTC ISO string) */
  expiresAt: string;
  /** Mode - always 'improve' for review sessions */
  mode: 'improve';
  /** Target site URL */
  siteUrl: string;
  /** Selected target paths */
  selectedTargets: string[];
  /** Planned file changes (without content to save space) */
  plannedFiles: ReviewPlannedFile[];
  /** Unified diff previews */
  diffPreviews: ReviewDiffPreview[];
  /** Patch data for later application (stored separately) */
  patches: ReviewPatch[];
  /** Current status */
  status: ReviewSessionStatus;
  /** Commit SHAs if applied (populated after successful apply) */
  commitShas?: string[];
  /** Target repository configuration */
  targetRepo: TargetRepoConfig;
}

/**
 * Request body for POST /review/create.
 */
export interface ReviewCreateRequest {
  /** Must be 'improve' */
  mode: 'improve';
  /** Target site URL */
  siteUrl: string;
  /** Constraints */
  constraints: RunConstraints;
  /** Target repository (required) */
  targetRepo: TargetRepoConfig;
  /** Write-back config (optional) */
  writeBackConfig?: WriteBackConfig;
  /** GSC snapshot (optional) */
  gscSnapshot?: GscSnapshotRow[];
  /** Target paths (optional) */
  targetPaths?: string[];
}

/**
 * Response from POST /review/create.
 */
export interface ReviewCreateResponse {
  status: 'success';
  sessionId: string;
  expiresAt: string;
  summary: {
    siteUrl: string;
    selectedTargets: string[];
    plannedFilesCount: number;
    filesRequiringReview: number;
  };
}

/**
 * Response from GET /review/{sessionId}.
 */
export interface ReviewGetResponse {
  status: 'success';
  session: {
    sessionId: string;
    createdAt: string;
    expiresAt: string;
    status: ReviewSessionStatus;
    siteUrl: string;
    selectedTargets: string[];
    plannedFiles: ReviewPlannedFile[];
    diffPreviews: ReviewDiffPreview[];
    patchCount: number;
    targetRepo: {
      owner: string;
      repo: string;
      branch: string;
    };
    commitShas?: string[];
  };
}

/**
 * Response from POST /review/{sessionId}/approve.
 */
export interface ReviewApproveResponse {
  status: 'success';
  sessionId: string;
  previousStatus: ReviewSessionStatus;
  newStatus: ReviewSessionStatus;
}

/**
 * Response from POST /review/{sessionId}/apply.
 */
export interface ReviewApplyResponse {
  status: 'success';
  sessionId: string;
  applied: boolean;
  commitShas: string[];
  message: string;
}

/**
 * Extended API error codes for review endpoints.
 */
export type ReviewApiErrorCode =
  | ApiErrorCode
  | 'SESSION_NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'SESSION_NOT_APPROVED'
  | 'SESSION_ALREADY_APPLIED';

/**
 * Review-specific error response.
 */
export interface ReviewErrorResponse {
  status: 'error';
  errorCode: ReviewApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
}
