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
 *   - "improve": Generate patch-ready improvement blocks
 *
 * CONSTRAINTS:
 * - Never writes files
 * - Never commits to GitHub
 * - Never deploys sites
 * - Never infers or fabricates data
 */

import type { BusinessInput } from '../inputs/business.schema';
import { validateBusinessInput } from '../core/rules/businessInput.validator';
import { runGEOPipeline } from '../core/pipeline/geoPipeline';
import { validateGEOOutput } from '../contracts/output.contract';
import { crawlSite, DEFAULT_CRAWLER_CONFIG } from '../core/ingest/siteCrawler';
import { analyzeGeoGaps } from '../core/analyze/geoGapAnalyzer';
import { planSiteImprovements } from '../core/analyze/improvementPlanner';
import type {
  RunRequest,
  RunResponse,
  ErrorResponse,
  RunMode,
  RunSummary,
  RunResults,
  AuditResults,
  ImproveResults,
} from './types';
import { isValidMode, isValidConstraints } from './types';

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
      'Access-Control-Allow-Headers': 'Content-Type',
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

  return {
    valid: true,
    request: {
      mode,
      siteUrl: obj.siteUrl as string | undefined,
      businessInput: obj.businessInput as BusinessInput | undefined,
      constraints: obj.constraints as RunRequest['constraints'],
    },
  };
}

/**
 * Handles "improve" mode execution.
 * Crawls site and generates patch-ready improvement blocks.
 */
async function handleImproveMode(request: RunRequest): Promise<RunResponse> {
  if (!request.siteUrl) {
    throw new Error('siteUrl is required for improve mode');
  }

  // Crawl the site
  const maxPages = request.constraints.maxPages ?? DEFAULT_CRAWLER_CONFIG.maxPages;
  const crawlResult = await crawlSite(request.siteUrl, { maxPages });

  // Generate improvement plan
  const improvementPlan = planSiteImprovements(crawlResult);

  const summary: RunSummary = {
    mode: 'improve',
    processedAt: new Date().toISOString(),
    inputSource: 'siteUrl',
    pagesAnalyzed: crawlResult.pagesAnalyzed,
    sitemapFound: crawlResult.sitemapFound,
    warnings: crawlResult.errors.length > 0 ? crawlResult.errors : undefined,
  };

  const results: RunResults = {
    improvements: {
      siteUrl: improvementPlan.siteUrl,
      totalPages: improvementPlan.totalPages,
      pagesWithImprovements: improvementPlan.pagesWithImprovements,
      pages: improvementPlan.pages,
      siteWideSuggestions: improvementPlan.siteWideSuggestions,
      crawlErrors: crawlResult.errors,
    },
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
        'Access-Control-Allow-Headers': 'Content-Type',
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

  // Route to appropriate handler
  try {
    let response: RunResponse;

    switch (runRequest.mode) {
      case 'improve':
        response = await handleImproveMode(runRequest);
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
