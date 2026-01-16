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
 * CONSTRAINTS:
 * - Never writes files locally
 * - Never infers or fabricates data
 * - Write-back is opt-in and requires explicit configuration
 * - No secrets stored in code
 */

import type { BusinessInput } from '../inputs/business.schema';
import { validateBusinessInput } from '../core/rules/businessInput.validator';
import { runGEOPipeline } from '../core/pipeline/geoPipeline';
import { validateGEOOutput } from '../contracts/output.contract';
import { crawlSite, DEFAULT_CRAWLER_CONFIG } from '../core/ingest/siteCrawler';
import { analyzeGeoGaps } from '../core/analyze/geoGapAnalyzer';
import { planSiteImprovements } from '../core/analyze/improvementPlanner';
import { verifyWriteAccess, GitHubAPIError } from '../core/writeback/githubClient';
import { generatePatches, applyPatches } from '../core/writeback/patchApplier';
import type { GitHubClientConfig } from '../core/writeback/githubClient';
import type { PatchApplierConfig } from '../core/writeback/patchApplier';
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
} from './types';
import { isValidMode, isValidConstraints, isValidTargetRepo } from './types';

/**
 * Header name for GitHub token.
 */
const GITHUB_TOKEN_HEADER = 'X-GitHub-Token';

/**
 * Creates a JSON response with proper headers.
 */
function jsonResponse(data: RunResponse | ErrorResponse, status: number = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': `Content-Type, ${GITHUB_TOKEN_HEADER}`,
    },
  });
}

/**
 * Creates an error response.
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
      return { valid: false, error: 'targetRepo must include owner, repo, and branch' };
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
      targetRepo: obj.targetRepo as TargetRepoConfig | undefined,
      writeBackConfig: obj.writeBackConfig as WriteBackConfig | undefined,
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
 * Handles "improve" mode execution.
 * Crawls site, generates patch-ready improvement blocks, and optionally writes back to GitHub.
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

  // Generate improvement plan
  const improvementPlan = planSiteImprovements(crawlResult);

  // Prepare base results
  const improvements: ImproveResults = {
    siteUrl: improvementPlan.siteUrl,
    totalPages: improvementPlan.totalPages,
    pagesWithImprovements: improvementPlan.pagesWithImprovements,
    pages: improvementPlan.pages,
    siteWideSuggestions: improvementPlan.siteWideSuggestions,
    crawlErrors: crawlResult.errors,
  };

  // Handle write-back if enabled
  let writeBackEnabled = false;
  let writeBackDryRun = true;

  if (request.writeBack === true && request.targetRepo) {
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
      errors: patchResult.errors,
      warnings: patchResult.warnings,
    };
  } else if (request.writeBack === false || !request.writeBack) {
    // Dry run - just show what would be written
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

/**
 * Main request handler for the Worker.
 */
async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': `Content-Type, ${GITHUB_TOKEN_HEADER}`,
      },
    });
  }

  // Only accept POST to /run
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed. Use POST.', null, 405);
  }

  if (url.pathname !== '/run') {
    return errorResponse('Not found. Use POST /run', null, 404);
  }

  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON in request body', null, 400);
  }

  // Validate request structure
  const validation = validateRequest(body);
  if (!validation.valid) {
    return errorResponse(validation.error, null, 400);
  }

  const runRequest = validation.request;

  // Enforce noHallucinations constraint
  if (!runRequest.constraints.noHallucinations) {
    return errorResponse('constraints.noHallucinations must be true', runRequest.mode, 400);
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
        return errorResponse(`Unsupported mode: ${runRequest.mode}`, null, 400);
    }

    return jsonResponse(response, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error occurred';
    return errorResponse(message, runRequest.mode, 500);
  }
}

/**
 * Cloudflare Worker default export.
 */
export default {
  fetch: handleRequest,
};
