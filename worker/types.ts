/**
 * Cloudflare Worker Type Definitions
 *
 * Request and response types for the GEO Worker API.
 */

import type { BusinessInput } from '../inputs/business.schema';

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
  warnings?: string[];
}

/**
 * Results from the GEO pipeline execution.
 */
export interface RunResults {
  titleMeta?: unknown;
  answerCapsule?: unknown;
  serviceDescriptions?: unknown;
  faq?: unknown;
  schema?: unknown;
  auditFindings?: string[];
  improvementSuggestions?: string[];
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
