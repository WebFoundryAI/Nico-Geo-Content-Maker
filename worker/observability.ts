/**
 * Observability Module
 *
 * Provides structured logging and request ID management for the Worker.
 *
 * DESIGN CONSTRAINTS:
 * - Every request gets a requestId (from header or generated)
 * - All logs are structured JSON with consistent fields
 * - Never log secrets (Authorization header, GitHub tokens, full request bodies)
 * - Logs are safe for aggregation and search
 */

/**
 * Request ID header name.
 */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Generates a UUID v4.
 */
export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Extracts or generates a request ID from headers.
 */
export function getOrCreateRequestId(request: Request): string {
  const existingId = request.headers.get(REQUEST_ID_HEADER);
  if (existingId && existingId.length > 0 && existingId.length <= 128) {
    // Sanitize: only allow alphanumeric, hyphens, and underscores
    const sanitized = existingId.replace(/[^a-zA-Z0-9\-_]/g, '');
    if (sanitized.length > 0) {
      return sanitized;
    }
  }
  return generateRequestId();
}

/**
 * Log entry fields.
 */
export interface LogEntry {
  timestamp: string;
  requestId: string;
  route: string;
  method: string;
  statusCode?: number;
  durationMs?: number;
  mode?: string;
  keyId?: string;
  errorCode?: string;
  message?: string;
  // Additional safe metadata
  [key: string]: string | number | boolean | undefined;
}

/**
 * Creates a timestamp in ISO UTC format.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Structured logger that outputs JSON.
 * Designed for Cloudflare Workers console.log which captures structured logs.
 */
export class Logger {
  private requestId: string;
  private route: string;
  private method: string;
  private startTime: number;
  private keyId?: string;
  private mode?: string;

  constructor(requestId: string, route: string, method: string) {
    this.requestId = requestId;
    this.route = route;
    this.method = method;
    this.startTime = Date.now();
  }

  /**
   * Sets the authenticated key ID (never the raw key).
   */
  setKeyId(keyId: string): void {
    this.keyId = keyId;
  }

  /**
   * Sets the request mode.
   */
  setMode(mode: string): void {
    this.mode = mode;
  }

  /**
   * Logs an info-level entry.
   */
  info(message: string, extra?: Record<string, string | number | boolean>): void {
    this.log('info', message, extra);
  }

  /**
   * Logs a warning-level entry.
   */
  warn(message: string, extra?: Record<string, string | number | boolean>): void {
    this.log('warn', message, extra);
  }

  /**
   * Logs an error-level entry.
   */
  error(message: string, errorCode?: string, extra?: Record<string, string | number | boolean>): void {
    this.log('error', message, { ...extra, errorCode });
  }

  /**
   * Logs the final request completion.
   */
  complete(statusCode: number, errorCode?: string): void {
    const entry: LogEntry = {
      timestamp: nowIso(),
      requestId: this.requestId,
      route: this.route,
      method: this.method,
      statusCode,
      durationMs: Date.now() - this.startTime,
    };

    if (this.keyId) {
      entry.keyId = this.keyId;
    }
    if (this.mode) {
      entry.mode = this.mode;
    }
    if (errorCode) {
      entry.errorCode = errorCode;
    }

    console.log(JSON.stringify(entry));
  }

  /**
   * Internal log method.
   */
  private log(
    level: string,
    message: string,
    extra?: Record<string, string | number | boolean | undefined>
  ): void {
    const entry: LogEntry = {
      timestamp: nowIso(),
      requestId: this.requestId,
      route: this.route,
      method: this.method,
      message,
      level,
    };

    if (this.keyId) {
      entry.keyId = this.keyId;
    }
    if (this.mode) {
      entry.mode = this.mode;
    }
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        if (value !== undefined && !isSensitiveKey(key)) {
          entry[key] = value;
        }
      }
    }

    console.log(JSON.stringify(entry));
  }
}

/**
 * List of sensitive keys that should never be logged.
 */
const SENSITIVE_KEYS = new Set([
  'authorization',
  'token',
  'apikey',
  'api_key',
  'secret',
  'password',
  'credential',
  'x-github-token',
]);

/**
 * Checks if a key is sensitive and should not be logged.
 */
function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return SENSITIVE_KEYS.has(lowerKey) || lowerKey.includes('token') || lowerKey.includes('secret');
}

/**
 * Creates a logger for a request.
 */
export function createLogger(request: Request, requestId: string): Logger {
  const url = new URL(request.url);
  return new Logger(requestId, url.pathname, request.method);
}

/**
 * Adds request ID header to response headers.
 */
export function addRequestIdHeader(headers: Headers, requestId: string): Headers {
  headers.set(REQUEST_ID_HEADER, requestId);
  return headers;
}
