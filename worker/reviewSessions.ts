/**
 * Review Sessions Module
 *
 * Provides KV storage helpers and TTL logic for review sessions.
 * Sessions allow human review of improvement plans before write-back.
 *
 * STORAGE:
 * - Sessions are stored in NICO_GEO_SESSIONS KV namespace
 * - Key format: review_session_{sessionId}
 * - Sessions have a configurable TTL (default 24 hours)
 *
 * SECURITY:
 * - GitHub tokens are NEVER stored in sessions
 * - Tokens must be provided at apply time
 */

import type { KVNamespace } from './auth';
import type {
  ReviewSession,
  ReviewSessionStatus,
  ReviewPlannedFile,
  ReviewDiffPreview,
  ReviewPatch,
  TargetRepoConfig,
} from './types';

/**
 * Default session TTL in milliseconds (24 hours).
 */
export const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * KV key prefix for review sessions.
 */
const KV_SESSION_PREFIX = 'review_session_';

/**
 * Generates a UUID v4.
 * Uses crypto.randomUUID() if available, otherwise fallback.
 */
export function generateSessionId(): string {
  // In Cloudflare Workers, crypto.randomUUID() is available
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
 * Builds a KV key for a session.
 */
export function buildSessionKey(sessionId: string): string {
  return `${KV_SESSION_PREFIX}${sessionId}`;
}

/**
 * Calculates expiration timestamp from creation time and TTL.
 */
export function calculateExpiresAt(createdAt: Date, ttlMs: number = DEFAULT_SESSION_TTL_MS): string {
  const expiresAt = new Date(createdAt.getTime() + ttlMs);
  return expiresAt.toISOString();
}

/**
 * Checks if a session has expired based on current time.
 */
export function isSessionExpired(session: ReviewSession, now: Date = new Date()): boolean {
  const expiresAt = new Date(session.expiresAt);
  return now >= expiresAt;
}

/**
 * Creates a new review session object.
 */
export function createReviewSession(params: {
  siteUrl: string;
  selectedTargets: string[];
  plannedFiles: ReviewPlannedFile[];
  diffPreviews: ReviewDiffPreview[];
  patches: ReviewPatch[];
  targetRepo: TargetRepoConfig;
  ttlMs?: number;
}): ReviewSession {
  const sessionId = generateSessionId();
  const createdAt = new Date();
  const expiresAt = calculateExpiresAt(createdAt, params.ttlMs ?? DEFAULT_SESSION_TTL_MS);

  return {
    sessionId,
    createdAt: createdAt.toISOString(),
    expiresAt,
    mode: 'improve',
    siteUrl: params.siteUrl,
    selectedTargets: params.selectedTargets,
    plannedFiles: params.plannedFiles,
    diffPreviews: params.diffPreviews,
    patches: params.patches,
    status: 'pending',
    targetRepo: params.targetRepo,
  };
}

/**
 * Stores a review session in KV.
 * Uses KV TTL to auto-expire sessions.
 */
export async function storeSession(
  kv: KVNamespace,
  session: ReviewSession
): Promise<void> {
  const key = buildSessionKey(session.sessionId);
  const value = JSON.stringify(session);

  // Calculate TTL in seconds for KV expiration
  const now = new Date();
  const expiresAt = new Date(session.expiresAt);
  const ttlSeconds = Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));

  await kv.put(key, value, { expirationTtl: ttlSeconds });
}

/**
 * Retrieves a review session from KV.
 * Returns null if not found.
 */
export async function getSession(
  kv: KVNamespace,
  sessionId: string
): Promise<ReviewSession | null> {
  const key = buildSessionKey(sessionId);
  const value = await kv.get(key, { type: 'text' });

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as ReviewSession;
  } catch {
    return null;
  }
}

/**
 * Updates a session's status in KV.
 * Preserves existing TTL by recalculating from expiresAt.
 */
export async function updateSessionStatus(
  kv: KVNamespace,
  sessionId: string,
  newStatus: ReviewSessionStatus,
  commitShas?: string[]
): Promise<ReviewSession | null> {
  const session = await getSession(kv, sessionId);
  if (!session) {
    return null;
  }

  // Update the session
  session.status = newStatus;
  if (commitShas) {
    session.commitShas = commitShas;
  }

  // Store with remaining TTL
  const key = buildSessionKey(sessionId);
  const value = JSON.stringify(session);
  const now = new Date();
  const expiresAt = new Date(session.expiresAt);
  const ttlSeconds = Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));

  await kv.put(key, value, { expirationTtl: ttlSeconds });

  return session;
}

/**
 * Result type for session retrieval with expiration check.
 */
export interface SessionRetrievalResult {
  found: true;
  session: ReviewSession;
  expired: boolean;
}

export interface SessionNotFoundResult {
  found: false;
}

export type GetSessionResult = SessionRetrievalResult | SessionNotFoundResult;

/**
 * Gets a session and checks its expiration status.
 */
export async function getSessionWithExpirationCheck(
  kv: KVNamespace,
  sessionId: string
): Promise<GetSessionResult> {
  const session = await getSession(kv, sessionId);

  if (!session) {
    return { found: false };
  }

  const expired = isSessionExpired(session);

  // If expired but status not yet updated, update it
  if (expired && session.status !== 'expired' && session.status !== 'applied') {
    await updateSessionStatus(kv, sessionId, 'expired');
    session.status = 'expired';
  }

  return {
    found: true,
    session,
    expired,
  };
}

/**
 * Validates that a session can be approved.
 */
export function canApproveSession(session: ReviewSession): {
  canApprove: boolean;
  reason?: string;
} {
  if (isSessionExpired(session)) {
    return { canApprove: false, reason: 'Session has expired' };
  }

  if (session.status === 'applied') {
    return { canApprove: false, reason: 'Session has already been applied' };
  }

  if (session.status === 'expired') {
    return { canApprove: false, reason: 'Session has expired' };
  }

  // pending or approved can both be approved (idempotent)
  return { canApprove: true };
}

/**
 * Validates that a session can be applied.
 */
export function canApplySession(session: ReviewSession): {
  canApply: boolean;
  reason?: string;
  isIdempotent?: boolean;
} {
  // Check if already applied (idempotent case)
  if (session.status === 'applied') {
    return {
      canApply: false,
      reason: 'Session has already been applied',
      isIdempotent: true,
    };
  }

  if (isSessionExpired(session)) {
    return { canApply: false, reason: 'Session has expired' };
  }

  if (session.status === 'expired') {
    return { canApply: false, reason: 'Session has expired' };
  }

  if (session.status !== 'approved') {
    return { canApply: false, reason: 'Session must be approved before applying' };
  }

  return { canApply: true };
}

/**
 * Serializes a session for storage (validation helper for test harness).
 */
export function serializeSession(session: ReviewSession): string {
  return JSON.stringify(session, null, 2);
}

/**
 * Deserializes a session from storage (validation helper for test harness).
 */
export function deserializeSession(json: string): ReviewSession | null {
  try {
    const parsed = JSON.parse(json);
    // Basic validation
    if (
      typeof parsed.sessionId === 'string' &&
      typeof parsed.createdAt === 'string' &&
      typeof parsed.expiresAt === 'string' &&
      parsed.mode === 'improve' &&
      typeof parsed.siteUrl === 'string' &&
      Array.isArray(parsed.selectedTargets) &&
      Array.isArray(parsed.plannedFiles) &&
      Array.isArray(parsed.diffPreviews) &&
      Array.isArray(parsed.patches) &&
      typeof parsed.status === 'string' &&
      typeof parsed.targetRepo === 'object'
    ) {
      return parsed as ReviewSession;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validates session ID format (UUID).
 */
export function isValidSessionId(sessionId: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(sessionId);
}
