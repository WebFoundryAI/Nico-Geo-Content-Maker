/**
 * Error Module
 *
 * Central registry of error codes and helpers for building consistent error responses.
 * All error responses follow a single shape for predictability.
 *
 * RESPONSE SHAPE:
 * {
 *   status: "error",
 *   requestId: string,
 *   errorCode: string,
 *   message: string,
 *   details?: Record<string, unknown>
 * }
 */

/**
 * All possible API error codes.
 * Centralized for consistency and documentation.
 */
export type ApiErrorCode =
  // Authentication errors (401)
  | 'MISSING_AUTH'
  | 'INVALID_FORMAT'
  | 'INVALID_KEY'
  | 'KEY_DISABLED'
  // Authorization errors (403)
  | 'PLAN_REQUIRED'
  // Rate limiting errors (429)
  | 'DAILY_LIMIT_EXCEEDED'
  | 'MINUTE_LIMIT_EXCEEDED'
  // Validation errors (400)
  | 'VALIDATION_ERROR'
  // Payload errors (413)
  | 'PAYLOAD_TOO_LARGE'
  // Review session errors (various)
  | 'SESSION_NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'SESSION_NOT_APPROVED'
  | 'SESSION_ALREADY_APPLIED'
  // Server errors (500)
  | 'INTERNAL_ERROR';

/**
 * HTTP status codes for each error code.
 */
export const ERROR_STATUS_CODES: Record<ApiErrorCode, number> = {
  MISSING_AUTH: 401,
  INVALID_FORMAT: 401,
  INVALID_KEY: 401,
  KEY_DISABLED: 401,
  PLAN_REQUIRED: 403,
  DAILY_LIMIT_EXCEEDED: 429,
  MINUTE_LIMIT_EXCEEDED: 429,
  VALIDATION_ERROR: 400,
  PAYLOAD_TOO_LARGE: 413,
  SESSION_NOT_FOUND: 404,
  SESSION_EXPIRED: 410,
  SESSION_NOT_APPROVED: 400,
  SESSION_ALREADY_APPLIED: 409,
  INTERNAL_ERROR: 500,
};

/**
 * Normalized error response shape.
 */
export interface NormalizedErrorResponse {
  status: 'error';
  requestId: string;
  errorCode: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Builds a normalized error response body.
 */
export function buildErrorBody(
  requestId: string,
  errorCode: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>
): NormalizedErrorResponse {
  const body: NormalizedErrorResponse = {
    status: 'error',
    requestId,
    errorCode,
    message,
  };
  if (details && Object.keys(details).length > 0) {
    body.details = details;
  }
  return body;
}

/**
 * Creates a Response object for an error.
 */
export function createErrorResponse(
  requestId: string,
  errorCode: ApiErrorCode,
  message: string,
  corsHeaders: Record<string, string>,
  details?: Record<string, unknown>
): Response {
  const body = buildErrorBody(requestId, errorCode, message, details);
  const statusCode = ERROR_STATUS_CODES[errorCode] ?? 500;

  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': requestId,
      ...corsHeaders,
    },
  });
}

/**
 * Default messages for common error codes.
 */
export const DEFAULT_ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  MISSING_AUTH: 'Authorization header is required',
  INVALID_FORMAT: 'Invalid Authorization header format. Use: Bearer <token>',
  INVALID_KEY: 'API key not found or invalid',
  KEY_DISABLED: 'API key has been disabled',
  PLAN_REQUIRED: 'This feature requires a higher plan',
  DAILY_LIMIT_EXCEEDED: 'Daily rate limit exceeded. Please try again tomorrow.',
  MINUTE_LIMIT_EXCEEDED: 'Too many requests. Please slow down.',
  VALIDATION_ERROR: 'Request validation failed',
  PAYLOAD_TOO_LARGE: 'Request payload exceeds maximum allowed size',
  SESSION_NOT_FOUND: 'Review session not found',
  SESSION_EXPIRED: 'Review session has expired',
  SESSION_NOT_APPROVED: 'Review session must be approved before applying',
  SESSION_ALREADY_APPLIED: 'Review session has already been applied',
  INTERNAL_ERROR: 'An internal error occurred',
};

/**
 * Maximum allowed request payload size in bytes (1 MB).
 */
export const MAX_PAYLOAD_SIZE_BYTES = 1 * 1024 * 1024;

/**
 * Checks if a content-length header exceeds the maximum payload size.
 */
export function isPayloadTooLarge(contentLength: string | null): boolean {
  if (!contentLength) {
    return false;
  }
  const size = parseInt(contentLength, 10);
  return !isNaN(size) && size > MAX_PAYLOAD_SIZE_BYTES;
}

/**
 * Version information for the API.
 * These values can be replaced by CI during build.
 */
export const VERSION_INFO = {
  version: '0.1.0',
  buildTime: '2024-01-01T00:00:00Z',
  gitSha: 'development',
} as const;
