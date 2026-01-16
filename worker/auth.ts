/**
 * API Key Authentication Module
 *
 * Handles parsing and validation of API keys using Cloudflare KV storage.
 * Keys are stored in NICO_GEO_KEYS namespace with metadata.
 *
 * KEY FORMAT IN KV:
 *   Key: api_key_{keyId}
 *   Value: JSON string of ApiKeyRecord
 *
 * HEADER FORMAT:
 *   Authorization: Bearer <api_key>
 */

/**
 * Supported billing plans.
 */
export type Plan = 'free' | 'pro';

/**
 * API key status.
 */
export type KeyStatus = 'active' | 'disabled';

/**
 * API key record stored in KV.
 */
export interface ApiKeyRecord {
  keyId: string;
  status: KeyStatus;
  plan: Plan;
  createdAt: string; // ISO 8601
  notes?: string;
}

/**
 * Result of key validation.
 */
export interface AuthResult {
  valid: true;
  keyRecord: ApiKeyRecord;
}

/**
 * Auth error result.
 */
export interface AuthError {
  valid: false;
  errorCode: 'MISSING_AUTH' | 'INVALID_FORMAT' | 'INVALID_KEY' | 'KEY_DISABLED';
  message: string;
}

/**
 * KV namespace interface (from Cloudflare Workers).
 */
export interface KVNamespace {
  get(key: string, options?: { type?: 'text' }): Promise<string | null>;
  get(key: string, options: { type: 'json' }): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Authorization header name.
 */
const AUTH_HEADER = 'Authorization';

/**
 * Bearer token prefix.
 */
const BEARER_PREFIX = 'Bearer ';

/**
 * KV key prefix for API keys.
 */
const KV_KEY_PREFIX = 'api_key_';

/**
 * Extracts the bearer token from the Authorization header.
 */
export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get(AUTH_HEADER);
  if (!authHeader) {
    return null;
  }

  if (!authHeader.startsWith(BEARER_PREFIX)) {
    return null;
  }

  const token = authHeader.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Validates an API key against KV storage.
 */
export async function validateApiKey(
  apiKey: string,
  kv: KVNamespace
): Promise<AuthResult | AuthError> {
  // Build KV key
  const kvKey = `${KV_KEY_PREFIX}${apiKey}`;

  // Lookup in KV
  let record: ApiKeyRecord | null = null;
  try {
    const value = await kv.get(kvKey, { type: 'text' });
    if (value) {
      record = JSON.parse(value) as ApiKeyRecord;
    }
  } catch {
    // Parse error or KV error - treat as invalid key
    return {
      valid: false,
      errorCode: 'INVALID_KEY',
      message: 'API key not found or invalid',
    };
  }

  // Key not found
  if (!record) {
    return {
      valid: false,
      errorCode: 'INVALID_KEY',
      message: 'API key not found or invalid',
    };
  }

  // Key is disabled
  if (record.status === 'disabled') {
    return {
      valid: false,
      errorCode: 'KEY_DISABLED',
      message: 'API key has been disabled',
    };
  }

  // Valid key
  return {
    valid: true,
    keyRecord: record,
  };
}

/**
 * Authenticates a request using the Authorization header and KV lookup.
 */
export async function authenticateRequest(
  request: Request,
  kv: KVNamespace
): Promise<AuthResult | AuthError> {
  // Extract bearer token
  const token = extractBearerToken(request);

  if (!token) {
    const authHeader = request.headers.get(AUTH_HEADER);
    if (!authHeader) {
      return {
        valid: false,
        errorCode: 'MISSING_AUTH',
        message: 'Authorization header is required. Use: Authorization: Bearer <api_key>',
      };
    }
    return {
      valid: false,
      errorCode: 'INVALID_FORMAT',
      message: 'Invalid Authorization header format. Use: Authorization: Bearer <api_key>',
    };
  }

  // Validate the key
  return validateApiKey(token, kv);
}

/**
 * Creates a KV key string for storing an API key record.
 */
export function buildKvKey(apiKey: string): string {
  return `${KV_KEY_PREFIX}${apiKey}`;
}

/**
 * Creates an API key record for storage (helper for setup scripts).
 */
export function createApiKeyRecord(
  keyId: string,
  plan: Plan,
  notes?: string
): ApiKeyRecord {
  return {
    keyId,
    status: 'active',
    plan,
    createdAt: new Date().toISOString(),
    notes,
  };
}
