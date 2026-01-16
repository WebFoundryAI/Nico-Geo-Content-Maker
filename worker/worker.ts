/**
 * Cloudflare Worker - GEO Content Generation API
 *
 * This Worker acts as an API orchestrator for the GEO content generation engine.
 * It does NOT contain GEO logic itself - it validates requests, orchestrates
 * ingestion, and invokes the existing GEO engine.
 *
 * Endpoint: POST /run
 * Modes:
 *   - "generate": Create GEO content from BusinessInput
 *   - "audit": Analyze existing site for GEO gaps
 *   - "improve": Generate patch-ready improvement blocks (with optional write-back)
 *
 * AUTHENTICATION:
 * - All requests require: Authorization: Bearer <api_key>
 * - Keys are validated against NICO_GEO_KEYS KV namespace
 *
 * RATE LIMITS (per key):
 * - free: 20 requests/day, 2/minute burst
 * - pro: 500 requests/day, 30/minute burst
 *
 * CONSTRAINTS:
 * - Never writes files locally
 * - Never infers or fabricates data
 * - Write-back is opt-in, requires pro plan and explicit configuration
 * - No secrets stored in code
 */

import type { BusinessInput } from '../inputs/business.schema';
import { validateBusinessInput } from '../core/rules/businessInput.validator';
import { runGEOPipeline } from '../core/pipeline/geoPipeline';
import { validateGEOOutput } from '../contracts/output.contract';
import { crawlSite, DEFAULT_CRAWLER_CONFIG } from '../core/ingest/siteCrawler';
import { analyzeGeoGaps } from '../core/analyze/geoGapAnalyzer';
import { planSiteImprovements } from '../core/analyze/improvementPlanner';
import {
  verifyWriteAccess,
  getFileContents,
  decodeContent,
  GitHubAPIError,
} from '../core/writeback/githubClient';
import {
  generatePatches,
  applyPatches,
  planPatches,
  applyPlannedPatches,
} from '../core/writeback/patchApplier';
import { mapUrlToFilePath, PathMappingError } from '../core/writeback/pathContract';
import type { GitHubClientConfig } from '../core/writeback/githubClient';
import type { PatchApplierConfig, PatchPlanConfig } from '../core/writeback/patchApplier';
import type { PathContractConfig } from '../core/writeback/pathContract';
import type {
  RunRequest,
  RunResponse,
  ErrorResponse,
  RunMode,
  RunSummary,
  RunResults,
  AuditResults,
  ImproveResults,
  WriteBackResult,
  TargetRepoConfig,
  WriteBackConfig,
  ApiErrorResponse,
  ApiErrorCode,
  UsageInfo,
  RunResponseWithUsage,
  ReviewSession,
  ReviewCreateRequest,
  ReviewCreateResponse,
  ReviewGetResponse,
  ReviewApproveResponse,
  ReviewApplyResponse,
  ReviewErrorResponse,
  ReviewApiErrorCode,
  ReviewPlannedFile,
  ReviewDiffPreview,
  ReviewPatch,
} from './types';
import { isValidMode, isValidConstraints, isValidTargetRepo } from './types';
import { authenticateRequest, type KVNamespace, type ApiKeyRecord } from './auth';
import { checkRateLimit, type DurableObjectNamespace, type UsageState, RATE_LIMITS } from './rateLimit';
import { validateGscSnapshot, type GscSnapshotRow } from '../core/intelligence/gscSnapshot.types';
import { matchGscToPages, normalizePath } from '../core/intelligence/gscSnapshot.normalise';
import { scorePages, type PageScoringInput } from '../core/intelligence/opportunityScorer';
import { generateActionQueue, selectTopTargets } from '../core/intelligence/actionQueue';
import type { ActionQueueItem } from './types';
import {
  createReviewSession,
  storeSession,
  getSessionWithExpirationCheck,
  updateSessionStatus,
  canApproveSession,
  canApplySession,
  isValidSessionId,
} from './reviewSessions';
import {
  getOrCreateRequestId,
  createLogger,
  addRequestIdHeader,
  REQUEST_ID_HEADER,
  Logger,
} from './observability';
import {
  createErrorResponse,
  isPayloadTooLarge,
  MAX_PAYLOAD_SIZE_BYTES,
  VERSION_INFO,
  type ApiErrorCode as CentralApiErrorCode,
} from './errors';

/**
 * Environment bindings for the Worker.
 */
export interface Env {
  /** KV namespace for API keys */
  NICO_GEO_KEYS: KVNamespace;
  /** KV namespace for review sessions */
  NICO_GEO_SESSIONS: KVNamespace;
  /** Durable Object namespace for rate limiting */
  RATE_LIMITER: DurableObjectNamespace;
}

/**
 * Header name for GitHub token.
 */
const GITHUB_TOKEN_HEADER = 'X-GitHub-Token';

/**
 * Header name for Authorization.
 */
const AUTH_HEADER = 'Authorization';

/**
 * CORS headers for all responses.
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': `Content-Type, ${AUTH_HEADER}, ${GITHUB_TOKEN_HEADER}, ${REQUEST_ID_HEADER}`,
  'Access-Control-Expose-Headers': REQUEST_ID_HEADER,
};

/**
 * Default number of auto-selected targets when using GSC snapshot in improve mode.
 */
const DEFAULT_AUTO_SELECT_TARGETS = 5;

/**
 * Creates a JSON response with proper headers and request ID.
 */
function jsonResponse(
  data: RunResponse | RunResponseWithUsage | ErrorResponse | ApiErrorResponse,
  status: number = 200,
  requestId?: string
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...CORS_HEADERS,
  };
  if (requestId) {
    headers[REQUEST_ID_HEADER] = requestId;
  }
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers,
  });
}

/**
 * Creates an error response (legacy format).
 */
function errorResponse(message: string, mode: RunMode | null = null, status: number = 400): Response {
  const body: ErrorResponse = {
    status: 'error',
    mode,
    summary: null,
    results: null,
    error: message,
  };
  return jsonResponse(body, status);
}

/**
 * Creates a structured API error response with requestId.
 */
function apiErrorResponse(
  errorCode: ApiErrorCode,
  message: string,
  status: number,
  requestId: string,
  details?: Record<string, unknown>
): Response {
  const body: ApiErrorResponse & { requestId: string } = {
    status: 'error',
    requestId,
    errorCode,
    message,
    ...(details && { details }),
  };
  return jsonResponse(body, status, requestId);
}

/**
 * Converts UsageState to UsageInfo for response.
 */
function toUsageInfo(usage: UsageState): UsageInfo {
  return {
    keyId: usage.keyId,
    plan: usage.plan,
    requestsToday: usage.requestsToday,
    dailyLimit: usage.dailyLimit,
    minuteWindowCount: usage.minuteWindowCount,
    minuteWindowLimit: usage.minuteWindowLimit,
  };
}

/**
 * Validates the request body structure.
 */
function validateRequest(body: unknown): { valid: true; request: RunRequest } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const obj = body as Record<string, unknown>;

  // Validate mode
  if (!isValidMode(obj.mode)) {
    return { valid: false, error: `Invalid mode: must be "improve", "generate", or "audit"` };
  }

  // Validate constraints
  if (!isValidConstraints(obj.constraints)) {
    return { valid: false, error: 'constraints.noHallucinations must be true' };
  }

  // Mode-specific validation
  const mode = obj.mode as RunMode;

  if (mode === 'improve' && !obj.siteUrl) {
    return { valid: false, error: 'Mode "improve" requires siteUrl' };
  }

  if (mode === 'generate' && !obj.businessInput) {
    return { valid: false, error: 'Mode "generate" requires businessInput' };
  }

  if (mode === 'audit' && !obj.siteUrl) {
    return { valid: false, error: 'Mode "audit" requires siteUrl' };
  }

  // Validate siteUrl format if provided
  if (obj.siteUrl !== undefined) {
    if (typeof obj.siteUrl !== 'string') {
      return { valid: false, error: 'siteUrl must be a string' };
    }
    try {
      new URL(obj.siteUrl);
    } catch {
      return { valid: false, error: 'siteUrl must be a valid URL' };
    }
  }

  // Validate businessInput if provided
  if (obj.businessInput !== undefined) {
    const validation = validateBusinessInput(obj.businessInput);
    if (!validation.valid) {
      return { valid: false, error: `Invalid businessInput: ${validation.errors.join(', ')}` };
    }
  }

  // Validate write-back configuration if enabled
  if (obj.writeBack === true) {
    if (mode !== 'improve') {
      return { valid: false, error: 'Write-back is only supported for "improve" mode' };
    }
    if (!obj.targetRepo) {
      return { valid: false, error: 'Write-back requires targetRepo configuration' };
    }
    if (!isValidTargetRepo(obj.targetRepo)) {
      return { valid: false, error: 'targetRepo must include owner, repo, branch, projectType (astro-pages|static-html), and routeStrategy (path-index|flat-html)' };
    }
  }

  // Validate gscSnapshot if provided (only for audit/improve modes)
  let validatedGscRows: GscSnapshotRow[] | undefined;
  if (obj.gscSnapshot !== undefined) {
    if (mode === 'generate') {
      return { valid: false, error: 'gscSnapshot is not supported for "generate" mode' };
    }
    const gscValidation = validateGscSnapshot(obj.gscSnapshot);
    if (!gscValidation.valid && gscValidation.errors.length > 0) {
      const errorSummary = gscValidation.errors.slice(0, 3).map(e => `row ${e.rowIndex}: ${e.message}`).join('; ');
      return { valid: false, error: `Invalid gscSnapshot: ${errorSummary}` };
    }
    validatedGscRows = gscValidation.validRows;
  }

  // Validate targetPaths if provided (only for improve mode)
  if (obj.targetPaths !== undefined) {
    if (mode !== 'improve') {
      return { valid: false, error: 'targetPaths is only supported for "improve" mode' };
    }
    if (!Array.isArray(obj.targetPaths)) {
      return { valid: false, error: 'targetPaths must be an array of path strings' };
    }
    for (const p of obj.targetPaths) {
      if (typeof p !== 'string' || p.length === 0) {
        return { valid: false, error: 'targetPaths must contain non-empty strings' };
      }
    }
  }

  return {
    valid: true,
    request: {
      mode,
      siteUrl: obj.siteUrl as string | undefined,
      businessInput: obj.businessInput as BusinessInput | undefined,
      constraints: obj.constraints as RunRequest['constraints'],
      writeBack: obj.writeBack as boolean | undefined,
      diffPreview: obj.diffPreview as boolean | undefined,
      targetRepo: obj.targetRepo as TargetRepoConfig | undefined,
      writeBackConfig: obj.writeBackConfig as WriteBackConfig | undefined,
      gscSnapshot: validatedGscRows,
      targetPaths: obj.targetPaths as string[] | undefined,
    },
  };
}

/**
 * Extracts GitHub token from request headers.
 */
function extractGitHubToken(request: Request): string | null {
  return request.headers.get(GITHUB_TOKEN_HEADER);
}

/**
 * Fetches existing file contents from GitHub for planning.
 */
async function fetchExistingContents(
  githubConfig: GitHubClientConfig,
  filePaths: string[]
): Promise<Map<string, string | null>> {
  const contents = new Map<string, string | null>();

  for (const filePath of filePaths) {
    try {
      const fileContent = await getFileContents(githubConfig, filePath);
      if (fileContent) {
        contents.set(filePath, decodeContent(fileContent.content));
      } else {
        contents.set(filePath, null);
      }
    } catch {
      // File doesn't exist or can't be read
      contents.set(filePath, null);
    }
  }

  return contents;
}

/**
 * Builds an action queue from gap analysis pages and optional GSC data.
 */
function buildActionQueue(
  pages: Array<{
    url: string;
    geoScore: number;
    gaps: Array<{ flag: string; severity?: string }>;
  }>,
  gscSnapshot?: GscSnapshotRow[]
): { items: ActionQueueItem[]; summary: { totalPagesAnalyzed: number; pagesWithGscData: number; averageScore: number } } {
  // Get URLs from pages
  const urls = pages.map(p => p.url);

  // Match GSC data if provided
  const gscMatches = gscSnapshot ? matchGscToPages(urls, gscSnapshot) : [];
  const gscMatchMap = new Map(gscMatches.map(m => [m.path, m]));

  // Build scoring inputs
  const scoringInputs: PageScoringInput[] = pages.map(page => {
    const normalizedPath = normalizePath(page.url);
    const gscMatch = gscMatchMap.get(normalizedPath);

    return {
      url: page.url,
      path: normalizedPath,
      geoScore: page.geoScore,
      gapFlags: page.gaps.map(g => g.flag),
      gscMetrics: gscMatch?.gscMetrics || null,
    };
  });

  // Score and generate action queue
  const scoredPages = scorePages(scoringInputs);
  const actionQueueResult = generateActionQueue(scoredPages);

  return {
    items: actionQueueResult.items,
    summary: {
      totalPagesAnalyzed: actionQueueResult.totalPagesAnalyzed,
      pagesWithGscData: actionQueueResult.pagesWithGscData,
      averageScore: actionQueueResult.averageScore,
    },
  };
}

/**
 * Handles "improve" mode execution.
 * Crawls site, generates patch-ready improvement blocks, and optionally writes back to GitHub.
 * Supports diff preview and idempotent block updates via path contract.
 */
async function handleImproveMode(
  request: RunRequest,
  githubToken: string | null
): Promise<RunResponse> {
  if (!request.siteUrl) {
    throw new Error('siteUrl is required for improve mode');
  }

  // Crawl the site
  const maxPages = request.constraints.maxPages ?? DEFAULT_CRAWLER_CONFIG.maxPages;
  const crawlResult = await crawlSite(request.siteUrl, { maxPages });

  // Run gap analysis first (needed for action queue)
  const gapAnalysis = analyzeGeoGaps(crawlResult);

  // Build action queue from gap analysis
  const actionQueueData = buildActionQueue(gapAnalysis.pages, request.gscSnapshot);

  // Determine which pages to target
  let selectedTargets: string[] | undefined;
  let pagesToImprove = crawlResult.pages;

  if (request.targetPaths && request.targetPaths.length > 0) {
    // Use explicitly provided target paths
    const normalizedTargets = new Set(request.targetPaths.map(p => normalizePath(p)));
    pagesToImprove = crawlResult.pages.filter(page => {
      const normalizedPath = normalizePath(page.url);
      return normalizedTargets.has(normalizedPath);
    });
    selectedTargets = request.targetPaths;
  } else if (request.gscSnapshot && request.gscSnapshot.length > 0) {
    // Auto-select top N from action queue based on scoring
    const autoSelectCount = Math.min(DEFAULT_AUTO_SELECT_TARGETS, maxPages);
    selectedTargets = selectTopTargets(
      { items: actionQueueData.items, totalPagesAnalyzed: actionQueueData.summary.totalPagesAnalyzed, pagesWithGscData: actionQueueData.summary.pagesWithGscData, averageScore: actionQueueData.summary.averageScore },
      autoSelectCount
    );

    // Filter to only the auto-selected pages
    const selectedPathSet = new Set(selectedTargets);
    pagesToImprove = crawlResult.pages.filter(page => {
      const normalizedPath = normalizePath(page.url);
      return selectedPathSet.has(normalizedPath);
    });
  }

  // Generate improvement plan for the selected pages
  const filteredCrawlResult = {
    ...crawlResult,
    pages: pagesToImprove,
    pagesAnalyzed: pagesToImprove.length,
  };
  const improvementPlan = planSiteImprovements(filteredCrawlResult);

  // Prepare base results
  const improvements: ImproveResults = {
    siteUrl: improvementPlan.siteUrl,
    totalPages: crawlResult.pagesAnalyzed, // Total crawled pages
    pagesWithImprovements: improvementPlan.pagesWithImprovements,
    pages: improvementPlan.pages,
    siteWideSuggestions: improvementPlan.siteWideSuggestions,
    crawlErrors: crawlResult.errors,
    selectedTargets,
    actionQueue: actionQueueData.items,
  };

  // Handle write-back / diff preview if configured
  let writeBackEnabled = false;
  let writeBackDryRun = true;

  // Check if we need to use the new path contract-based workflow
  const usePathContract = request.targetRepo &&
    request.targetRepo.projectType &&
    request.targetRepo.routeStrategy;

  if (usePathContract && request.targetRepo) {
    // New path contract-based workflow
    const pathContract: PathContractConfig = {
      projectType: request.targetRepo.projectType,
      routeStrategy: request.targetRepo.routeStrategy,
    };

    // Build GitHub client config (needed for fetching existing contents and writing)
    let githubConfig: GitHubClientConfig | null = null;
    if (githubToken) {
      githubConfig = {
        token: githubToken,
        target: {
          owner: request.targetRepo.owner,
          repo: request.targetRepo.repo,
          branch: request.targetRepo.branch,
        },
      };
    }

    // Map URLs to file paths to determine which files we need to fetch
    const filePaths: string[] = [];
    for (const page of improvementPlan.pages) {
      try {
        const mapping = mapUrlToFilePath(page.url, pathContract);
        filePaths.push(mapping.filePath);
      } catch {
        // Mapping errors will be captured during planning
      }
    }

    // Fetch existing contents if we have GitHub access
    let existingContents = new Map<string, string | null>();
    if (githubConfig) {
      try {
        existingContents = await fetchExistingContents(githubConfig, filePaths);
      } catch {
        // If we can't fetch, proceed with empty map (all files treated as new)
      }
    }

    // Plan patches with path contract
    const patchPlanConfig: PatchPlanConfig = {
      pathContract,
      patchOutputDir: request.writeBackConfig?.patchOutputDir ?? 'geo-patches',
    };

    const patchPlan = planPatches(improvementPlan.pages, existingContents, patchPlanConfig);

    // Build write-back result
    const writeBackResult: WriteBackResult = {
      success: true,
      dryRun: true,
      patchesGenerated: patchPlan.plannedChanges.length,
      patchesApplied: 0,
      commits: [],
      patches: patchPlan.plannedChanges.map(c => ({
        path: c.filePath,
        operation: c.action === 'no-op' ? 'update' : c.action,
        humanReviewRequired: c.humanReviewRequired,
        reviewNotes: c.reviewNotes,
      })),
      plannedChanges: patchPlan.plannedChanges.map(c => ({
        url: c.url,
        filePath: c.filePath,
        action: c.action,
        humanReviewRequired: c.humanReviewRequired,
        reviewNotes: c.reviewNotes,
      })),
      diffPreviews: patchPlan.diffPreviews,
      mappingErrors: patchPlan.mappingErrors,
      errors: [],
      warnings: patchPlan.warnings,
    };

    // If writeBack is true and we have GitHub access, apply the patches
    if (request.writeBack === true && githubConfig) {
      writeBackEnabled = true;

      // Verify write access before proceeding
      try {
        await verifyWriteAccess(githubConfig);
      } catch (err) {
        if (err instanceof GitHubAPIError) {
          throw new Error(`GitHub access verification failed: ${err.message}`);
        }
        throw err;
      }

      // Apply planned patches
      const applyResult = await applyPlannedPatches(
        githubConfig,
        patchPlan.plannedChanges,
        false // not dry run
      );

      writeBackDryRun = false;
      writeBackResult.success = applyResult.success;
      writeBackResult.dryRun = false;
      writeBackResult.patchesApplied = applyResult.patchesApplied;
      writeBackResult.commits = applyResult.commits;
      writeBackResult.errors = applyResult.errors;
      writeBackResult.warnings.push(...applyResult.warnings);
    } else if (request.diffPreview === true) {
      // Diff preview mode - just show diffs without GitHub token requirement
      writeBackResult.warnings.push('Diff preview mode - no files were written.');
    } else if (!githubToken && request.writeBack === true) {
      // Write-back requested but no token
      throw new Error(
        `Write-back requires GitHub token in ${GITHUB_TOKEN_HEADER} header`
      );
    } else {
      // Default dry run
      writeBackResult.warnings.push('Dry run mode - no files were written. Set writeBack: true to apply changes.');
    }

    improvements.writeBack = writeBackResult;
  } else if (request.writeBack === true && request.targetRepo) {
    // Legacy workflow (backwards compatibility)
    writeBackEnabled = true;

    // Validate GitHub token
    if (!githubToken) {
      throw new Error(
        `Write-back requires GitHub token in ${GITHUB_TOKEN_HEADER} header`
      );
    }

    // Build GitHub client config
    const githubConfig: GitHubClientConfig = {
      token: githubToken,
      target: {
        owner: request.targetRepo.owner,
        repo: request.targetRepo.repo,
        branch: request.targetRepo.branch,
      },
    };

    // Verify write access before proceeding
    try {
      await verifyWriteAccess(githubConfig);
    } catch (err) {
      if (err instanceof GitHubAPIError) {
        throw new Error(`GitHub access verification failed: ${err.message}`);
      }
      throw err;
    }

    // Build patch config
    const patchConfig: PatchApplierConfig = {
      pathMappings: request.writeBackConfig?.pathMappings?.map(m => ({
        urlPath: m.urlPath,
        filePath: m.filePath,
        fileType: m.fileType,
      })) ?? [],
      patchOutputDir: request.writeBackConfig?.patchOutputDir ?? 'geo-patches',
      dryRun: false,
    };

    // Generate and apply patches
    const patches = generatePatches(improvementPlan.pages, patchConfig);
    const patchResult = await applyPatches(githubConfig, patches, false);

    writeBackDryRun = false;

    // Add write-back result to response
    improvements.writeBack = {
      success: patchResult.success,
      dryRun: false,
      patchesGenerated: patchResult.patchesGenerated,
      patchesApplied: patchResult.patchesApplied,
      commits: patchResult.commits,
      patches: patchResult.patches.map(p => ({
        path: p.path,
        operation: p.operation,
        humanReviewRequired: p.humanReviewRequired,
        reviewNotes: p.reviewNotes,
      })),
      plannedChanges: [],
      diffPreviews: [],
      mappingErrors: [],
      errors: patchResult.errors,
      warnings: patchResult.warnings,
    };
  } else {
    // Dry run - just show what would be written (legacy mode)
    const patchConfig: PatchApplierConfig = {
      pathMappings: request.writeBackConfig?.pathMappings?.map(m => ({
        urlPath: m.urlPath,
        filePath: m.filePath,
        fileType: m.fileType,
      })) ?? [],
      patchOutputDir: request.writeBackConfig?.patchOutputDir ?? 'geo-patches',
      dryRun: true,
    };

    const patches = generatePatches(improvementPlan.pages, patchConfig);

    // Include dry-run patch info in response
    improvements.writeBack = {
      success: true,
      dryRun: true,
      patchesGenerated: patches.length,
      patchesApplied: 0,
      commits: [],
      patches: patches.map(p => ({
        path: p.path,
        operation: p.operation,
        humanReviewRequired: p.humanReviewRequired,
        reviewNotes: p.reviewNotes,
      })),
      plannedChanges: [],
      diffPreviews: [],
      mappingErrors: [],
      errors: [],
      warnings: ['Dry run mode - no files were written. Set writeBack: true to apply changes.'],
    };
  }

  const summary: RunSummary = {
    mode: 'improve',
    processedAt: new Date().toISOString(),
    inputSource: 'siteUrl',
    pagesAnalyzed: crawlResult.pagesAnalyzed,
    sitemapFound: crawlResult.sitemapFound,
    writeBackEnabled,
    writeBackDryRun,
    warnings: crawlResult.errors.length > 0 ? crawlResult.errors : undefined,
  };

  const results: RunResults = {
    improvements,
  };

  return {
    status: 'success',
    mode: 'improve',
    summary,
    results,
  };
}

/**
 * Handles "generate" mode execution.
 * Invokes the existing GEO pipeline with provided businessInput.
 */
async function handleGenerateMode(request: RunRequest): Promise<RunResponse> {
  if (!request.businessInput) {
    throw new Error('businessInput is required for generate mode');
  }

  // Execute the GEO pipeline
  const pipelineOutput = runGEOPipeline(request.businessInput);

  // Validate output against contract
  const outputErrors = validateGEOOutput(pipelineOutput);
  if (outputErrors.length > 0) {
    throw new Error(`Pipeline output validation failed: ${outputErrors.join(', ')}`);
  }

  const summary: RunSummary = {
    mode: 'generate',
    processedAt: new Date().toISOString(),
    inputSource: 'businessInput',
    sectionsGenerated: 5, // titleMeta, answerCapsule, serviceDescriptions, faq, schema
  };

  const results: RunResults = {
    titleMeta: pipelineOutput.titleMeta,
    answerCapsule: pipelineOutput.answerCapsule,
    serviceDescriptions: pipelineOutput.serviceDescriptions,
    faq: pipelineOutput.faq,
    schema: pipelineOutput.schema,
  };

  return {
    status: 'success',
    mode: 'generate',
    summary,
    results,
  };
}

/**
 * Handles "audit" mode execution.
 * Crawls site and performs GEO gap analysis.
 * Optionally generates prioritized action queue using GSC data.
 */
async function handleAuditMode(request: RunRequest): Promise<RunResponse> {
  if (!request.siteUrl) {
    throw new Error('siteUrl is required for audit mode');
  }

  // Crawl the site
  const maxPages = request.constraints.maxPages ?? DEFAULT_CRAWLER_CONFIG.maxPages;
  const crawlResult = await crawlSite(request.siteUrl, { maxPages });

  // Run gap analysis
  const gapAnalysis = analyzeGeoGaps(crawlResult);

  // Build action queue (always included, uses GSC data if provided)
  const actionQueueData = buildActionQueue(gapAnalysis.pages, request.gscSnapshot);

  const summary: RunSummary = {
    mode: 'audit',
    processedAt: new Date().toISOString(),
    inputSource: 'siteUrl',
    pagesAnalyzed: crawlResult.pagesAnalyzed,
    sitemapFound: crawlResult.sitemapFound,
    warnings: crawlResult.errors.length > 0 ? crawlResult.errors : undefined,
  };

  const auditResults: AuditResults = {
    siteUrl: gapAnalysis.siteUrl,
    totalPages: gapAnalysis.totalPages,
    pagesWithGaps: gapAnalysis.pagesWithGaps,
    averageGeoScore: gapAnalysis.averageGeoScore,
    criticalIssues: gapAnalysis.criticalIssues,
    warnings: gapAnalysis.warnings,
    suggestions: gapAnalysis.suggestions,
    siteWideIssues: gapAnalysis.siteWideIssues,
    pages: gapAnalysis.pages,
    crawlErrors: crawlResult.errors,
    actionQueue: actionQueueData.items,
    actionQueueSummary: actionQueueData.summary,
  };

  const results: RunResults = {
    audit: auditResults,
  };

  return {
    status: 'success',
    mode: 'audit',
    summary,
    results,
  };
}

// ============================================
// REVIEW SESSION ENDPOINTS (Baby Step 8D)
// ============================================

/**
 * Creates a review error response with requestId.
 */
function reviewErrorResponse(
  errorCode: ReviewApiErrorCode,
  message: string,
  status: number,
  requestId: string,
  details?: Record<string, unknown>
): Response {
  const body: ReviewErrorResponse & { requestId: string } = {
    status: 'error',
    requestId,
    errorCode,
    message,
    ...(details && { details }),
  };
  return jsonResponse(body as unknown as ApiErrorResponse, status, requestId);
}

/**
 * Validates the review create request body.
 */
function validateReviewCreateRequest(
  body: unknown
): { valid: true; request: ReviewCreateRequest } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const obj = body as Record<string, unknown>;

  // Mode must be 'improve'
  if (obj.mode !== 'improve') {
    return { valid: false, error: 'mode must be "improve" for review sessions' };
  }

  // siteUrl required
  if (!obj.siteUrl || typeof obj.siteUrl !== 'string') {
    return { valid: false, error: 'siteUrl is required' };
  }
  try {
    new URL(obj.siteUrl);
  } catch {
    return { valid: false, error: 'siteUrl must be a valid URL' };
  }

  // constraints required with noHallucinations
  if (!isValidConstraints(obj.constraints)) {
    return { valid: false, error: 'constraints.noHallucinations must be true' };
  }

  // targetRepo required
  if (!isValidTargetRepo(obj.targetRepo)) {
    return {
      valid: false,
      error: 'targetRepo must include owner, repo, branch, projectType (astro-pages|static-html), and routeStrategy (path-index|flat-html)',
    };
  }

  // Validate gscSnapshot if provided
  let validatedGscRows: GscSnapshotRow[] | undefined;
  if (obj.gscSnapshot !== undefined) {
    const gscValidation = validateGscSnapshot(obj.gscSnapshot);
    if (!gscValidation.valid && gscValidation.errors.length > 0) {
      const errorSummary = gscValidation.errors
        .slice(0, 3)
        .map(e => `row ${e.rowIndex}: ${e.message}`)
        .join('; ');
      return { valid: false, error: `Invalid gscSnapshot: ${errorSummary}` };
    }
    validatedGscRows = gscValidation.validRows;
  }

  // Validate targetPaths if provided
  if (obj.targetPaths !== undefined) {
    if (!Array.isArray(obj.targetPaths)) {
      return { valid: false, error: 'targetPaths must be an array of path strings' };
    }
    for (const p of obj.targetPaths) {
      if (typeof p !== 'string' || p.length === 0) {
        return { valid: false, error: 'targetPaths must contain non-empty strings' };
      }
    }
  }

  return {
    valid: true,
    request: {
      mode: 'improve',
      siteUrl: obj.siteUrl as string,
      constraints: obj.constraints as ReviewCreateRequest['constraints'],
      targetRepo: obj.targetRepo as TargetRepoConfig,
      writeBackConfig: obj.writeBackConfig as WriteBackConfig | undefined,
      gscSnapshot: validatedGscRows,
      targetPaths: obj.targetPaths as string[] | undefined,
    },
  };
}

/**
 * Handles POST /review/create
 * Creates a review session for improve mode planning.
 */
async function handleReviewCreate(
  request: Request,
  env: Env,
  keyRecord: ApiKeyRecord,
  requestId: string,
  logger: Logger
): Promise<Response> {
  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logger.error('Invalid JSON body', 'VALIDATION_ERROR');
    logger.complete(400, 'VALIDATION_ERROR');
    return reviewErrorResponse('VALIDATION_ERROR', 'Invalid JSON in request body', 400, requestId);
  }

  // Validate request
  const validation = validateReviewCreateRequest(body);
  if (!validation.valid) {
    logger.error(validation.error, 'VALIDATION_ERROR');
    logger.complete(400, 'VALIDATION_ERROR');
    return reviewErrorResponse('VALIDATION_ERROR', validation.error, 400, requestId);
  }

  const reviewRequest = validation.request;

  // Run improve mode planning (similar to handleImproveMode but without write-back)
  // Crawl the site
  const maxPages = reviewRequest.constraints.maxPages ?? DEFAULT_CRAWLER_CONFIG.maxPages;
  let crawlResult;
  try {
    crawlResult = await crawlSite(reviewRequest.siteUrl, { maxPages });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Crawl failed';
    logger.error(`Failed to crawl site: ${message}`, 'INTERNAL_ERROR');
    logger.complete(500, 'INTERNAL_ERROR');
    return reviewErrorResponse('INTERNAL_ERROR', `Failed to crawl site: ${message}`, 500, requestId);
  }

  // Run gap analysis
  const gapAnalysis = analyzeGeoGaps(crawlResult);

  // Build action queue
  const actionQueueData = buildActionQueue(gapAnalysis.pages, reviewRequest.gscSnapshot);

  // Determine which pages to target
  let selectedTargets: string[] = [];
  let pagesToImprove = crawlResult.pages;

  if (reviewRequest.targetPaths && reviewRequest.targetPaths.length > 0) {
    const normalizedTargets = new Set(reviewRequest.targetPaths.map(p => normalizePath(p)));
    pagesToImprove = crawlResult.pages.filter(page => {
      const normalizedPath = normalizePath(page.url);
      return normalizedTargets.has(normalizedPath);
    });
    selectedTargets = reviewRequest.targetPaths;
  } else if (reviewRequest.gscSnapshot && reviewRequest.gscSnapshot.length > 0) {
    const autoSelectCount = Math.min(DEFAULT_AUTO_SELECT_TARGETS, maxPages);
    selectedTargets = selectTopTargets(
      {
        items: actionQueueData.items,
        totalPagesAnalyzed: actionQueueData.summary.totalPagesAnalyzed,
        pagesWithGscData: actionQueueData.summary.pagesWithGscData,
        averageScore: actionQueueData.summary.averageScore,
      },
      autoSelectCount
    );
    const selectedPathSet = new Set(selectedTargets);
    pagesToImprove = crawlResult.pages.filter(page => {
      const normalizedPath = normalizePath(page.url);
      return selectedPathSet.has(normalizedPath);
    });
  } else {
    // No targeting - use all crawled pages
    selectedTargets = crawlResult.pages.map(p => normalizePath(p.url));
  }

  // Generate improvement plan
  const filteredCrawlResult = {
    ...crawlResult,
    pages: pagesToImprove,
    pagesAnalyzed: pagesToImprove.length,
  };
  const improvementPlan = planSiteImprovements(filteredCrawlResult);

  // Build path contract config
  const pathContract: PathContractConfig = {
    projectType: reviewRequest.targetRepo.projectType,
    routeStrategy: reviewRequest.targetRepo.routeStrategy,
  };

  // Map URLs to file paths and fetch existing contents
  const filePaths: string[] = [];
  for (const page of improvementPlan.pages) {
    try {
      const mapping = mapUrlToFilePath(page.url, pathContract);
      filePaths.push(mapping.filePath);
    } catch {
      // Mapping errors will be captured during planning
    }
  }

  // Plan patches (without GitHub access - we can't fetch existing content)
  // For review sessions, we plan with empty existing contents
  const patchPlanConfig: PatchPlanConfig = {
    pathContract,
    patchOutputDir: reviewRequest.writeBackConfig?.patchOutputDir ?? 'geo-patches',
  };

  const existingContents = new Map<string, string | null>();
  for (const path of filePaths) {
    existingContents.set(path, null); // Assume all files are new for planning
  }

  const patchPlan = planPatches(improvementPlan.pages, existingContents, patchPlanConfig);

  // Build review session data
  const plannedFiles: ReviewPlannedFile[] = patchPlan.plannedChanges.map(c => ({
    url: c.url,
    filePath: c.filePath,
    action: c.action,
    humanReviewRequired: c.humanReviewRequired,
    reviewNotes: c.reviewNotes,
  }));

  const diffPreviews: ReviewDiffPreview[] = patchPlan.diffPreviews;

  const patches: ReviewPatch[] = patchPlan.plannedChanges.map(c => ({
    url: c.url,
    filePath: c.filePath,
    newContent: c.newContent,
    originalContent: c.originalContent,
  }));

  // Create and store the session
  const session = createReviewSession({
    siteUrl: reviewRequest.siteUrl,
    selectedTargets,
    plannedFiles,
    diffPreviews,
    patches,
    targetRepo: reviewRequest.targetRepo,
  });

  await storeSession(env.NICO_GEO_SESSIONS, session);

  // Build response
  const filesRequiringReview = plannedFiles.filter(f => f.humanReviewRequired).length;
  const response: ReviewCreateResponse & { requestId: string } = {
    status: 'success',
    requestId,
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
    summary: {
      siteUrl: session.siteUrl,
      selectedTargets: session.selectedTargets,
      plannedFilesCount: plannedFiles.length,
      filesRequiringReview,
    },
  };

  logger.complete(201);
  return jsonResponse(response as unknown as RunResponse, 201, requestId);
}

/**
 * Handles GET /review/{sessionId}
 * Returns session details for review.
 */
async function handleReviewGet(
  sessionId: string,
  env: Env,
  requestId: string,
  logger: Logger
): Promise<Response> {
  // Validate session ID format
  if (!isValidSessionId(sessionId)) {
    logger.error('Invalid session ID format', 'VALIDATION_ERROR');
    logger.complete(400, 'VALIDATION_ERROR');
    return reviewErrorResponse('VALIDATION_ERROR', 'Invalid session ID format', 400, requestId);
  }

  // Get session
  const result = await getSessionWithExpirationCheck(env.NICO_GEO_SESSIONS, sessionId);

  if (!result.found) {
    logger.error('Review session not found', 'SESSION_NOT_FOUND');
    logger.complete(404, 'SESSION_NOT_FOUND');
    return reviewErrorResponse('SESSION_NOT_FOUND', 'Review session not found', 404, requestId);
  }

  const session = result.session;

  // Build response (exclude sensitive data like full patch content)
  const response: ReviewGetResponse & { requestId: string } = {
    status: 'success',
    requestId,
    session: {
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      status: session.status,
      siteUrl: session.siteUrl,
      selectedTargets: session.selectedTargets,
      plannedFiles: session.plannedFiles,
      diffPreviews: session.diffPreviews,
      patchCount: session.patches.length,
      targetRepo: {
        owner: session.targetRepo.owner,
        repo: session.targetRepo.repo,
        branch: session.targetRepo.branch,
      },
      commitShas: session.commitShas,
    },
  };

  logger.complete(200);
  return jsonResponse(response as unknown as RunResponse, 200, requestId);
}

/**
 * Handles POST /review/{sessionId}/approve
 * Marks a session as approved.
 */
async function handleReviewApprove(
  sessionId: string,
  env: Env,
  keyRecord: ApiKeyRecord,
  requestId: string,
  logger: Logger
): Promise<Response> {
  // Validate session ID format
  if (!isValidSessionId(sessionId)) {
    logger.error('Invalid session ID format', 'VALIDATION_ERROR');
    logger.complete(400, 'VALIDATION_ERROR');
    return reviewErrorResponse('VALIDATION_ERROR', 'Invalid session ID format', 400, requestId);
  }

  // Pro plan required for approval (same as write-back)
  if (keyRecord.plan !== 'pro') {
    logger.error('Pro plan required', 'PLAN_REQUIRED');
    logger.complete(403, 'PLAN_REQUIRED');
    return reviewErrorResponse(
      'PLAN_REQUIRED',
      'Review session approval requires a pro plan',
      403,
      requestId,
      { currentPlan: keyRecord.plan, requiredPlan: 'pro' }
    );
  }

  // Get session
  const result = await getSessionWithExpirationCheck(env.NICO_GEO_SESSIONS, sessionId);

  if (!result.found) {
    logger.error('Session not found', 'SESSION_NOT_FOUND');
    logger.complete(404, 'SESSION_NOT_FOUND');
    return reviewErrorResponse('SESSION_NOT_FOUND', 'Review session not found', 404, requestId);
  }

  const session = result.session;

  // Check if can be approved
  const canApprove = canApproveSession(session);
  if (!canApprove.canApprove) {
    if (session.status === 'expired' || result.expired) {
      logger.error('Session expired', 'SESSION_EXPIRED');
      logger.complete(410, 'SESSION_EXPIRED');
      return reviewErrorResponse('SESSION_EXPIRED', canApprove.reason!, 410, requestId);
    }
    if (session.status === 'applied') {
      logger.error('Session already applied', 'SESSION_ALREADY_APPLIED');
      logger.complete(409, 'SESSION_ALREADY_APPLIED');
      return reviewErrorResponse('SESSION_ALREADY_APPLIED', canApprove.reason!, 409, requestId);
    }
    logger.error(canApprove.reason!, 'VALIDATION_ERROR');
    logger.complete(400, 'VALIDATION_ERROR');
    return reviewErrorResponse('VALIDATION_ERROR', canApprove.reason!, 400, requestId);
  }

  const previousStatus = session.status;

  // Update status
  await updateSessionStatus(env.NICO_GEO_SESSIONS, sessionId, 'approved');

  const response: ReviewApproveResponse & { requestId: string } = {
    status: 'success',
    requestId,
    sessionId,
    previousStatus,
    newStatus: 'approved',
  };

  logger.complete(200);
  return jsonResponse(response as unknown as RunResponse, 200, requestId);
}

/**
 * Handles POST /review/{sessionId}/apply
 * Applies the approved session changes to GitHub.
 */
async function handleReviewApply(
  sessionId: string,
  request: Request,
  env: Env,
  keyRecord: ApiKeyRecord,
  requestId: string,
  logger: Logger
): Promise<Response> {
  // Validate session ID format
  if (!isValidSessionId(sessionId)) {
    logger.error('Invalid session ID format', 'VALIDATION_ERROR');
    logger.complete(400, 'VALIDATION_ERROR');
    return reviewErrorResponse('VALIDATION_ERROR', 'Invalid session ID format', 400, requestId);
  }

  // Pro plan required for apply
  if (keyRecord.plan !== 'pro') {
    logger.error('Pro plan required', 'PLAN_REQUIRED');
    logger.complete(403, 'PLAN_REQUIRED');
    return reviewErrorResponse(
      'PLAN_REQUIRED',
      'Review session apply requires a pro plan',
      403,
      requestId,
      { currentPlan: keyRecord.plan, requiredPlan: 'pro' }
    );
  }

  // GitHub token required at apply time (never stored)
  const githubToken = extractGitHubToken(request);
  if (!githubToken) {
    logger.error('GitHub token required', 'VALIDATION_ERROR');
    logger.complete(400, 'VALIDATION_ERROR');
    return reviewErrorResponse(
      'VALIDATION_ERROR',
      `GitHub token required in ${GITHUB_TOKEN_HEADER} header`,
      400,
      requestId
    );
  }

  // Get session
  const result = await getSessionWithExpirationCheck(env.NICO_GEO_SESSIONS, sessionId);

  if (!result.found) {
    logger.error('Session not found', 'SESSION_NOT_FOUND');
    logger.complete(404, 'SESSION_NOT_FOUND');
    return reviewErrorResponse('SESSION_NOT_FOUND', 'Review session not found', 404, requestId);
  }

  const session = result.session;

  // Check if can be applied
  const canApply = canApplySession(session);
  if (!canApply.canApply) {
    // Handle idempotent case - already applied
    if (canApply.isIdempotent && session.commitShas) {
      const response: ReviewApplyResponse & { requestId: string } = {
        status: 'success',
        requestId,
        sessionId,
        applied: false,
        commitShas: session.commitShas,
        message: 'Session was already applied. Returning existing commit SHAs.',
      };
      logger.complete(200);
      return jsonResponse(response as unknown as RunResponse, 200, requestId);
    }

    if (session.status === 'expired' || result.expired) {
      logger.error('Session expired', 'SESSION_EXPIRED');
      logger.complete(410, 'SESSION_EXPIRED');
      return reviewErrorResponse('SESSION_EXPIRED', canApply.reason!, 410, requestId);
    }
    if (session.status !== 'approved') {
      logger.error('Session not approved', 'SESSION_NOT_APPROVED');
      logger.complete(400, 'SESSION_NOT_APPROVED');
      return reviewErrorResponse('SESSION_NOT_APPROVED', canApply.reason!, 400, requestId);
    }
    logger.error(canApply.reason!, 'VALIDATION_ERROR');
    logger.complete(400, 'VALIDATION_ERROR');
    return reviewErrorResponse('VALIDATION_ERROR', canApply.reason!, 400, requestId);
  }

  // Build GitHub config
  const githubConfig: GitHubClientConfig = {
    token: githubToken,
    target: {
      owner: session.targetRepo.owner,
      repo: session.targetRepo.repo,
      branch: session.targetRepo.branch,
    },
  };

  // Verify write access
  try {
    await verifyWriteAccess(githubConfig);
  } catch (err) {
    if (err instanceof GitHubAPIError) {
      logger.error(`GitHub access verification failed: ${err.message}`, 'VALIDATION_ERROR');
      logger.complete(403, 'VALIDATION_ERROR');
      return reviewErrorResponse(
        'VALIDATION_ERROR',
        `GitHub access verification failed: ${err.message}`,
        403,
        requestId
      );
    }
    throw err;
  }

  // Convert session patches to planned changes for application
  const plannedChanges = session.patches.map(p => ({
    url: p.url,
    filePath: p.filePath,
    action: session.plannedFiles.find(f => f.filePath === p.filePath)?.action ?? 'create' as const,
    originalContent: p.originalContent,
    newContent: p.newContent,
    humanReviewRequired: false,
    reviewNotes: [],
  }));

  // Apply patches
  const applyResult = await applyPlannedPatches(githubConfig, plannedChanges, false);

  if (!applyResult.success) {
    logger.error(`Write-back failed: ${applyResult.errors.join(', ')}`, 'INTERNAL_ERROR');
    logger.complete(500, 'INTERNAL_ERROR');
    return reviewErrorResponse(
      'INTERNAL_ERROR',
      `Write-back failed: ${applyResult.errors.join(', ')}`,
      500,
      requestId
    );
  }

  // Extract commit SHAs
  const commitShas = applyResult.commits.map(c => c.sha);

  // Update session status to applied
  await updateSessionStatus(env.NICO_GEO_SESSIONS, sessionId, 'applied', commitShas);

  const response: ReviewApplyResponse & { requestId: string } = {
    status: 'success',
    requestId,
    sessionId,
    applied: true,
    commitShas,
    message: `Successfully applied ${applyResult.patchesApplied} patches`,
  };

  logger.complete(200);
  return jsonResponse(response as unknown as RunResponse, 200, requestId);
}

/**
 * Routes review-related requests to appropriate handlers.
 * Endpoints:
 *   POST /review/create - Create a new review session
 *   GET /review/{sessionId} - Get session details
 *   POST /review/{sessionId}/approve - Approve a session
 *   POST /review/{sessionId}/apply - Apply approved session changes
 */
async function handleReviewRoutes(
  request: Request,
  url: URL,
  env: Env,
  requestId: string,
  logger: Logger
): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  // POST /review/create
  if (path === '/review/create' && method === 'POST') {
    // Authenticate
    const authResult = await authenticateRequest(request, env.NICO_GEO_KEYS);
    if (!authResult.valid) {
      logger.error('Authentication failed', authResult.errorCode);
      logger.complete(401, authResult.errorCode);
      return reviewErrorResponse(authResult.errorCode, authResult.message, 401, requestId);
    }
    logger.setKeyId(authResult.keyRecord.keyId);

    // Rate limit
    const rateLimitResult = await checkRateLimit(
      authResult.keyRecord.keyId,
      authResult.keyRecord.plan,
      env.RATE_LIMITER
    );
    if (!rateLimitResult.allowed) {
      logger.error('Rate limit exceeded', rateLimitResult.errorCode);
      logger.complete(429, rateLimitResult.errorCode);
      return reviewErrorResponse(
        rateLimitResult.errorCode,
        rateLimitResult.message,
        429,
        requestId,
        { retryAfterSeconds: rateLimitResult.retryAfterSeconds }
      );
    }

    return handleReviewCreate(request, env, authResult.keyRecord, requestId, logger);
  }

  // Match /review/{sessionId} patterns
  const sessionMatch = path.match(/^\/review\/([a-f0-9-]+)(\/.*)?$/);
  if (!sessionMatch) {
    logger.error('Invalid review endpoint', 'VALIDATION_ERROR');
    logger.complete(404, 'VALIDATION_ERROR');
    return reviewErrorResponse('VALIDATION_ERROR', 'Invalid review endpoint', 404, requestId);
  }

  const sessionId = sessionMatch[1];
  const subPath = sessionMatch[2] || '';

  // GET /review/{sessionId}
  if (subPath === '' && method === 'GET') {
    // Authenticate (read access allowed for any valid key)
    const authResult = await authenticateRequest(request, env.NICO_GEO_KEYS);
    if (!authResult.valid) {
      logger.error('Authentication failed', authResult.errorCode);
      logger.complete(401, authResult.errorCode);
      return reviewErrorResponse(authResult.errorCode, authResult.message, 401, requestId);
    }
    logger.setKeyId(authResult.keyRecord.keyId);

    return handleReviewGet(sessionId, env, requestId, logger);
  }

  // POST /review/{sessionId}/approve
  if (subPath === '/approve' && method === 'POST') {
    // Authenticate
    const authResult = await authenticateRequest(request, env.NICO_GEO_KEYS);
    if (!authResult.valid) {
      logger.error('Authentication failed', authResult.errorCode);
      logger.complete(401, authResult.errorCode);
      return reviewErrorResponse(authResult.errorCode, authResult.message, 401, requestId);
    }
    logger.setKeyId(authResult.keyRecord.keyId);

    // Rate limit
    const rateLimitResult = await checkRateLimit(
      authResult.keyRecord.keyId,
      authResult.keyRecord.plan,
      env.RATE_LIMITER
    );
    if (!rateLimitResult.allowed) {
      logger.error('Rate limit exceeded', rateLimitResult.errorCode);
      logger.complete(429, rateLimitResult.errorCode);
      return reviewErrorResponse(
        rateLimitResult.errorCode,
        rateLimitResult.message,
        429,
        requestId,
        { retryAfterSeconds: rateLimitResult.retryAfterSeconds }
      );
    }

    return handleReviewApprove(sessionId, env, authResult.keyRecord, requestId, logger);
  }

  // POST /review/{sessionId}/apply
  if (subPath === '/apply' && method === 'POST') {
    // Authenticate
    const authResult = await authenticateRequest(request, env.NICO_GEO_KEYS);
    if (!authResult.valid) {
      logger.error('Authentication failed', authResult.errorCode);
      logger.complete(401, authResult.errorCode);
      return reviewErrorResponse(authResult.errorCode, authResult.message, 401, requestId);
    }
    logger.setKeyId(authResult.keyRecord.keyId);

    // Rate limit
    const rateLimitResult = await checkRateLimit(
      authResult.keyRecord.keyId,
      authResult.keyRecord.plan,
      env.RATE_LIMITER
    );
    if (!rateLimitResult.allowed) {
      logger.error('Rate limit exceeded', rateLimitResult.errorCode);
      logger.complete(429, rateLimitResult.errorCode);
      return reviewErrorResponse(
        rateLimitResult.errorCode,
        rateLimitResult.message,
        429,
        requestId,
        { retryAfterSeconds: rateLimitResult.retryAfterSeconds }
      );
    }

    return handleReviewApply(sessionId, request, env, authResult.keyRecord, requestId, logger);
  }

  // Unknown review endpoint
  logger.error('Invalid review endpoint or method', 'VALIDATION_ERROR');
  logger.complete(404, 'VALIDATION_ERROR');
  return reviewErrorResponse('VALIDATION_ERROR', 'Invalid review endpoint or method', 404, requestId);
}

/**
 * HTML page for the GEO Audit UI.
 */
const AUDIT_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GEO Audit</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; color: #1a1a2e; line-height: 1.6; padding: 20px; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { font-size: 2rem; margin-bottom: 8px; color: #1a1a2e; }
    .subtitle { color: #666; margin-bottom: 24px; }
    .form-group { display: flex; gap: 12px; margin-bottom: 24px; }
    input[type="url"] { flex: 1; padding: 12px 16px; font-size: 16px; border: 2px solid #ddd; border-radius: 8px; outline: none; transition: border-color 0.2s; }
    input[type="url"]:focus { border-color: #4f46e5; }
    button { padding: 12px 24px; font-size: 16px; font-weight: 600; background: #4f46e5; color: white; border: none; border-radius: 8px; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #4338ca; }
    button:disabled { background: #9ca3af; cursor: not-allowed; }
    .status { padding: 16px; background: #e0e7ff; border-radius: 8px; margin-bottom: 24px; display: none; }
    .status.error { background: #fee2e2; color: #991b1b; }
    .status.loading { display: block; }
    .results { display: none; }
    .results.visible { display: block; }
    .section { background: white; border-radius: 12px; padding: 24px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .section h2 { font-size: 1.25rem; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; }
    .summary-item { text-align: center; padding: 16px; background: #f9fafb; border-radius: 8px; }
    .summary-value { font-size: 2rem; font-weight: 700; color: #4f46e5; }
    .summary-label { font-size: 0.875rem; color: #666; margin-top: 4px; }
    .priority-list { list-style: none; }
    .priority-item { padding: 16px; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 12px; }
    .priority-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .priority-badge { padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
    .priority-critical { background: #fee2e2; color: #991b1b; }
    .priority-high { background: #fef3c7; color: #92400e; }
    .priority-medium { background: #e0e7ff; color: #3730a3; }
    .priority-low { background: #f3f4f6; color: #374151; }
    .priority-url { font-family: monospace; font-size: 0.875rem; color: #4f46e5; word-break: break-all; }
    .priority-problem { font-weight: 600; margin: 8px 0 4px; }
    .priority-why { color: #666; font-size: 0.875rem; margin-bottom: 8px; }
    .priority-fix { background: #f0fdf4; padding: 12px; border-radius: 6px; font-size: 0.875rem; }
    .priority-fix strong { color: #166534; }
    .show-more { background: none; border: 2px solid #4f46e5; color: #4f46e5; margin-top: 8px; }
    .show-more:hover { background: #4f46e5; color: white; }
    .hidden-items { display: none; }
    .hidden-items.visible { display: block; }
    .footer { text-align: center; color: #666; font-size: 0.875rem; padding: 16px 0; }
    .score-good { color: #059669; }
    .score-ok { color: #d97706; }
    .score-bad { color: #dc2626; }
  </style>
</head>
<body>
  <div class="container">
    <h1>GEO Audit</h1>
    <p class="subtitle">Analyze your website for Generative Engine Optimization readiness</p>

    <div class="form-group">
      <input type="url" id="siteUrl" placeholder="https://example.com" required>
      <button id="runAudit">Run Audit</button>
    </div>

    <div class="status" id="status">Running audit...</div>

    <div class="results" id="results">
      <div class="section">
        <h2>Executive Summary</h2>
        <div class="summary-grid" id="summaryGrid"></div>
      </div>

      <div class="section">
        <h2>Top Priority Issues</h2>
        <ul class="priority-list" id="priorityList"></ul>
        <div class="hidden-items" id="hiddenItems"></div>
        <button class="show-more" id="showMore" style="display:none;">Show More Issues</button>
      </div>

      <div class="section footer" id="footer"></div>
    </div>
  </div>

  <script>
    const INITIAL_DISPLAY = 5;
    const ACTION_LABELS = {
      add_answer_capsule: { problem: 'Missing Answer Capsule', why: 'AI engines prioritize pages with direct, concise answers that can be featured in AI responses.', fix: 'Add a clear, 2-3 sentence answer capsule near the top of the page that directly addresses the main query.' },
      add_faq: { problem: 'Missing FAQ Section', why: 'Structured FAQ content helps AI engines understand and cite your expertise on common questions.', fix: 'Add a FAQ section with 3-5 relevant questions and clear answers using proper heading structure.' },
      add_schema: { problem: 'Missing Schema Markup', why: 'Schema markup helps AI engines understand your content structure and increases citation likelihood.', fix: 'Implement LocalBusiness, Service, or FAQ schema markup appropriate to your page content.' },
      improve_meta: { problem: 'Weak Title/Meta Description', why: 'Optimized meta content improves how AI engines summarize and present your pages.', fix: 'Write a compelling title (50-60 chars) and meta description (150-160 chars) that clearly state the page purpose.' },
      increase_depth: { problem: 'Thin Content', why: 'AI engines favor comprehensive content that thoroughly covers a topic over shallow pages.', fix: 'Expand content to at least 800 words with detailed explanations, examples, and supporting information.' },
      fix_internal_links: { problem: 'Poor Internal Linking', why: 'Strong internal links help AI engines understand your site structure and content relationships.', fix: 'Add 3-5 relevant internal links to related pages using descriptive anchor text.' }
    };

    function getPriorityClass(score) {
      if (score >= 70) return 'priority-critical';
      if (score >= 50) return 'priority-high';
      if (score >= 30) return 'priority-medium';
      return 'priority-low';
    }

    function getPriorityLabel(score) {
      if (score >= 70) return 'Critical';
      if (score >= 50) return 'High';
      if (score >= 30) return 'Medium';
      return 'Low';
    }

    function getScoreClass(score) {
      if (score >= 70) return 'score-good';
      if (score >= 40) return 'score-ok';
      return 'score-bad';
    }

    function renderPriorityItem(item) {
      const action = ACTION_LABELS[item.recommendedNextAction] || { problem: item.recommendedNextAction, why: 'This issue impacts your GEO readiness.', fix: 'Address the identified gap.' };
      const priorityClass = getPriorityClass(item.totalScore);
      const priorityLabel = getPriorityLabel(item.totalScore);
      return \`
        <li class="priority-item">
          <div class="priority-header">
            <span class="priority-badge \${priorityClass}">\${priorityLabel}</span>
            <span class="priority-url">\${item.path}</span>
          </div>
          <div class="priority-problem">\${action.problem}</div>
          <div class="priority-why">\${action.why}</div>
          <div class="priority-fix"><strong>Recommended Fix:</strong> \${action.fix}</div>
        </li>
      \`;
    }

    async function runAudit() {
      const urlInput = document.getElementById('siteUrl');
      const btn = document.getElementById('runAudit');
      const status = document.getElementById('status');
      const results = document.getElementById('results');
      const siteUrl = urlInput.value.trim();

      if (!siteUrl) { alert('Please enter a URL'); return; }

      btn.disabled = true;
      status.className = 'status loading';
      status.textContent = 'Running audit... This may take a minute.';
      results.className = 'results';

      try {
        const res = await fetch('/ui/audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteUrl })
        });
        const data = await res.json();

        if (data.status === 'error') {
          throw new Error(data.message || data.error || 'Audit failed');
        }

        const audit = data.results?.audit;
        if (!audit) throw new Error('No audit results returned');

        // Render summary
        const scoreClass = getScoreClass(audit.averageGeoScore);
        document.getElementById('summaryGrid').innerHTML = \`
          <div class="summary-item"><div class="summary-value">\${audit.totalPages}</div><div class="summary-label">Pages Scanned</div></div>
          <div class="summary-item"><div class="summary-value \${scoreClass}">\${Math.round(audit.averageGeoScore)}</div><div class="summary-label">GEO Score</div></div>
          <div class="summary-item"><div class="summary-value" style="color:#dc2626">\${audit.criticalIssues}</div><div class="summary-label">Critical Issues</div></div>
          <div class="summary-item"><div class="summary-value" style="color:#d97706">\${audit.warnings}</div><div class="summary-label">Warnings</div></div>
        \`;

        // Render priority items
        const queue = audit.actionQueue || [];
        const priorityList = document.getElementById('priorityList');
        const hiddenItems = document.getElementById('hiddenItems');
        const showMoreBtn = document.getElementById('showMore');

        if (queue.length === 0) {
          priorityList.innerHTML = '<li class="priority-item" style="text-align:center;color:#059669;">No major issues found. Your site has good GEO readiness!</li>';
          hiddenItems.innerHTML = '';
          showMoreBtn.style.display = 'none';
        } else {
          const visible = queue.slice(0, INITIAL_DISPLAY);
          const hidden = queue.slice(INITIAL_DISPLAY);
          priorityList.innerHTML = visible.map(renderPriorityItem).join('');

          if (hidden.length > 0) {
            hiddenItems.innerHTML = hidden.map(renderPriorityItem).join('');
            showMoreBtn.style.display = 'block';
            showMoreBtn.textContent = \`Show \${hidden.length} More Issues\`;
          } else {
            hiddenItems.innerHTML = '';
            showMoreBtn.style.display = 'none';
          }
        }

        // Render footer
        document.getElementById('footer').innerHTML = \`
          <div>Audited: <strong>\${audit.siteUrl}</strong></div>
          <div>Completed: \${new Date().toLocaleString()}</div>
        \`;

        status.className = 'status';
        results.className = 'results visible';

      } catch (err) {
        status.className = 'status error';
        status.textContent = 'Error: ' + err.message;
        status.style.display = 'block';
      } finally {
        btn.disabled = false;
      }
    }

    document.getElementById('runAudit').addEventListener('click', runAudit);
    document.getElementById('siteUrl').addEventListener('keypress', (e) => { if (e.key === 'Enter') runAudit(); });
    document.getElementById('showMore').addEventListener('click', function() {
      const hidden = document.getElementById('hiddenItems');
      hidden.classList.toggle('visible');
      this.textContent = hidden.classList.contains('visible') ? 'Show Less' : this.textContent;
    });
  </script>
</body>
</html>`;

/**
 * Handles the UI audit endpoint (no auth required).
 */
async function handleUIAudit(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { siteUrl?: string };
    const siteUrl = body?.siteUrl;

    if (!siteUrl || typeof siteUrl !== 'string') {
      return new Response(JSON.stringify({ status: 'error', message: 'siteUrl is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    try {
      new URL(siteUrl);
    } catch {
      return new Response(JSON.stringify({ status: 'error', message: 'Invalid URL format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    const auditRequest: RunRequest = {
      mode: 'audit',
      siteUrl,
      constraints: { noHallucinations: true },
    };

    const response = await handleAuditMode(auditRequest);

    return new Response(JSON.stringify(response, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Audit failed';
    return new Response(JSON.stringify({ status: 'error', message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
}

/**
 * Main request handler for the Worker.
 */
async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // Get or create request ID early
  const requestId = getOrCreateRequestId(request);
  const logger = createLogger(request, requestId);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    const headers = new Headers(CORS_HEADERS);
    headers.set(REQUEST_ID_HEADER, requestId);
    return new Response(null, {
      status: 204,
      headers,
    });
  }

  // ============================================
  // ROUTE: GET / (Audit UI) - MUST BE FIRST
  // ============================================
  if (url.pathname === '/' && request.method === 'GET') {
    return new Response(AUDIT_UI_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // ============================================
  // ROUTE: POST /ui/audit (UI audit endpoint, no auth)
  // ============================================
  if (url.pathname === '/ui/audit' && request.method === 'POST') {
    return handleUIAudit(request);
  }

  // ============================================
  // ROUTE: GET /health (No auth, no rate limit)
  // ============================================
  if (url.pathname === '/health' && request.method === 'GET') {
    logger.complete(200);
    return jsonResponse({ status: 'ok' } as unknown as RunResponse, 200, requestId);
  }

  // ============================================
  // ROUTE: GET /version (No auth, no rate limit)
  // ============================================
  if (url.pathname === '/version' && request.method === 'GET') {
    logger.complete(200);
    return jsonResponse({
      version: VERSION_INFO.version,
      buildTime: VERSION_INFO.buildTime,
      gitSha: VERSION_INFO.gitSha,
    } as unknown as RunResponse, 200, requestId);
  }

  // ============================================
  // ROUTE: /review/* (Review Session Endpoints)
  // ============================================
  if (url.pathname.startsWith('/review')) {
    return handleReviewRoutes(request, url, env, requestId, logger);
  }

  // ============================================
  // ROUTE: POST /run (Main API Endpoint)
  // ============================================
  if (request.method !== 'POST') {
    logger.error('Method not allowed', 'VALIDATION_ERROR');
    logger.complete(405, 'VALIDATION_ERROR');
    return apiErrorResponse('VALIDATION_ERROR', 'Method not allowed. Use POST.', 405, requestId);
  }

  if (url.pathname !== '/run') {
    logger.error('Route not found', 'VALIDATION_ERROR');
    logger.complete(404, 'VALIDATION_ERROR');
    return apiErrorResponse('VALIDATION_ERROR', 'Not found. Use POST /run', 404, requestId);
  }

  // ============================================
  // PAYLOAD SIZE GUARD
  // ============================================
  const contentLength = request.headers.get('content-length');
  if (isPayloadTooLarge(contentLength)) {
    logger.error('Payload too large', 'PAYLOAD_TOO_LARGE', { contentLength: contentLength || 'unknown' });
    logger.complete(413, 'PAYLOAD_TOO_LARGE');
    return apiErrorResponse(
      'PAYLOAD_TOO_LARGE',
      `Request payload exceeds maximum allowed size of ${MAX_PAYLOAD_SIZE_BYTES} bytes`,
      413,
      requestId
    );
  }

  // ============================================
  // AUTHENTICATION
  // ============================================
  const authResult = await authenticateRequest(request, env.NICO_GEO_KEYS);
  if (!authResult.valid) {
    logger.error('Authentication failed', authResult.errorCode);
    logger.complete(401, authResult.errorCode);
    return apiErrorResponse(authResult.errorCode, authResult.message, 401, requestId);
  }

  const keyRecord = authResult.keyRecord;
  logger.setKeyId(keyRecord.keyId);

  // ============================================
  // RATE LIMITING
  // ============================================
  const rateLimitResult = await checkRateLimit(
    keyRecord.keyId,
    keyRecord.plan,
    env.RATE_LIMITER
  );

  if (!rateLimitResult.allowed) {
    logger.error('Rate limit exceeded', rateLimitResult.errorCode);
    logger.complete(429, rateLimitResult.errorCode);
    return apiErrorResponse(
      rateLimitResult.errorCode,
      rateLimitResult.message,
      429,
      requestId,
      {
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
        usage: toUsageInfo(rateLimitResult.usage),
      }
    );
  }

  const usage = rateLimitResult.usage;

  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logger.error('Invalid JSON body', 'VALIDATION_ERROR');
    logger.complete(400, 'VALIDATION_ERROR');
    return apiErrorResponse('VALIDATION_ERROR', 'Invalid JSON in request body', 400, requestId);
  }

  // Validate request structure
  const validation = validateRequest(body);
  if (!validation.valid) {
    logger.error(validation.error, 'VALIDATION_ERROR');
    logger.complete(400, 'VALIDATION_ERROR');
    return apiErrorResponse('VALIDATION_ERROR', validation.error, 400, requestId);
  }

  const runRequest = validation.request;
  logger.setMode(runRequest.mode);

  // Enforce noHallucinations constraint
  if (!runRequest.constraints.noHallucinations) {
    logger.error('noHallucinations must be true', 'VALIDATION_ERROR');
    logger.complete(400, 'VALIDATION_ERROR');
    return apiErrorResponse(
      'VALIDATION_ERROR',
      'constraints.noHallucinations must be true',
      400,
      requestId
    );
  }

  // ============================================
  // PLAN GATING: Write-back requires pro plan
  // ============================================
  if (runRequest.writeBack === true && keyRecord.plan !== 'pro') {
    logger.error('Write-back requires pro plan', 'PLAN_REQUIRED');
    logger.complete(403, 'PLAN_REQUIRED');
    return apiErrorResponse(
      'PLAN_REQUIRED',
      'Write-back feature requires a pro plan. Upgrade to enable write-back.',
      403,
      requestId,
      { currentPlan: keyRecord.plan, requiredPlan: 'pro' }
    );
  }

  // Extract GitHub token for write-back operations
  const githubToken = extractGitHubToken(request);

  // Route to appropriate handler
  try {
    let response: RunResponse;

    switch (runRequest.mode) {
      case 'improve':
        response = await handleImproveMode(runRequest, githubToken);
        break;
      case 'generate':
        response = await handleGenerateMode(runRequest);
        break;
      case 'audit':
        response = await handleAuditMode(runRequest);
        break;
      default:
        logger.error(`Unsupported mode: ${runRequest.mode}`, 'VALIDATION_ERROR');
        logger.complete(400, 'VALIDATION_ERROR');
        return apiErrorResponse(
          'VALIDATION_ERROR',
          `Unsupported mode: ${runRequest.mode}`,
          400,
          requestId
        );
    }

    // Add usage info and requestId to successful response
    const responseWithUsage: RunResponseWithUsage & { requestId: string } = {
      ...response,
      requestId,
      usage: toUsageInfo(usage),
    };

    logger.complete(200);
    return jsonResponse(responseWithUsage, 200, requestId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error occurred';
    logger.error(message, 'INTERNAL_ERROR');
    logger.complete(500, 'INTERNAL_ERROR');
    return apiErrorResponse('INTERNAL_ERROR', message, 500, requestId);
  }
}

/**
 * Cloudflare Worker default export.
 */
export default {
  fetch: handleRequest,
};

/**
 * Re-export Durable Object for Cloudflare binding.
 */
export { RateLimiterDO } from './doRateLimiter';
