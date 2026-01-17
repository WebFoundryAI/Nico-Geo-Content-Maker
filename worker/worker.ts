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
import { selectGenerators } from '../core/generators/selector';
import {
  generatePropertyMarketData,
  generatePermitsAndCodes,
  generateLocalCourtProcess,
  generateFirstTimeBuyerPrograms,
  generateSeasonalClimate,
} from '../core/generators/industry';
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
 * Uses generator selector for conditional execution of industry-specific generators.
 */
async function handleGenerateMode(request: RunRequest): Promise<RunResponse> {
  if (!request.businessInput) {
    throw new Error('businessInput is required for generate mode');
  }

  const startTime = Date.now();

  // Select which generators to run based on preferences and auto-detection
  const selection = await selectGenerators(request.businessInput, request.generators);

  // Build skip array for pipeline based on disabled generators
  const skipGenerators: Array<
    | 'titleMeta'
    | 'answerCapsule'
    | 'serviceDescription'
    | 'whyChooseUs'
    | 'teamBio'
    | 'howWeWork'
    | 'caseStudy'
    | 'testimonial'
    | 'faq'
    | 'schema'
  > = [];

  // Core generators - skip if not in enabled list
  if (!selection.enabled.includes('titleMeta')) skipGenerators.push('titleMeta');
  if (!selection.enabled.includes('answerCapsule')) skipGenerators.push('answerCapsule');
  if (!selection.enabled.includes('serviceDescription')) skipGenerators.push('serviceDescription');
  if (!selection.enabled.includes('whyChooseUs')) skipGenerators.push('whyChooseUs');
  if (!selection.enabled.includes('teamBio')) skipGenerators.push('teamBio');
  if (!selection.enabled.includes('howWeWork')) skipGenerators.push('howWeWork');
  if (!selection.enabled.includes('caseStudy')) skipGenerators.push('caseStudy');
  if (!selection.enabled.includes('testimonial')) skipGenerators.push('testimonial');
  if (!selection.enabled.includes('faq')) skipGenerators.push('faq');
  if (!selection.enabled.includes('schema')) skipGenerators.push('schema');

  // Execute the GEO pipeline with skip options
  const pipelineOutput = runGEOPipeline(request.businessInput, { skip: skipGenerators });

  // Validate output against contract
  const outputErrors = validateGEOOutput(pipelineOutput);
  if (outputErrors.length > 0) {
    throw new Error(`Pipeline output validation failed: ${outputErrors.join(', ')}`);
  }

  // Build results object with all generator outputs
  const results: RunResults = {};

  // Add core generator outputs if they were run
  if (selection.enabled.includes('titleMeta')) {
    results.titleMeta = pipelineOutput.titleMeta;
  }
  if (selection.enabled.includes('answerCapsule')) {
    results.answerCapsule = pipelineOutput.answerCapsule;
  }
  if (selection.enabled.includes('serviceDescription')) {
    results.serviceDescriptions = pipelineOutput.serviceDescriptions;
  }
  if (selection.enabled.includes('whyChooseUs') && pipelineOutput.whyChooseUs) {
    results.whyChooseUs = pipelineOutput.whyChooseUs;
  }
  if (selection.enabled.includes('teamBio') && pipelineOutput.teamBios) {
    results.teamBios = pipelineOutput.teamBios;
  }
  if (selection.enabled.includes('howWeWork') && pipelineOutput.howWeWork) {
    results.howWeWork = pipelineOutput.howWeWork;
  }
  if (selection.enabled.includes('caseStudy') && pipelineOutput.caseStudies) {
    results.caseStudies = pipelineOutput.caseStudies;
  }
  if (selection.enabled.includes('testimonial') && pipelineOutput.testimonials) {
    results.testimonials = pipelineOutput.testimonials;
  }
  if (selection.enabled.includes('faq')) {
    results.faq = pipelineOutput.faq;
  }
  if (selection.enabled.includes('schema')) {
    results.schema = pipelineOutput.schema;
  }

  // Execute industry-specific generators if enabled
  if (selection.enabled.includes('propertyMarketData')) {
    try {
      results.propertyMarketData = generatePropertyMarketData(request.businessInput);
    } catch {
      // Industry generator failures are non-fatal
    }
  }

  if (selection.enabled.includes('permitsAndCodes')) {
    try {
      results.permitsAndCodes = generatePermitsAndCodes(request.businessInput);
    } catch {
      // Industry generator failures are non-fatal
    }
  }

  if (selection.enabled.includes('localCourtProcess')) {
    try {
      results.localCourtProcess = generateLocalCourtProcess(request.businessInput);
    } catch {
      // Industry generator failures are non-fatal
    }
  }

  if (selection.enabled.includes('firstTimeBuyerPrograms')) {
    try {
      results.firstTimeBuyerPrograms = generateFirstTimeBuyerPrograms(request.businessInput);
    } catch {
      // Industry generator failures are non-fatal
    }
  }

  if (selection.enabled.includes('seasonalClimate')) {
    try {
      results.seasonalClimate = generateSeasonalClimate(request.businessInput);
    } catch {
      // Industry generator failures are non-fatal
    }
  }

  const executionTimeMs = Date.now() - startTime;

  const summary: RunSummary = {
    mode: 'generate',
    processedAt: new Date().toISOString(),
    inputSource: 'businessInput',
    sectionsGenerated: selection.enabled.length,
    generatorsRun: selection.enabled,
    generatorsSkipped: selection.disabled,
    detectedIndustry: selection.detectedIndustry,
    executionTimeMs,
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
 * HTML page for the GEO Audit UI - Visual Report.
 */
const AUDIT_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nico GEO Content Maker</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #fff; min-height: 100vh; }
    .container { max-width: 1100px; margin: 0 auto; padding: 40px 20px; }
    .header { text-align: center; margin-bottom: 30px; }
    .header h1 { font-size: 2.5rem; margin-bottom: 8px; background: linear-gradient(90deg, #4f46e5, #7c3aed); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .header p { color: #94a3b8; }

    /* Tabs */
    .tabs { display: flex; justify-content: center; gap: 8px; margin-bottom: 30px; }
    .tab { padding: 12px 28px; font-size: 15px; font-weight: 600; background: rgba(30, 41, 59, 0.5); color: #94a3b8; border: 1px solid #334155; border-radius: 10px; cursor: pointer; transition: all 0.2s; }
    .tab:hover { background: rgba(51, 65, 85, 0.5); }
    .tab.active { background: linear-gradient(90deg, #4f46e5, #7c3aed); color: white; border-color: transparent; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* Form Sections */
    .form-section { background: rgba(30, 41, 59, 0.5); border: 1px solid #334155; border-radius: 16px; padding: 24px; margin-bottom: 24px; }
    .form-section h3 { font-size: 1.1rem; margin-bottom: 16px; color: #e2e8f0; display: flex; align-items: center; gap: 10px; }
    .form-section h3 .icon { font-size: 1.2rem; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .form-group { margin-bottom: 0; }
    .form-group.full-width { grid-column: 1 / -1; }
    .form-group label { display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 6px; }
    .form-group input, .form-group textarea, .form-group select { width: 100%; padding: 12px 14px; font-size: 14px; border: 1px solid #334155; border-radius: 8px; background: #1e293b; color: #fff; outline: none; }
    .form-group input:focus, .form-group textarea:focus, .form-group select:focus { border-color: #4f46e5; }
    .form-group textarea { resize: vertical; min-height: 80px; }
    .form-group select option { background: #1e293b; }

    /* Generator Toggles */
    .generators-section { margin-bottom: 16px; }
    .generators-section h4 { font-size: 0.9rem; color: #94a3b8; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .generators-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
    .generator-toggle { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: rgba(30, 41, 59, 0.8); border: 1px solid #334155; border-radius: 8px; cursor: pointer; transition: all 0.2s; user-select: none; }
    .generator-toggle:hover { border-color: #4f46e5; }
    .generator-toggle.active { border-color: #4f46e5; background: rgba(79, 70, 229, 0.15); }
    .generator-toggle .info { display: flex; align-items: center; gap: 8px; }
    .generator-toggle .name { font-size: 0.85rem; font-weight: 500; }
    .generator-toggle .badge { font-size: 0.6rem; padding: 2px 5px; border-radius: 4px; background: rgba(16, 185, 129, 0.2); color: #10b981; }
    .toggle-switch { width: 36px; height: 20px; background: #334155; border-radius: 10px; position: relative; transition: background 0.2s; flex-shrink: 0; }
    .toggle-switch.on { background: #4f46e5; }
    .toggle-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: white; border-radius: 50%; transition: transform 0.2s; }
    .toggle-switch.on::after { transform: translateX(16px); }

    /* Quick Actions */
    .quick-actions { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
    .quick-btn { padding: 8px 16px; font-size: 0.8rem; font-weight: 500; background: #334155; color: #e2e8f0; border: none; border-radius: 6px; cursor: pointer; transition: all 0.2s; }
    .quick-btn:hover { background: #475569; }

    /* Buttons */
    .btn { padding: 14px 32px; font-size: 15px; font-weight: 600; border: none; border-radius: 10px; cursor: pointer; transition: all 0.2s; }
    .btn-primary { background: linear-gradient(90deg, #4f46e5, #7c3aed); color: white; }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 40px rgba(79, 70, 229, 0.3); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .btn-row { display: flex; gap: 12px; justify-content: center; margin-top: 24px; }

    /* Results */
    .gen-results { background: rgba(30, 41, 59, 0.5); border: 1px solid #334155; border-radius: 16px; padding: 24px; margin-top: 24px; display: none; }
    .gen-results.visible { display: block; }
    .gen-results h3 { font-size: 1.1rem; margin-bottom: 16px; color: #e2e8f0; }
    .result-block { margin-bottom: 20px; border: 1px solid #334155; border-radius: 10px; overflow: hidden; }
    .result-header { padding: 12px 16px; background: rgba(79, 70, 229, 0.1); border-bottom: 1px solid #334155; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
    .result-header h4 { font-size: 0.95rem; color: #a5b4fc; display: flex; align-items: center; gap: 8px; }
    .result-header h4::before { content: ''; width: 8px; height: 8px; background: #4f46e5; border-radius: 2px; }
    .result-header .expand-arrow { transition: transform 0.2s; }
    .result-header.open .expand-arrow { transform: rotate(180deg); }
    .result-content { padding: 16px; background: #0f172a; font-family: monospace; font-size: 13px; overflow-x: auto; white-space: pre-wrap; max-height: 400px; overflow-y: auto; display: none; }
    .result-content.visible { display: block; }
    .result-content.html-preview { font-family: inherit; white-space: normal; }

    /* Status */
    .status { text-align: center; padding: 20px; color: #94a3b8; display: none; }
    .status.visible { display: block; }
    .status.error { color: #f87171; background: rgba(248, 113, 113, 0.1); border-radius: 12px; }
    .status .spinner { display: inline-block; width: 24px; height: 24px; border: 3px solid rgba(79, 70, 229, 0.3); border-top-color: #4f46e5; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 12px; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Audit Tab Styles */
    .input-section { display: flex; gap: 12px; justify-content: center; margin-bottom: 40px; }
    .input-section input { width: 400px; padding: 16px 20px; font-size: 16px; border: 2px solid #334155; border-radius: 12px; background: #1e293b; color: #fff; outline: none; }
    .input-section input:focus { border-color: #4f46e5; }
    .input-section button { padding: 16px 32px; font-size: 16px; font-weight: 600; background: linear-gradient(90deg, #4f46e5, #7c3aed); color: white; border: none; border-radius: 12px; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; }
    .input-section button:hover { transform: translateY(-2px); box-shadow: 0 10px 40px rgba(79, 70, 229, 0.3); }
    .input-section button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .results { display: none; }
    .results.visible { display: block; }
    .score-section { display: flex; justify-content: center; align-items: center; gap: 60px; margin-bottom: 40px; padding: 40px; background: rgba(30, 41, 59, 0.5); border-radius: 24px; border: 1px solid #334155; flex-wrap: wrap; }
    .score-dial { position: relative; width: 200px; height: 200px; }
    .score-dial svg { transform: rotate(-90deg); }
    .score-dial .bg { fill: none; stroke: #334155; stroke-width: 12; }
    .score-dial .progress { fill: none; stroke-width: 12; stroke-linecap: round; transition: stroke-dashoffset 1s ease-out; }
    .score-dial .score-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; }
    .score-dial .score-value { font-size: 3.5rem; font-weight: 700; }
    .score-dial .score-label { font-size: 0.875rem; color: #94a3b8; }
    .score-info { text-align: left; }
    .readiness-badge { display: inline-block; padding: 8px 20px; border-radius: 30px; font-weight: 600; font-size: 1.1rem; margin-bottom: 16px; }
    .readiness-strong { background: linear-gradient(90deg, #059669, #10b981); }
    .readiness-needs-work { background: linear-gradient(90deg, #d97706, #f59e0b); }
    .readiness-not-ready { background: linear-gradient(90deg, #dc2626, #ef4444); }
    .site-url { color: #94a3b8; font-size: 0.875rem; word-break: break-all; margin-bottom: 8px; }
    .audit-time { color: #64748b; font-size: 0.75rem; }
    .top-issues { margin-bottom: 40px; }
    .section-title { font-size: 1.5rem; margin-bottom: 20px; display: flex; align-items: center; gap: 12px; }
    .section-title .icon { width: 32px; height: 32px; background: linear-gradient(90deg, #ef4444, #f87171); border-radius: 8px; display: flex; align-items: center; justify-content: center; }
    .issue-card { background: rgba(30, 41, 59, 0.5); border: 1px solid #334155; border-radius: 16px; padding: 24px; margin-bottom: 16px; border-left: 4px solid; }
    .issue-critical { border-left-color: #ef4444; }
    .issue-high { border-left-color: #f59e0b; }
    .issue-medium { border-left-color: #3b82f6; }
    .issue-low { border-left-color: #64748b; }
    .issue-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
    .issue-title { font-size: 1.1rem; font-weight: 600; }
    .severity-badge { padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
    .severity-critical { background: rgba(239, 68, 68, 0.2); color: #f87171; }
    .severity-high { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    .severity-medium { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
    .severity-low { background: rgba(100, 116, 139, 0.2); color: #94a3b8; }
    .issue-reason { color: #94a3b8; margin-bottom: 12px; font-size: 0.9rem; }
    .issue-fix { background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px; padding: 12px 16px; font-size: 0.875rem; }
    .issue-fix strong { color: #10b981; }
    .expandable-section { margin-bottom: 20px; }
    .expand-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; background: rgba(30, 41, 59, 0.5); border: 1px solid #334155; border-radius: 12px; cursor: pointer; transition: background 0.2s; }
    .expand-header:hover { background: rgba(51, 65, 85, 0.5); }
    .expand-header h3 { font-size: 1rem; display: flex; align-items: center; gap: 8px; }
    .expand-header .count { background: #334155; padding: 2px 10px; border-radius: 12px; font-size: 0.75rem; }
    .expand-icon { transition: transform 0.3s; }
    .expand-icon.open { transform: rotate(180deg); }
    .expand-content { display: none; padding: 16px 0; }
    .expand-content.visible { display: block; }
    .pass-item { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: rgba(16, 185, 129, 0.1); border-radius: 8px; margin-bottom: 8px; color: #10b981; }
    .footer { text-align: center; padding: 40px 0; color: #64748b; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Nico GEO Content Maker</h1>
      <p>AI-powered content generation and SEO analysis</p>
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <button class="tab active" onclick="switchTab('generate')">Generate Content</button>
      <button class="tab" onclick="switchTab('audit')">Site Audit</button>
    </div>

    <!-- Generate Tab -->
    <div id="generateTab" class="tab-content active">
      <!-- Business Information -->
      <div class="form-section">
        <h3><span class="icon">&#128188;</span> Business Information</h3>
        <div class="form-grid">
          <div class="form-group">
            <label>Business Name *</label>
            <input type="text" id="businessName" placeholder="e.g., Mike's Plumbing" required />
          </div>
          <div class="form-group">
            <label>City *</label>
            <input type="text" id="city" placeholder="e.g., Austin" required />
          </div>
          <div class="form-group">
            <label>State *</label>
            <input type="text" id="state" placeholder="e.g., TX" required />
          </div>
          <div class="form-group">
            <label>Industry</label>
            <select id="industry">
              <option value="">Auto-detect</option>
              <option value="plumbing">Plumbing</option>
              <option value="hvac">HVAC</option>
              <option value="electrical">Electrical</option>
              <option value="roofing">Roofing</option>
              <option value="contractor">General Contractor</option>
              <option value="realEstate">Real Estate</option>
              <option value="mortgage">Mortgage</option>
              <option value="lawyer">Legal/Attorney</option>
              <option value="landscaping">Landscaping</option>
              <option value="pools">Pools</option>
            </select>
          </div>
          <div class="form-group full-width">
            <label>Services (comma-separated) *</label>
            <input type="text" id="services" placeholder="e.g., drain cleaning, water heater repair, emergency plumbing" required />
          </div>
          <div class="form-group full-width">
            <label>Phone Number</label>
            <input type="text" id="phone" placeholder="e.g., (512) 555-1234" />
          </div>
          <div class="form-group full-width">
            <label>Unique Selling Points (optional)</label>
            <textarea id="usp" placeholder="e.g., 24/7 emergency service, 30+ years experience, family owned"></textarea>
          </div>
        </div>
      </div>

      <!-- Generator Selection -->
      <div class="form-section">
        <h3><span class="icon">&#9881;</span> Select Generators</h3>

        <div class="quick-actions">
          <button class="quick-btn" onclick="selectAll()">Select All</button>
          <button class="quick-btn" onclick="selectNone()">Select None</button>
          <button class="quick-btn" onclick="selectCore()">Core Only</button>
          <button class="quick-btn" onclick="selectIndustry()">Industry Only</button>
        </div>

        <div class="generators-section">
          <h4>Core Generators (All Industries)</h4>
          <div class="generators-grid" id="coreGenerators">
            <div class="generator-toggle active" data-id="titleMeta" onclick="toggleGenerator(this)">
              <div class="info"><span class="name">Title & Meta</span></div>
              <div class="toggle-switch on"></div>
            </div>
            <div class="generator-toggle active" data-id="answerCapsule" onclick="toggleGenerator(this)">
              <div class="info"><span class="name">Answer Capsule</span></div>
              <div class="toggle-switch on"></div>
            </div>
            <div class="generator-toggle active" data-id="serviceDescription" onclick="toggleGenerator(this)">
              <div class="info"><span class="name">Service Descriptions</span></div>
              <div class="toggle-switch on"></div>
            </div>
            <div class="generator-toggle active" data-id="whyChooseUs" onclick="toggleGenerator(this)">
              <div class="info"><span class="name">Why Choose Us</span></div>
              <div class="toggle-switch on"></div>
            </div>
            <div class="generator-toggle active" data-id="teamBio" onclick="toggleGenerator(this)">
              <div class="info"><span class="name">Team Bios</span></div>
              <div class="toggle-switch on"></div>
            </div>
            <div class="generator-toggle active" data-id="howWeWork" onclick="toggleGenerator(this)">
              <div class="info"><span class="name">How We Work</span></div>
              <div class="toggle-switch on"></div>
            </div>
            <div class="generator-toggle active" data-id="caseStudy" onclick="toggleGenerator(this)">
              <div class="info"><span class="name">Case Studies</span></div>
              <div class="toggle-switch on"></div>
            </div>
            <div class="generator-toggle active" data-id="testimonial" onclick="toggleGenerator(this)">
              <div class="info"><span class="name">Testimonials</span></div>
              <div class="toggle-switch on"></div>
            </div>
            <div class="generator-toggle active" data-id="faq" onclick="toggleGenerator(this)">
              <div class="info"><span class="name">FAQs</span></div>
              <div class="toggle-switch on"></div>
            </div>
            <div class="generator-toggle active" data-id="schema" onclick="toggleGenerator(this)">
              <div class="info"><span class="name">Schema Markup</span></div>
              <div class="toggle-switch on"></div>
            </div>
          </div>
        </div>

        <div class="generators-section">
          <h4>Industry-Specific Generators</h4>
          <div class="generators-grid" id="industryGenerators">
            <div class="generator-toggle" data-id="propertyMarketData" onclick="toggleGenerator(this)">
              <div class="info">
                <span class="name">Property Market</span>
                <span class="badge">Real Estate</span>
              </div>
              <div class="toggle-switch"></div>
            </div>
            <div class="generator-toggle" data-id="permitsAndCodes" onclick="toggleGenerator(this)">
              <div class="info">
                <span class="name">Permits & Codes</span>
                <span class="badge">Trade</span>
              </div>
              <div class="toggle-switch"></div>
            </div>
            <div class="generator-toggle" data-id="localCourtProcess" onclick="toggleGenerator(this)">
              <div class="info">
                <span class="name">Court Process</span>
                <span class="badge">Legal</span>
              </div>
              <div class="toggle-switch"></div>
            </div>
            <div class="generator-toggle" data-id="firstTimeBuyerPrograms" onclick="toggleGenerator(this)">
              <div class="info">
                <span class="name">Buyer Programs</span>
                <span class="badge">Mortgage</span>
              </div>
              <div class="toggle-switch"></div>
            </div>
            <div class="generator-toggle" data-id="seasonalClimate" onclick="toggleGenerator(this)">
              <div class="info">
                <span class="name">Seasonal Climate</span>
                <span class="badge">HVAC</span>
              </div>
              <div class="toggle-switch"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Generate Button -->
      <div class="btn-row">
        <button class="btn btn-primary" id="generateBtn" onclick="runGenerate()">Generate Content</button>
      </div>

      <!-- Status -->
      <div class="status" id="genStatus"></div>

      <!-- Results -->
      <div class="gen-results" id="genResults">
        <h3>Generated Content</h3>
        <div id="genResultsList"></div>
      </div>
    </div>

    <!-- Audit Tab -->
    <div id="auditTab" class="tab-content">
      <div class="input-section">
        <input type="url" id="siteUrl" placeholder="https://example.com" />
        <button id="runAudit" onclick="runAudit()">Analyze Site</button>
      </div>

      <div class="status" id="auditStatus"></div>

      <div class="results" id="auditResults">
        <div class="score-section">
          <div class="score-dial">
            <svg width="200" height="200" viewBox="0 0 200 200">
              <circle class="bg" cx="100" cy="100" r="88" />
              <circle class="progress" id="scoreCircle" cx="100" cy="100" r="88" stroke-dasharray="553" stroke-dashoffset="553" />
            </svg>
            <div class="score-text">
              <div class="score-value" id="scoreValue">0</div>
              <div class="score-label">GEO Score</div>
            </div>
          </div>
          <div class="score-info">
            <div class="readiness-badge" id="readinessBadge">Analyzing...</div>
            <div class="site-url" id="siteUrlDisplay"></div>
            <div class="audit-time" id="auditTime"></div>
          </div>
        </div>

        <div class="top-issues">
          <div class="section-title">
            <div class="icon"><svg width="16" height="16" fill="white" viewBox="0 0 20 20"><path d="M10 2L2 18h16L10 2zm0 4l5.5 10h-11L10 6z"/></svg></div>
            Top Priority Issues
          </div>
          <div id="topIssuesList"></div>
        </div>

        <div class="expandable-section">
          <div class="expand-header" onclick="toggleSection('technical')">
            <h3><span>&#128295;</span> Technical Issues <span class="count" id="technicalCount">0</span></h3>
            <svg class="expand-icon" id="technicalIcon" width="20" height="20" fill="#94a3b8" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
          </div>
          <div class="expand-content" id="technicalContent"></div>
        </div>

        <div class="expandable-section">
          <div class="expand-header" onclick="toggleSection('content')">
            <h3><span>&#128221;</span> Content Issues <span class="count" id="contentCount">0</span></h3>
            <svg class="expand-icon" id="contentIcon" width="20" height="20" fill="#94a3b8" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
          </div>
          <div class="expand-content" id="contentContent"></div>
        </div>

        <div class="expandable-section">
          <div class="expand-header" onclick="toggleSection('trust')">
            <h3><span>&#11088;</span> Trust & Conversion <span class="count" id="trustCount">0</span></h3>
            <svg class="expand-icon" id="trustIcon" width="20" height="20" fill="#94a3b8" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
          </div>
          <div class="expand-content" id="trustContent"></div>
        </div>
      </div>
    </div>

    <div class="footer">
      <p>Nico GEO Content Maker - AI-powered content for local businesses</p>
    </div>
  </div>

  <script>
    // Tab switching
    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.querySelector(\`.tab:nth-child(\${tab === 'generate' ? 1 : 2})\`).classList.add('active');
      document.getElementById(tab + 'Tab').classList.add('active');
    }

    // Generator toggle
    function toggleGenerator(el) {
      el.classList.toggle('active');
      el.querySelector('.toggle-switch').classList.toggle('on');
    }

    // Quick actions
    function selectAll() {
      document.querySelectorAll('.generator-toggle').forEach(el => {
        el.classList.add('active');
        el.querySelector('.toggle-switch').classList.add('on');
      });
    }
    function selectNone() {
      document.querySelectorAll('.generator-toggle').forEach(el => {
        el.classList.remove('active');
        el.querySelector('.toggle-switch').classList.remove('on');
      });
    }
    function selectCore() {
      selectNone();
      document.querySelectorAll('#coreGenerators .generator-toggle').forEach(el => {
        el.classList.add('active');
        el.querySelector('.toggle-switch').classList.add('on');
      });
    }
    function selectIndustry() {
      selectNone();
      document.querySelectorAll('#industryGenerators .generator-toggle').forEach(el => {
        el.classList.add('active');
        el.querySelector('.toggle-switch').classList.add('on');
      });
    }

    // Get selected generators
    function getSelectedGenerators() {
      return Array.from(document.querySelectorAll('.generator-toggle.active'))
        .map(el => el.dataset.id);
    }

    // Generate content
    async function runGenerate() {
      const btn = document.getElementById('generateBtn');
      const status = document.getElementById('genStatus');
      const results = document.getElementById('genResults');

      const businessName = document.getElementById('businessName').value.trim();
      const city = document.getElementById('city').value.trim();
      const state = document.getElementById('state').value.trim();
      const services = document.getElementById('services').value.trim();
      const phone = document.getElementById('phone').value.trim();
      const usp = document.getElementById('usp').value.trim();
      const industry = document.getElementById('industry').value;

      if (!businessName || !city || !state || !services) {
        alert('Please fill in all required fields (Business Name, City, State, Services)');
        return;
      }

      const selectedGenerators = getSelectedGenerators();
      if (selectedGenerators.length === 0) {
        alert('Please select at least one generator');
        return;
      }

      btn.disabled = true;
      status.className = 'status visible';
      status.innerHTML = '<div class="spinner"></div><div>Generating content... This may take a minute.</div>';
      results.className = 'gen-results';

      try {
        const payload = {
          businessInput: {
            businessName,
            city,
            state,
            services: services.split(',').map(s => s.trim()).filter(Boolean),
            phone: phone || undefined,
            uniqueSellingPoints: usp ? usp.split(',').map(s => s.trim()).filter(Boolean) : undefined,
            industry: industry || undefined
          },
          generators: {
            include: selectedGenerators
          },
          constraints: {
            noHallucinations: true
          }
        };

        const res = await fetch('/ui/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (data.status === 'error' || !res.ok) {
          throw new Error(data.message || data.error || 'Generation failed');
        }

        // Render results
        const resultsList = document.getElementById('genResultsList');
        resultsList.innerHTML = '';

        const outputs = data.results || data;
        const entries = Object.entries(outputs).filter(([k]) =>
          !['summary', 'status', 'message', 'requestId'].includes(k)
        );

        entries.forEach(([key, value]) => {
          const block = document.createElement('div');
          block.className = 'result-block';

          const header = document.createElement('div');
          header.className = 'result-header';
          header.innerHTML = \`<h4>\${formatName(key)}</h4><svg class="expand-arrow" width="16" height="16" fill="#94a3b8" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>\`;

          const content = document.createElement('div');
          content.className = 'result-content';
          content.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);

          header.onclick = () => {
            header.classList.toggle('open');
            content.classList.toggle('visible');
          };

          block.appendChild(header);
          block.appendChild(content);
          resultsList.appendChild(block);
        });

        status.className = 'status';
        results.className = 'gen-results visible';

        // Auto-expand first result
        const firstHeader = resultsList.querySelector('.result-header');
        if (firstHeader) firstHeader.click();

      } catch (err) {
        status.className = 'status visible error';
        status.textContent = 'Error: ' + err.message;
      } finally {
        btn.disabled = false;
      }
    }

    function formatName(key) {
      return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
    }

    // Audit section toggle
    function toggleSection(name) {
      const content = document.getElementById(name + 'Content');
      const icon = document.getElementById(name + 'Icon');
      content.classList.toggle('visible');
      icon.classList.toggle('open');
    }

    function getScoreColor(score) {
      if (score >= 70) return '#10b981';
      if (score >= 40) return '#f59e0b';
      return '#ef4444';
    }

    function renderIssue(issue, showFix = true) {
      const severityClass = 'issue-' + issue.severity.toLowerCase();
      const badgeClass = 'severity-' + issue.severity.toLowerCase();
      return \`
        <div class="issue-card \${severityClass}">
          <div class="issue-header">
            <div class="issue-title">\${issue.title}</div>
            <span class="severity-badge \${badgeClass}">\${issue.severity}</span>
          </div>
          <div class="issue-reason">\${issue.reason}</div>
          \${showFix ? \`<div class="issue-fix"><strong>Fix:</strong> \${issue.fix}</div>\` : ''}
        </div>
      \`;
    }

    function renderPass(text) {
      return \`<div class="pass-item">&#10003; \${text}</div>\`;
    }

    async function runAudit() {
      const urlInput = document.getElementById('siteUrl');
      const btn = document.getElementById('runAudit');
      const status = document.getElementById('auditStatus');
      const results = document.getElementById('auditResults');
      const siteUrl = urlInput.value.trim();

      if (!siteUrl) { alert('Please enter a URL'); return; }

      btn.disabled = true;
      status.className = 'status visible';
      status.innerHTML = '<div class="spinner"></div><div>Analyzing site... This may take a moment.</div>';
      results.className = 'results';

      try {
        const res = await fetch('/ui/audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteUrl })
        });
        const data = await res.json();

        if (data.status === 'error') throw new Error(data.message || 'Audit failed');

        const score = data.score || 0;
        const circle = document.getElementById('scoreCircle');
        const circumference = 553;
        const offset = circumference - (score / 100) * circumference;
        circle.style.stroke = getScoreColor(score);
        circle.style.strokeDashoffset = offset;
        document.getElementById('scoreValue').textContent = score;
        document.getElementById('scoreValue').style.color = getScoreColor(score);

        const badge = document.getElementById('readinessBadge');
        badge.textContent = data.readiness;
        badge.className = 'readiness-badge readiness-' + data.readiness.toLowerCase().replace(' ', '-');

        document.getElementById('siteUrlDisplay').textContent = siteUrl;
        document.getElementById('auditTime').textContent = 'Audited: ' + new Date().toLocaleString();

        const topList = document.getElementById('topIssuesList');
        topList.innerHTML = (data.topIssues || []).map(i => renderIssue(i)).join('');

        const sections = data.sections || {};
        ['technical', 'content', 'trust'].forEach(name => {
          const items = sections[name] || [];
          const issues = items.filter(i => i.severity !== 'pass');
          const passes = items.filter(i => i.severity === 'pass');
          document.getElementById(name + 'Count').textContent = issues.length;
          document.getElementById(name + 'Content').innerHTML =
            issues.map(i => renderIssue(i, false)).join('') +
            passes.map(i => renderPass(i.title)).join('');
        });

        status.className = 'status';
        results.className = 'results visible';

      } catch (err) {
        status.className = 'status visible error';
        status.textContent = 'Error: ' + err.message;
      } finally {
        btn.disabled = false;
      }
    }

    document.getElementById('siteUrl').addEventListener('keypress', (e) => { if (e.key === 'Enter') runAudit(); });
  </script>
</body>
</html>`;

/**
 * Issue severity weights for scoring.
 */
const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 20,
  high: 12,
  medium: 6,
  low: 3,
};

/**
 * Audit issue structure.
 */
interface AuditIssue {
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'pass';
  reason: string;
  fix: string;
  weight: number;
  category: 'technical' | 'content' | 'trust';
}

/**
 * Extracted page data from HTMLRewriter.
 */
interface PageData {
  title: string;
  h1: string;
  metaDescription: string;
  metaRobots: string;
  wordCount: number;
  hasLocalBusinessSchema: boolean;
  hasServiceSchema: boolean;
  hasFAQSchema: boolean;
  hasReviewSchema: boolean;
  internalLinks: number;
  hasPhone: boolean;
  hasAddress: boolean;
  hasFAQSection: boolean;
  serviceKeywords: string[];
  bodyText: string;
}

/**
 * HTMLRewriter handler to extract page data.
 */
class PageDataExtractor {
  data: PageData = {
    title: '',
    h1: '',
    metaDescription: '',
    metaRobots: '',
    wordCount: 0,
    hasLocalBusinessSchema: false,
    hasServiceSchema: false,
    hasFAQSchema: false,
    hasReviewSchema: false,
    internalLinks: 0,
    hasPhone: false,
    hasAddress: false,
    hasFAQSection: false,
    serviceKeywords: [],
    bodyText: '',
  };

  private currentElement: string = '';
  private collectingText: boolean = false;

  titleHandler = {
    element: () => { this.currentElement = 'title'; this.collectingText = true; },
    text: (text: { text: string }) => { if (this.currentElement === 'title') this.data.title += text.text; },
  };

  h1Handler = {
    element: () => { this.currentElement = 'h1'; this.collectingText = true; },
    text: (text: { text: string }) => { if (this.currentElement === 'h1' && !this.data.h1) this.data.h1 += text.text; },
  };

  metaHandler = {
    element: (el: { getAttribute: (n: string) => string | null }) => {
      const name = el.getAttribute('name')?.toLowerCase();
      const content = el.getAttribute('content') || '';
      if (name === 'description') this.data.metaDescription = content;
      if (name === 'robots') this.data.metaRobots = content;
    },
  };

  linkHandler = {
    element: (el: { getAttribute: (n: string) => string | null }) => {
      const href = el.getAttribute('href') || '';
      if (href.startsWith('/') || href.startsWith('./')) this.data.internalLinks++;
    },
  };

  scriptHandler = {
    element: (el: { getAttribute: (n: string) => string | null }) => {
      this.currentElement = 'script';
      const type = el.getAttribute('type') || '';
      if (type === 'application/ld+json') this.collectingText = true;
    },
    text: (text: { text: string }) => {
      if (this.currentElement === 'script' && this.collectingText) {
        const t = text.text.toLowerCase();
        if (t.includes('localbusiness') || t.includes('plumber') || t.includes('plumbingservice')) this.data.hasLocalBusinessSchema = true;
        if (t.includes('service') || t.includes('homeandconstructionbusiness')) this.data.hasServiceSchema = true;
        if (t.includes('faqpage')) this.data.hasFAQSchema = true;
        if (t.includes('review') || t.includes('aggregaterating')) this.data.hasReviewSchema = true;
      }
    },
  };

  bodyHandler = {
    text: (text: { text: string }) => {
      this.data.bodyText += text.text + ' ';
    },
  };
}

/**
 * Analyzes extracted page data and generates issues.
 */
function analyzePageData(data: PageData, siteUrl: string): { issues: AuditIssue[]; score: number } {
  const issues: AuditIssue[] = [];
  let score = 100;

  // Clean body text and count words
  const cleanText = data.bodyText.replace(/\s+/g, ' ').trim();
  data.wordCount = cleanText.split(/\s+/).filter(w => w.length > 2).length;

  // Check for phone numbers
  const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}/g;
  data.hasPhone = phoneRegex.test(cleanText);

  // Check for address patterns
  const addressRegex = /\d+\s+[a-zA-Z]+\s+(street|st|road|rd|avenue|ave|lane|ln|drive|dr|way|court|ct)/i;
  data.hasAddress = addressRegex.test(cleanText);

  // Check for FAQ patterns
  data.hasFAQSection = /frequently\s+asked|faq|common\s+questions/i.test(cleanText);

  // Check for service keywords
  const serviceTerms = ['plumb', 'drain', 'pipe', 'leak', 'boiler', 'heating', 'emergency', 'repair', 'install', 'service'];
  data.serviceKeywords = serviceTerms.filter(term => cleanText.toLowerCase().includes(term));

  // TECHNICAL CHECKS
  if (!data.title) {
    issues.push({ title: 'Missing Page Title', severity: 'critical', reason: 'No <title> tag found. Search engines and AI need this to understand your page.', fix: 'Add a descriptive title tag like "Emergency Plumber in [City] | 24/7 Service | [Company]"', weight: SEVERITY_WEIGHTS.critical, category: 'technical' });
    score -= SEVERITY_WEIGHTS.critical;
  } else if (data.title.length < 30) {
    issues.push({ title: 'Title Too Short', severity: 'medium', reason: 'Title is only ' + data.title.length + ' characters. Optimal is 50-60 characters.', fix: 'Expand title to include location, service, and unique value proposition.', weight: SEVERITY_WEIGHTS.medium, category: 'technical' });
    score -= SEVERITY_WEIGHTS.medium;
  } else {
    issues.push({ title: 'Title Tag Present', severity: 'pass', reason: '', fix: '', weight: 0, category: 'technical' });
  }

  if (!data.h1) {
    issues.push({ title: 'Missing H1 Heading', severity: 'critical', reason: 'No <h1> tag found. This is the most important heading for SEO.', fix: 'Add a clear H1 that describes your main service and location.', weight: SEVERITY_WEIGHTS.critical, category: 'technical' });
    score -= SEVERITY_WEIGHTS.critical;
  } else {
    issues.push({ title: 'H1 Heading Present', severity: 'pass', reason: '', fix: '', weight: 0, category: 'technical' });
  }

  if (data.metaRobots.includes('noindex')) {
    issues.push({ title: 'Page Blocked from Indexing', severity: 'critical', reason: 'Meta robots contains "noindex". Search engines cannot index this page.', fix: 'Remove noindex from meta robots unless this is intentional.', weight: SEVERITY_WEIGHTS.critical, category: 'technical' });
    score -= SEVERITY_WEIGHTS.critical;
  }

  if (!data.hasLocalBusinessSchema && !data.hasServiceSchema) {
    issues.push({ title: 'Missing Business Schema', severity: 'high', reason: 'No LocalBusiness or Service schema found. This helps AI understand your business.', fix: 'Add JSON-LD schema with LocalBusiness type including name, address, phone, and services.', weight: SEVERITY_WEIGHTS.high, category: 'technical' });
    score -= SEVERITY_WEIGHTS.high;
  } else {
    issues.push({ title: 'Business Schema Present', severity: 'pass', reason: '', fix: '', weight: 0, category: 'technical' });
  }

  // CONTENT CHECKS
  if (data.wordCount < 300) {
    issues.push({ title: 'Thin Content', severity: 'critical', reason: 'Only ' + data.wordCount + ' words found. AI engines need substantial content to cite.', fix: 'Add at least 800 words of helpful content about your services, process, and expertise.', weight: SEVERITY_WEIGHTS.critical, category: 'content' });
    score -= SEVERITY_WEIGHTS.critical;
  } else if (data.wordCount < 600) {
    issues.push({ title: 'Limited Content Depth', severity: 'medium', reason: data.wordCount + ' words is below optimal. More comprehensive content ranks better.', fix: 'Expand content to cover common questions, service details, and local information.', weight: SEVERITY_WEIGHTS.medium, category: 'content' });
    score -= SEVERITY_WEIGHTS.medium;
  } else {
    issues.push({ title: 'Good Content Length', severity: 'pass', reason: '', fix: '', weight: 0, category: 'content' });
  }

  if (data.serviceKeywords.length < 3) {
    issues.push({ title: 'Missing Service Keywords', severity: 'high', reason: 'Found only ' + data.serviceKeywords.length + ' service-related terms. AI needs clear service signals.', fix: 'Naturally incorporate service terms: plumbing, drain cleaning, leak repair, emergency service, etc.', weight: SEVERITY_WEIGHTS.high, category: 'content' });
    score -= SEVERITY_WEIGHTS.high;
  } else {
    issues.push({ title: 'Service Keywords Present', severity: 'pass', reason: '', fix: '', weight: 0, category: 'content' });
  }

  if (data.internalLinks < 3) {
    issues.push({ title: 'Weak Internal Linking', severity: 'medium', reason: 'Only ' + data.internalLinks + ' internal links. This limits page authority flow.', fix: 'Add links to your service pages, areas served, and contact page.', weight: SEVERITY_WEIGHTS.medium, category: 'content' });
    score -= SEVERITY_WEIGHTS.medium;
  }

  if (!data.hasFAQSection && !data.hasFAQSchema) {
    issues.push({ title: 'No FAQ Content', severity: 'medium', reason: 'No FAQ section found. FAQs directly answer queries AI engines look for.', fix: 'Add 5-10 common questions and answers about your services.', weight: SEVERITY_WEIGHTS.medium, category: 'content' });
    score -= SEVERITY_WEIGHTS.medium;
  } else {
    issues.push({ title: 'FAQ Content Present', severity: 'pass', reason: '', fix: '', weight: 0, category: 'content' });
  }

  // TRUST CHECKS
  if (!data.hasPhone) {
    issues.push({ title: 'No Phone Number Visible', severity: 'high', reason: 'No phone number detected. This is critical for local service businesses.', fix: 'Display your phone number prominently in the header and throughout the page.', weight: SEVERITY_WEIGHTS.high, category: 'trust' });
    score -= SEVERITY_WEIGHTS.high;
  } else {
    issues.push({ title: 'Phone Number Visible', severity: 'pass', reason: '', fix: '', weight: 0, category: 'trust' });
  }

  if (!data.hasAddress) {
    issues.push({ title: 'No Address/Location Found', severity: 'medium', reason: 'No physical address detected. Location signals help local SEO.', fix: 'Add your business address or service areas clearly on the page.', weight: SEVERITY_WEIGHTS.medium, category: 'trust' });
    score -= SEVERITY_WEIGHTS.medium;
  } else {
    issues.push({ title: 'Address Present', severity: 'pass', reason: '', fix: '', weight: 0, category: 'trust' });
  }

  if (!data.hasReviewSchema) {
    issues.push({ title: 'No Review Schema', severity: 'medium', reason: 'No review or rating schema found. Social proof helps AI recommendations.', fix: 'Add AggregateRating schema or link to review platforms.', weight: SEVERITY_WEIGHTS.medium, category: 'trust' });
    score -= SEVERITY_WEIGHTS.medium;
  } else {
    issues.push({ title: 'Review Schema Present', severity: 'pass', reason: '', fix: '', weight: 0, category: 'trust' });
  }

  return { issues, score: Math.max(0, Math.min(100, score)) };
}

/**
 * Handles the UI audit endpoint (no auth required).
 * Uses fetch + HTMLRewriter to analyze the target URL.
 */
async function handleUIAudit(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { siteUrl?: string };
    let siteUrl = body?.siteUrl;

    if (!siteUrl || typeof siteUrl !== 'string') {
      return new Response(JSON.stringify({ status: 'error', message: 'siteUrl is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    // Ensure URL has protocol
    if (!siteUrl.startsWith('http://') && !siteUrl.startsWith('https://')) {
      siteUrl = 'https://' + siteUrl;
    }

    try {
      new URL(siteUrl);
    } catch {
      return new Response(JSON.stringify({ status: 'error', message: 'Invalid URL format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    // Fetch the target page
    let pageResponse: Response;
    try {
      pageResponse = await fetch(siteUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GEOAuditBot/1.0)' },
        redirect: 'follow',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      return new Response(JSON.stringify({ status: 'error', message: 'Could not fetch URL: ' + msg }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    if (!pageResponse.ok) {
      return new Response(JSON.stringify({
        status: 'error',
        message: 'Site returned HTTP ' + pageResponse.status,
      }), { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    }

    // Extract page data using HTMLRewriter
    const extractor = new PageDataExtractor();
    const rewriter = new HTMLRewriter()
      .on('title', extractor.titleHandler)
      .on('h1', extractor.h1Handler)
      .on('meta', extractor.metaHandler)
      .on('a', extractor.linkHandler)
      .on('script[type="application/ld+json"]', extractor.scriptHandler)
      .on('body', extractor.bodyHandler);

    // Process the response through HTMLRewriter
    const processed = rewriter.transform(pageResponse);
    await processed.text(); // Consume to trigger handlers

    // Analyze the extracted data
    const { issues, score } = analyzePageData(extractor.data, siteUrl);

    // Determine readiness
    let readiness: 'Not Ready' | 'Needs Work' | 'Strong';
    if (score >= 70) readiness = 'Strong';
    else if (score >= 40) readiness = 'Needs Work';
    else readiness = 'Not Ready';

    // Sort issues by weight and get top 3
    const sortedIssues = issues
      .filter(i => i.severity !== 'pass')
      .sort((a, b) => b.weight - a.weight);
    const topIssues = sortedIssues.slice(0, 3);

    // Group issues by category
    const sections = {
      technical: issues.filter(i => i.category === 'technical'),
      content: issues.filter(i => i.category === 'content'),
      trust: issues.filter(i => i.category === 'trust'),
    };

    const result = {
      status: 'success',
      score,
      readiness,
      topIssues,
      sections,
      siteUrl,
      auditedAt: new Date().toISOString(),
    };

    return new Response(JSON.stringify(result, null, 2), {
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
 * Handles the UI generate endpoint (no auth required).
 * Takes form data from UI and generates content.
 */
async function handleUIGenerate(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      businessInput?: {
        businessName?: string;
        city?: string;
        state?: string;
        services?: string[];
        phone?: string;
        uniqueSellingPoints?: string[];
        industry?: string;
      };
      generators?: {
        include?: string[];
        exclude?: string[];
      };
      constraints?: {
        noHallucinations?: boolean;
      };
    };

    // Validate required fields
    if (!body.businessInput) {
      return new Response(JSON.stringify({ status: 'error', message: 'businessInput is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    const { businessName, city, state, services } = body.businessInput;

    if (!businessName || typeof businessName !== 'string') {
      return new Response(JSON.stringify({ status: 'error', message: 'businessName is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    if (!city || typeof city !== 'string') {
      return new Response(JSON.stringify({ status: 'error', message: 'city is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    if (!state || typeof state !== 'string') {
      return new Response(JSON.stringify({ status: 'error', message: 'state is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    if (!services || !Array.isArray(services) || services.length === 0) {
      return new Response(JSON.stringify({ status: 'error', message: 'services array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    // Build the RunRequest structure with proper nested BusinessInput format
    const runRequest: RunRequest = {
      mode: 'generate',
      businessInput: {
        business: {
          name: businessName,
        },
        location: {
          primaryCity: city,
          region: state,
          country: 'UK',
          serviceAreas: [city],
        },
        contact: {
          phone: body.businessInput.phone || undefined,
        },
        services: {
          primary: services,
        },
        constraints: {
          noHallucinations: true,
        },
      },
      generators: body.generators ? {
        enabled: body.generators.include,
        disabled: body.generators.exclude,
      } : undefined,
      constraints: {
        noHallucinations: true,
      },
    };

    // Call the generate mode handler
    const response = await handleGenerateMode(runRequest);

    return new Response(JSON.stringify({ status: 'success', ...response }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed';
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

  // ============================================
  // ROUTE: GET / (Audit UI) - MUST BE FIRST
  // This check MUST come before any other routing
  // ============================================
  if (request.method === 'GET' && url.pathname === '/') {
    return new Response(AUDIT_UI_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Get or create request ID for API routes
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
  // ROUTE: POST /ui/audit (UI audit endpoint, no auth)
  // ============================================
  if (url.pathname === '/ui/audit' && request.method === 'POST') {
    return handleUIAudit(request);
  }

  // ============================================
  // ROUTE: POST /ui/generate (UI generate endpoint, no auth)
  // ============================================
  if (url.pathname === '/ui/generate' && request.method === 'POST') {
    return handleUIGenerate(request);
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
